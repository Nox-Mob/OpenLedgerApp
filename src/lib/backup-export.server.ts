import type { PlainRow, UntypedDb } from "./db";
import { ledgerRole, SETTINGS_DEFAULTS, type CoreRole } from "./core-org";

const dropNulls = (row: PlainRow) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
// Backup reads shared by the signed export handler and its roundtrip regression tests.
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

const ORG_TABLES = [
  // order matches domain/backup TABLES minus entries/transaction_tags
  "accounts",
  "categories",
  "tags",
  "projects",
  "funds",
  "transactions",
  "import_batches",
  "import_profiles",
  "bank_transactions",
  "reconciliations",
  "period_closes",
  "pledges",
  "pledge_payments",
  "budgets",
  "audit_log",
] as const;

// The client may be typed for schema ledger; core tables are read with .schema("public").
type CoreAware = UntypedDb & { schema?: (name: string) => UntypedDb };

export async function readBackupData(db: UntypedDb, orgId: string) {
  const core = (db as CoreAware).schema?.("public") ?? db;
  // The backup format keeps one "organization" object (core name plus Ledger's
  // settings) and a "user_roles" table (each member's Ledger role), as before.
  const [{ data: org, error }, { data: settings, error: sErr }] = await Promise.all([
    core.from("organizations").select("id, name, created_at, created_by").eq("id", orgId).single(),
    db.from("org_settings").select("*").eq("org_id", orgId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (sErr) throw new Error(sErr.message);
  const { org_id: _o, updated_at: _u, ...ledgerSettings } = (settings ?? {}) as PlainRow;
  const organization = { ...SETTINGS_DEFAULTS, ...(org as PlainRow), ...dropNulls(ledgerSettings) };
  organization["books_locked_through"] = ((settings as PlainRow | null)?.["books_locked_through"] ??
    null) as never;
  const tables: Record<string, PlainRow[]> = {};
  for (const t of ORG_TABLES)
    tables[t] = await all((f, to) =>
      db.from(t).select("*").eq("org_id", orgId).order("id").range(f, to),
    );
  const [members, overlay] = await Promise.all([
    all((f, to) =>
      core
        .from("memberships")
        .select("user_id, role, created_at")
        .eq("org_id", orgId)
        .order("user_id")
        .range(f, to),
    ),
    all((f, to) =>
      db
        .from("member_roles")
        .select("user_id, role")
        .eq("org_id", orgId)
        .order("user_id")
        .range(f, to),
    ),
  ]);
  const treasurers = new Set(
    overlay.filter((r) => r["role"] === "treasurer").map((r) => r["user_id"]),
  );
  tables["user_roles"] = members.map((m) => ({
    id: m["user_id"],
    org_id: orgId,
    user_id: m["user_id"],
    role: ledgerRole(m["role"] as CoreRole, treasurers.has(m["user_id"])),
    created_at: m["created_at"],
  }));
  tables["entries"] = (
    await all((f, to) =>
      db
        .from("entries")
        .select("*, transactions!inner(org_id)")
        .eq("transactions.org_id", orgId)
        .order("id")
        .range(f, to),
    )
  ).map(({ transactions: _t, ...e }: PageRow) => e);
  tables["transaction_tags"] = (
    await all((f, to) =>
      db
        .from("transaction_tags")
        .select("*, transactions!inner(org_id)")
        .eq("transactions.org_id", orgId)
        .order("transaction_id")
        .range(f, to),
    )
  ).map(({ transactions: _t, ...e }: PageRow) => e);
  return { organization, tables };
}
