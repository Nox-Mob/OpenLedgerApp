import { desktopAware } from "@/lib/desktop/bridge";
import type { CsvMapping } from "./parsers/csv";
import type { Json } from "@/integrations/supabase/types";
import { newId } from "./domain/ledger";
import { createSupabaseRepositories } from "./adapters/supabase";
import { postBankRow } from "./services/ledger";
import { auditedWrite } from "./audited-write";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";

const rowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(300),
  amountCents: z
    .number()
    .int()
    .refine((v) => v !== 0),
  externalId: z.string().max(200).optional(),
});
type Row = z.infer<typeof rowSchema>;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * FITID (bank's own id) wins when present; otherwise a content hash that
 * includes the row's position in the file, so two genuinely identical rows
 * (e.g. two $5 coffees on the same day) don't collide — while re-importing
 * the same file still dedups.
 */
async function fingerprint(orgId: string, accountId: string, row: Row, rowSeq?: number) {
  const raw = row.externalId
    ? `fitid|${orgId}|${accountId}|${row.externalId}`
    : `${orgId}|${accountId}|${row.date}|${row.description}|${row.amountCents}|seq:${rowSeq ?? 0}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns indexes of rows that already exist (or repeat within the file). */
const checkDuplicatesCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid(),
        rows: z.array(rowSchema).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const fps = await Promise.all(
      data.rows.map((r, i) => fingerprint(data.orgId, data.accountId, r, i)),
    );
    const existing = new Set<string>();
    for (let i = 0; i < fps.length; i += 200) {
      const { data: found, error } = await context.supabase
        .from("bank_transactions")
        .select("fingerprint")
        .eq("org_id", data.orgId)
        .eq("account_id", data.accountId)
        .in("fingerprint", fps.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const f of found ?? []) existing.add(f.fingerprint);
    }
    const seen = new Set<string>();
    const duplicates: number[] = [];
    fps.forEach((f, i) => {
      if (existing.has(f) || seen.has(f)) duplicates.push(i);
      seen.add(f);
    });
    return { duplicates };
  });
export const checkDuplicates = desktopAware("checkDuplicates", checkDuplicatesCloud);

const importBankRowsCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid(),
        fileName: z.string().min(1).max(255),
        format: z.enum(["csv", "ofx", "qfx"]),
        rows: z.array(rowSchema).min(1).max(5000),
        errorCount: z.number().int().min(0).default(0),
        statementStart: dateStr.nullish(),
        statementEnd: dateStr.nullish(),
        beginningBalanceCents: z.number().int().nullish(),
        endingBalanceCents: z.number().int().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCan(supabase, userId, data.orgId, "write");
    const batchId = newId();
    const seen = new Set<string>();
    const records = [];
    for (const [i, row] of data.rows.entries()) {
      const fp = await fingerprint(data.orgId, data.accountId, row, i);
      if (seen.has(fp)) continue;
      seen.add(fp);
      records.push({
        id: newId(),
        account_id: data.accountId,
        bank_date: row.date,
        description: row.description,
        amount_cents: row.amountCents,
        external_id: row.externalId ?? null,
        fingerprint: fp,
        row_seq: i,
        batch_id: batchId,
      });
    }

    // Count rows already on file so the batch totals and history are written in the same
    // transaction as the rows. If another import races us, minRows fails and nothing is kept.
    const existing = new Set<string>();
    const fps = records.map((r) => r.fingerprint);
    for (let i = 0; i < fps.length; i += 200) {
      const { data: found, error: fErr } = await supabase
        .from("bank_transactions")
        .select("fingerprint")
        .eq("org_id", data.orgId)
        .eq("account_id", data.accountId)
        .in("fingerprint", fps.slice(i, i + 200));
      if (fErr) throw new Error(fErr.message);
      for (const f of found ?? []) existing.add(f.fingerprint);
    }
    const fresh = records.filter((r) => !existing.has(r.fingerprint));
    const imported = fresh.length;
    const duplicates = data.rows.length - imported;

    try {
      await auditedWrite(
        supabase,
        data.orgId,
        [
          {
            table: "import_batches",
            op: "insert",
            values: {
              id: batchId,
              account_id: data.accountId,
              file_name: data.fileName,
              format: data.format,
              statement_start: data.statementStart ?? null,
              statement_end: data.statementEnd ?? null,
              beginning_balance_cents: data.beginningBalanceCents ?? null,
              ending_balance_cents: data.endingBalanceCents ?? null,
              balance_mismatch_cents: null,
              rows_total: data.rows.length + data.errorCount,
              rows_error: data.errorCount,
              rows_imported: imported,
              rows_duplicate: duplicates,
              created_by: userId,
            },
          },
          {
            table: "bank_transactions",
            op: "insert",
            values: fresh,
            conflict: "nothing",
            minRows: imported,
            minRowsMessage: "Another import added some of these rows at the same time. Try again.",
          },
        ],
        {
          action: "import",
          entity: "import_batch",
          entityId: batchId,
          after: {
            file: data.fileName,
            format: data.format,
            imported,
            duplicates,
            errors: data.errorCount,
          },
          kind: "system",
        },
      );
    } catch (e) {
      throw new Error(`Import failed, nothing was saved: ${(e as Error).message}`, { cause: e });
    }

    return { batchId, imported, duplicatesSkipped: duplicates };
  });
export const importBankRows = desktopAware("importBankRows", importBankRowsCloud);

const listImportBatchesCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("import_batches")
      .select("*, accounts(name), bank_transactions(id, transaction_id)")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((b) => ({
      id: b.id as string,
      accountId: b.account_id as string,
      accountName: b.accounts?.name ?? "",
      fileName: b.file_name as string,
      format: b.format as string,
      statementStart: b.statement_start as string | null,
      statementEnd: b.statement_end as string | null,
      beginningBalanceCents: b.beginning_balance_cents as number | null,
      endingBalanceCents: b.ending_balance_cents as number | null,
      rowsImported: b.rows_imported as number,
      rowsDuplicate: b.rows_duplicate as number,
      rowsError: b.rows_error as number,
      status: b.status as string,
      createdAt: b.created_at as string,
      postedCount: (b.bank_transactions ?? []).filter((t) => t.transaction_id).length,
    }));
  });
export const listImportBatches = desktopAware("listImportBatches", listImportBatchesCloud);

const undoImportBatchCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ orgId: z.string().uuid(), batchId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCan(supabase, userId, data.orgId, "write");
    // The database checks the permission again, removes only rows not yet in the books, marks
    // the batch undone and writes the history entry, all at once (0016). No service role.
    const { data: removed, error } = await supabase.rpc("undo_import_batch", {
      p_org: data.orgId,
      p_batch: data.batchId,
    });
    if (error) throw new Error(error.message);
    return { removed: Number(removed ?? 0) };
  });
export const undoImportBatch = desktopAware("undoImportBatch", undoImportBatchCloud);

const mappingSchema = z.record(z.string(), z.unknown());

const listImportProfilesCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("import_profiles")
      .select("id, account_id, name, mapping")
      .eq("org_id", data.orgId)
      .order("name");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      name: r.name,
      mapping: r.mapping as unknown as CsvMapping,
    }));
  });
export const listImportProfiles = desktopAware("listImportProfiles", listImportProfilesCloud);

const saveImportProfileCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid(),
        name: z.string().min(1).max(80),
        mapping: mappingSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    // One saved layout per account+name: update it, or add it if it's new.
    const { data: existing, error: findErr } = await context.supabase
      .from("import_profiles")
      .select("id")
      .eq("org_id", data.orgId)
      .eq("account_id", data.accountId)
      .eq("name", data.name)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    const id = existing?.id ?? newId();
    await auditedWrite(
      context.supabase,
      data.orgId,
      [
        existing
          ? {
              table: "import_profiles",
              op: "update",
              values: { mapping: data.mapping as Json },
              match: { id },
              minRows: 1,
            }
          : {
              table: "import_profiles",
              op: "insert",
              values: {
                id,
                account_id: data.accountId,
                name: data.name,
                mapping: data.mapping as Json,
              },
            },
      ],
      {
        action: existing ? "update" : "create",
        entity: "import_profile",
        entityId: id,
        after: { name: data.name },
      },
    );
    return { ok: true };
  });
export const saveImportProfile = desktopAware("saveImportProfile", saveImportProfileCloud);

const listBankTransactionsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        accountId: z.string().uuid().optional(),
        unlinkedOnly: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("bank_transactions")
      .select(
        "id, bank_date, description, amount_cents, transaction_id, needs_review, accounts(name)",
      )
      .eq("org_id", data.orgId)
      .order("bank_date", { ascending: false })
      .limit(300);
    if (data.accountId) query = query.eq("account_id", data.accountId);
    if (data.unlinkedOnly) query = query.is("transaction_id", null);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      date: r.bank_date as string,
      description: r.description as string,
      amountCents: r.amount_cents as number,
      linkedTransactionId: r.transaction_id as string | null,
      needsReview: !!r.needs_review,
      accountName: r.accounts?.name ?? "",
    }));
  });
export const listBankTransactions = desktopAware("listBankTransactions", listBankTransactionsCloud);

/**
 * Turn an imported bank row into a real ledger transaction.
 * The bank row is evidence; the ledger transaction is the source of truth.
 */
const postBankTransactionCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        bankTransactionId: z.string().uuid(),
        offsetAccountId: z.string().uuid(),
        categoryId: z.string().uuid().nullish(),
        projectId: z.string().uuid().nullish(),
        fundId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCan(supabase, userId, data.orgId, "write");
    return postBankRow(createSupabaseRepositories(supabase), { ...data, userId });
  });
export const postBankTransaction = desktopAware("postBankTransaction", postBankTransactionCloud);
