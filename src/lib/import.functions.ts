import { desktopAware } from "@/lib/desktop/bridge";
import type { CsvMapping } from "./parsers/csv";
import type { Json } from "@/integrations/supabase/types";
import type { Db } from "@/lib/db";
import { newId } from "./domain/ledger";
import { createSupabaseRepositories } from "./adapters/supabase";
import { postBankRow } from "./services/ledger";
import { auditedWrite } from "./audited-write";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkStatementBalance, PDF_LIMITS } from "@/lib/parsers/statement-balance";
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
        format: z.enum(["csv", "ofx", "qfx", "pdf"]),
        rows: z.array(rowSchema).min(1).max(5000),
        errorCount: z.number().int().min(0).default(0),
        statementStart: dateStr.nullish(),
        statementEnd: dateStr.nullish(),
        beginningBalanceCents: z.number().int().nullish(),
        endingBalanceCents: z.number().int().nullish(),
        acceptMismatch: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCan(supabase, userId, data.orgId, "write");
    let mismatch: number | null = null;
    if (data.format === "pdf") {
      const check = checkStatementBalance(
        data.beginningBalanceCents,
        data.rows.map((r) => r.amountCents),
        data.endingBalanceCents,
      );
      if (check.status === "mismatch") {
        if (!data.acceptMismatch)
          throw new Error(
            "The rows don't add up to the statement's closing balance. Fix them or confirm you'll review.",
          );
        mismatch = check.gapCents;
      }
    }
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
        needs_review: data.format === "pdf",
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
              balance_mismatch_cents: mismatch,
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
    const { data: posted, error: pErr } = await supabase
      .from("bank_transactions")
      .select("id")
      .eq("batch_id", data.batchId)
      .not("transaction_id", "is", null)
      .limit(1);
    if (pErr) throw new Error(pErr.message);
    if ((posted ?? []).length > 0)
      throw new Error(
        "Some rows from this file are already in the ledger. Void those transactions first.",
      );
    // Users have no DELETE on bank evidence; the server removes unposted rows after assertCan,
    // and marks the batch undone with its history entry in the same transaction.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", data.batchId)
      .eq("org_id", data.orgId)
      .is("transaction_id", null);
    const [removedRes] = await auditedWrite(
      supabaseAdmin,
      data.orgId,
      [
        {
          table: "bank_transactions",
          op: "delete",
          match: { batch_id: data.batchId, transaction_id: null },
        },
        {
          table: "import_batches",
          op: "update",
          values: { status: "undone" },
          match: { id: data.batchId },
          minRows: 1,
        },
      ],
      {
        action: "undo_import",
        entity: "import_batch",
        entityId: data.batchId,
        after: { removed: count ?? 0 },
        kind: "system",
      },
      userId,
    );
    const removed = { length: removedRes?.count ?? 0 };
    return { removed: removed?.length ?? 0 };
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

async function pdfUsage(supabase: Db, orgId: string, userId: string) {
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();
  const count = async (ms: number) => {
    const { count, error } = await supabase
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("kind", "pdf_extract")
      .gte("created_at", since(ms));
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const day = await count(86_400_000);
  const month = await count(30 * 86_400_000);
  return {
    dayUsed: day,
    monthUsed: month,
    remaining: Math.max(0, Math.min(PDF_LIMITS.perDay - day, PDF_LIMITS.perMonth - month)),
    limits: PDF_LIMITS,
  };
}

const getPdfUsageCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => pdfUsage(context.supabase, data.orgId, context.userId));
export const getPdfUsage = desktopAware("getPdfUsage", getPdfUsageCloud);

/** AI-assisted extraction of a statement's text. Opt-in per org, acknowledged per upload, rate-limited per person. Result is always reviewed before import. */
const extractPdfStatementCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: z.string().uuid(),
        text: z.string().min(20).max(120_000),
        pageCount: z
          .number()
          .int()
          .min(1)
          .max(PDF_LIMITS.maxPages, `PDFs over ${PDF_LIMITS.maxPages} pages aren't supported`),
        byteSize: z
          .number()
          .int()
          .min(1)
          .max(PDF_LIMITS.maxBytes, "PDFs over 10 MB aren't supported"),
        acknowledged: z.literal(true, {
          error: "Please confirm the AI notice first",
        }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: org, error: oErr } = await supabase
      .from("organizations")
      .select("ai_pdf_enabled")
      .eq("id", data.orgId)
      .single();
    if (oErr || !org) throw new Error("Organization not found");
    if (!org.ai_pdf_enabled)
      throw new Error("An admin needs to turn on AI PDF reading in Settings first.");
    const { data: canWrite } = await supabase.rpc("can_write_org", {
      _user_id: userId,
      _org_id: data.orgId,
    });
    if (!canWrite) throw new Error("You don't have permission to import here.");
    const usage = await pdfUsage(supabase, data.orgId, userId);
    if (usage.remaining <= 0)
      throw new Error(
        usage.dayUsed >= PDF_LIMITS.perDay
          ? `You've read ${PDF_LIMITS.perDay} PDFs today. Try again tomorrow.`
          : `You've read ${PDF_LIMITS.perMonth} PDFs in the last 30 days.`,
      );
    const usageId = newId();
    // cloud-only-write: per-user or service record, not organization books
    const { error: uErr } = await supabase.from("ai_usage").insert({
      id: usageId,
      org_id: data.orgId,
      user_id: userId,
      kind: "pdf_extract",
      page_count: data.pageCount,
      ok: false,
    });
    if (uErr) throw new Error(uErr.message);

    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI service is not configured");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You extract bank statement data. Return every transaction line exactly once. amount is signed: deposits/credits to the account positive, withdrawals/debits/fees negative. Dates as YYYY-MM-DD. Balances in major currency units. Omit fields you cannot find. Never invent transactions.",
          },
          { role: "user", content: data.text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "statement",
              parameters: {
                type: "object",
                properties: {
                  statement_start: { type: "string" },
                  statement_end: { type: "string" },
                  beginning_balance: { type: "number" },
                  ending_balance: { type: "number" },
                  transactions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string" },
                        description: { type: "string" },
                        amount: { type: "number" },
                      },
                      required: ["date", "description", "amount"],
                    },
                  },
                },
                required: ["transactions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "statement" } },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`AI extract failed [${res.status}]: ${body}`);
      if (res.status === 429) throw new Error("The reader is busy. Try again in a minute.");
      if (res.status === 402) throw new Error("AI credits are used up for this workspace.");
      throw new Error("Couldn't read this PDF automatically.");
    }
    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: unknown } }[] } }[];
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = (typeof args === "string" ? JSON.parse(args) : args) as
      | {
          statement_start?: string;
          statement_end?: string;
          beginning_balance?: unknown;
          ending_balance?: unknown;
          transactions?: { date?: unknown; description?: unknown; amount?: unknown }[];
        }
      | undefined;
    const c = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : null;
    return {
      statementStart: parsed?.statement_start ?? null,
      statementEnd: parsed?.statement_end ?? null,
      beginningBalanceCents: c(parsed?.beginning_balance),
      endingBalanceCents: c(parsed?.ending_balance),
      transactions: (parsed?.transactions ?? []).map((t) => ({
        date: String(t.date ?? ""),
        description: String(t.description ?? ""),
        amountCents: c(t.amount) ?? 0,
      })),
    };
  });
export const extractPdfStatement = desktopAware("extractPdfStatement", extractPdfStatementCloud);

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
