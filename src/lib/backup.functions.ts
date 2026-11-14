import { desktopAware } from "@/lib/desktop/bridge";
import type { UntypedDb } from "./db";
import type { Json } from "@/integrations/supabase/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";

const orgId = z.string().uuid();
const PAGE = 1000;

type PageRow = Record<string, unknown>;
async function all(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: PageRow[] | null; error: { message: string } | null }>,
): Promise<PageRow[]> {
  const out: PageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Full JSON backup of one organization (admins only). Read through the caller's RLS client. */
const exportBackupCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    const { readBackupData } = await import("./backup-export.server");
    const { organization: org, tables } = await readBackupData(context.supabase, data.orgId);
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    // The history entry, as the signed-in admin (0016): no service role.
    const { error: auditError } = await context.supabase.rpc("record_backup_export", {
      p_org: data.orgId,
      p_counts: counts,
    });
    if (auditError)
      throw new Error(`The download could not be recorded in history: ${auditError.message}`);
    const { getSigningKeys } = await import("./backup-key.server");
    const { signBackup } = await import("./domain/backup");
    const signed = await signBackup(await getSigningKeys(), org, tables, new Date().toISOString());
    return signed as unknown as {
      manifest: typeof signed.manifest;
      signature: string;
      organization: { [k: string]: Json };
      tables: Record<string, { [k: string]: Json }[]>;
    };
  });
export const exportBackup = desktopAware("exportBackup", exportBackupCloud);

/** Every posted and voided transaction line, for spreadsheet export. */
const exportTransactionsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    const db = context.supabase as UntypedDb;
    const rows = await all((f, to) =>
      db
        .from("entries")
        .select(
          "id, amount_cents, memo, accounts(name, type), categories(name), projects(name), funds(name), transactions!inner(org_id, transaction_date, description, source, status)",
        )
        .eq("transactions.org_id", data.orgId)
        .order("id")
        .range(f, to),
    );
    type Named = { name?: string; type?: string } | null;
    type ExportRow = {
      amount_cents: number;
      memo: string | null;
      accounts: Named;
      categories: Named;
      projects: Named;
      funds: Named;
      transactions: {
        transaction_date: string;
        description: string;
        source: string;
        status: string;
      };
    };
    return (rows as unknown as ExportRow[])
      .map((r) => ({
        date: r.transactions.transaction_date as string,
        description: r.transactions.description as string,
        status: r.transactions.status as string,
        source: r.transactions.source as string,
        account: r.accounts?.name ?? "",
        accountType: r.accounts?.type ?? "",
        debitCents: r.amount_cents > 0 ? Number(r.amount_cents) : 0,
        creditCents: r.amount_cents < 0 ? -Number(r.amount_cents) : 0,
        category: r.categories?.name ?? "",
        project: r.projects?.name ?? "",
        fund: r.funds?.name ?? "",
        memo: r.memo ?? "",
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });
export const exportTransactions = desktopAware("exportTransactions", exportTransactionsCloud);

/** Organization history (audit log), newest first. Admins only. */
const listHistoryCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId,
        page: z.number().int().min(0).max(10000),
        entity: z.string().max(40).optional(),
        kind: z.enum(["change", "ledger", "system"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    const size = 50;
    let q = context.supabase
      .from("audit_log")
      .select(
        "id, user_id, action, entity, entity_id, before, after, recorded_change, created_at, kind",
        {
          count: "exact",
        },
      )
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false })
      .range(data.page * size, data.page * size + size - 1);
    if (data.entity) q = q.eq("entity", data.entity);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    const ids = [...new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    const known = new Set<string>();
    if (ids.length) {
      const { data: profiles } = await context.supabase
        .schema("public")
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      for (const p of profiles ?? []) {
        known.add(p.id);
        if (p.display_name) names.set(p.id, p.display_name);
      }
    }
    return {
      total: count ?? 0,
      pageSize: size,
      rows: (rows ?? []).map((r) => ({
        ...r,
        who: r.user_id
          ? (names.get(r.user_id) ??
            (known.has(r.user_id) ? `User ${r.user_id.slice(0, 8)}` : "Deleted user"))
          : "System",
      })),
    };
  });
export const listHistory = desktopAware("listHistory", listHistoryCloud);

const backupText = z
  .string()
  .min(2)
  .max(26 * 1024 * 1024);

async function verifyText(text: string) {
  const { MAX_BACKUP_BYTES, verifyBackup, BackupRejected } = await import("./domain/backup");
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new BackupRejected("The backup file is larger than 25 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupRejected("This file isn't a valid backup (it couldn't be read).");
  }
  const { getSigningKeys } = await import("./backup-key.server");
  return verifyBackup(parsed, (await getSigningKeys()).publicRaw);
}

/** Check a backup without writing anything. The owner or an admin restores it into an empty organization. */
const checkBackupFileCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ text: backupText }).parse(input))
  .handler(async ({ data }) => {
    const v = await verifyText(data.text);
    const m = v.backup.manifest;
    return {
      orgName: m.orgName,
      exportedAt: m.exportedAt,
      sameInstall: v.sameInstall,
      installFingerprint: v.installFingerprint,
      counts: v.counts,
    };
  });
export const checkBackupFile = desktopAware("checkBackupFile", checkBackupFileCloud);

const restoreBackupCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ orgId, text: backupText, confirmName: z.string().max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    const v = await verifyText(data.text);
    if (data.confirmName.trim() !== v.backup.manifest.orgName.trim())
      throw new Error("Type the organization name exactly as shown to confirm.");
    const { restoreIntoOrg } = await import("./restore.server");
    return restoreIntoOrg(context.supabase, data.orgId, v);
  });
export const restoreBackup = desktopAware("restoreBackup", restoreBackupCloud);

/** This install's backup fingerprint, so admins can compare it with a file's source. */
const getInstallFingerprintCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getSigningKeys } = await import("./backup-key.server");
    try {
      return { fingerprint: (await getSigningKeys()).fingerprint };
    } catch {
      return { fingerprint: null };
    }
  });
export const getInstallFingerprint = desktopAware(
  "getInstallFingerprint",
  getInstallFingerprintCloud,
);
