import type { SupabaseClient } from "@supabase/supabase-js";
import type { UntypedDb } from "./db";
// Server-only restore: verified backup -> brand new organization.
// Data is written with the caller's RLS client (they become admin of the new org), so
// every database guard still applies. Only history rows and rollback use the admin client.
import { newId } from "./domain/ledger";
import { checkRestorable, remapTables, type VerifiedBackup } from "./domain/backup";

// One shared lazy load, so restores running at the same time all use the same client.
let adminPromise: Promise<typeof import("@/integrations/supabase/client.server")> | null = null;
const adminModule = () => (adminPromise ??= import("@/integrations/supabase/client.server"));

type Row = Record<string, unknown>;
const CHUNK = 500;

function pick(row: Row, cols: string[]): Row {
  const out: Row = {};
  for (const c of cols) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

async function insertAll(db: UntypedDb, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`Could not restore ${table.replace(/_/g, " ")}: ${error.message}`);
  }
}

export async function restoreIntoNewOrg(
  db: UntypedDb,
  userId: string,
  verified: VerifiedBackup,
): Promise<{ orgId: string; name: string }> {
  const { backup, sameInstall, installFingerprint } = verified;
  const { tables } = remapTables(backup.tables, newId);
  checkRestorable(tables); // bookkeeping rules before any write
  const T = (n: string) => tables[n] ?? [];
  const src = backup.organization;
  const name = `${String(src["name"]).slice(0, 100)} (restored)`;
  const withOrg = (rows: Row[]) => rows.map((r) => ({ ...r, org_id: orgId }));

  // Core creates the organization with the caller as owner; Ledger's settings follow.
  const core = (db as unknown as SupabaseClient).schema("public");
  const { data: newOrg, error: createErr } = await core.rpc("create_organization", {
    p_name: name,
  });
  if (createErr || !newOrg)
    throw new Error(`Could not create the organization: ${createErr?.message ?? "no id"}`);
  const orgId = newOrg as string;
  const { error: orgErr } = await db.from("org_settings").insert({
    org_id: orgId,
    ...pick(src, [
      "org_type",
      "currency",
      "fiscal_year_start_month",
      "terminology",
      "term_overrides",
      "timezone",
      "ai_pdf_enabled",
    ]),
  });
  if (orgErr) throw new Error(`Could not create the organization: ${orgErr.message}`);

  try {
    const accounts = T("accounts");
    await insertAll(
      db,
      "accounts",
      withOrg(
        accounts.map((a) => ({
          ...pick(a, ["id", "name", "type", "subtype", "created_at"]),
          is_active: true,
        })),
      ),
    );
    for (const t of ["categories", "tags"])
      await insertAll(
        db,
        t,
        withOrg(T(t).map((r) => pick(r, ["id", "name", "type", "created_at"]))),
      );
    await insertAll(
      db,
      "projects",
      withOrg(
        T("projects").map((r) => pick(r, ["id", "name", "budget_cents", "status", "created_at"])),
      ),
    );
    await insertAll(
      db,
      "funds",
      withOrg(T("funds").map((r) => pick(r, ["id", "name", "is_restricted", "created_at"]))),
    );

    // Transactions, then their entries grouped so each request holds whole transactions
    // (the balance check runs when each request commits).
    await insertAll(
      db,
      "transactions",
      withOrg(
        T("transactions").map((r) => ({
          ...pick(r, [
            "id",
            "transaction_date",
            "posted_date",
            "description",
            "source",
            "status",
            "idempotency_key",
            "created_at",
          ]),
          created_by: userId,
        })),
      ),
    );
    const byTx = new Map<string, Row[]>();
    for (const e of T("entries")) {
      const k = String(e["transaction_id"]);
      byTx.set(k, [...(byTx.get(k) ?? []), e]);
    }
    let batch: Row[] = [];
    const flush = async () => {
      if (batch.length) await insertAll(db, "entries", batch);
      batch = [];
    };
    for (const lines of byTx.values()) {
      if (batch.length + lines.length > CHUNK) await flush();
      batch.push(
        ...lines.map((e) =>
          pick(e, [
            "id",
            "transaction_id",
            "account_id",
            "amount_cents",
            "category_id",
            "project_id",
            "fund_id",
            "memo",
            "created_at",
          ]),
        ),
      );
    }
    await flush();
    await insertAll(
      db,
      "transaction_tags",
      T("transaction_tags").map((r) => pick(r, ["transaction_id", "tag_id"])),
    );

    await insertAll(
      db,
      "import_batches",
      withOrg(
        T("import_batches").map((r) => ({
          ...pick(r, [
            "id",
            "account_id",
            "file_name",
            "format",
            "statement_start",
            "statement_end",
            "beginning_balance_cents",
            "ending_balance_cents",
            "rows_total",
            "rows_imported",
            "rows_duplicate",
            "rows_error",
            "status",
            "balance_mismatch_cents",
            "created_at",
          ]),
          created_by: userId,
        })),
      ),
    );
    await insertAll(
      db,
      "import_profiles",
      withOrg(
        T("import_profiles").map((r) =>
          pick(r, ["id", "account_id", "name", "mapping", "created_at"]),
        ),
      ),
    );
    await insertAll(
      db,
      "bank_transactions",
      withOrg(
        T("bank_transactions").map((r) =>
          pick(r, [
            "id",
            "account_id",
            "bank_date",
            "description",
            "amount_cents",
            "external_id",
            "fingerprint",
            "transaction_id",
            "raw",
            "batch_id",
            "needs_review",
            "row_seq",
            "created_at",
          ]),
        ),
      ),
    );

    // Statement checks, one at a time in their original order (only one may be open per
    // account): open, tick their lines, then finish (the database re-checks difference = 0).
    const recs = [...T("reconciliations")].sort((a, b) =>
      String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
    );
    const entriesByRec = new Map<string, string[]>();
    for (const e of T("entries"))
      if (e["reconciliation_id"]) {
        const k = String(e["reconciliation_id"]);
        entriesByRec.set(k, [...(entriesByRec.get(k) ?? []), String(e["id"])]);
      }
    for (const r of recs) {
      const { error: insErr } = await db.from("reconciliations").insert({
        ...pick(r, [
          "id",
          "account_id",
          "period_start",
          "period_end",
          "beginning_balance_cents",
          "ending_balance_cents",
          "mode",
          "batch_id",
          "created_at",
        ]),
        org_id: orgId,
        status: "in_progress",
        created_by: userId,
      });
      if (insErr) throw new Error(`Could not restore a statement check: ${insErr.message}`);
      const entryIds = entriesByRec.get(String(r["id"])) ?? [];
      for (let i = 0; i < entryIds.length; i += CHUNK) {
        const { error } = await db
          .from("entries")
          .update({ reconciliation_id: r["id"] })
          .in("id", entryIds.slice(i, i + CHUNK));
        if (error) throw new Error(`Could not restore statement check lines: ${error.message}`);
      }
      if (r["status"] === "completed") {
        const { error } = await db
          .from("reconciliations")
          .update({
            status: "completed",
            completed_by: userId,
            completed_at: r["completed_at"] ?? new Date().toISOString(),
          })
          .eq("id", r["id"]);
        if (error) throw new Error(`Could not finish a restored statement check: ${error.message}`);
      }
    }

    await insertAll(
      db,
      "period_closes",
      withOrg(
        T("period_closes").map((r) => ({
          ...pick(r, ["id", "fiscal_year_end", "transaction_id", "net_income_cents", "created_at"]),
          closed_by: userId,
        })),
      ),
    );
    await insertAll(
      db,
      "pledges",
      withOrg(
        T("pledges").map((r) => ({
          ...pick(r, [
            "id",
            "donor_name",
            "fund_id",
            "amount_cents",
            "pledge_date",
            "expected_date",
            "note",
            "status",
            "transaction_id",
            "created_at",
          ]),
          created_by: userId,
        })),
      ),
    );
    await insertAll(
      db,
      "pledge_payments",
      withOrg(
        T("pledge_payments").map((r) =>
          pick(r, [
            "id",
            "pledge_id",
            "transaction_id",
            "kind",
            "amount_cents",
            "paid_date",
            "created_at",
          ]),
        ),
      ),
    );
    await insertAll(
      db,
      "budgets",
      withOrg(
        T("budgets").map((r) =>
          pick(r, [
            "id",
            "account_id",
            "period_type",
            "period_start",
            "amount_cents",
            "created_at",
          ]),
        ),
      ),
    );

    // Archive accounts and lock the books last, so earlier writes weren't blocked.
    const archived = accounts.filter((a) => a["is_active"] === false).map((a) => a["id"]);
    if (archived.length) {
      const { error } = await db.from("accounts").update({ is_active: false }).in("id", archived);
      if (error) throw new Error(`Could not archive restored accounts: ${error.message}`);
    }
    if (src["books_locked_through"]) {
      const { error } = await db
        .from("org_settings")
        .update({ books_locked_through: src["books_locked_through"] })
        .eq("org_id", orgId);
      if (error) throw new Error(`Could not restore the books lock date: ${error.message}`);
    }

    // History: original rows as read-only "restored" entries, then one restore marker.
    const { supabaseAdmin } = await adminModule();
    const history = T("audit_log").map((h) => ({
      id: newId(),
      org_id: orgId,
      user_id: null,
      action: `restored.${String(h["action"])}`,
      entity: String(h["entity"]),
      entity_id: null,
      before: h["before"] ?? null,
      after: {
        original: h["after"] ?? null,
        original_user: h["user_id"] ?? null,
        original_entity_id: h["entity_id"] ?? null,
      },
      created_at: h["created_at"],
    }));
    for (let i = 0; i < history.length; i += CHUNK) {
      const { error } = await supabaseAdmin
        .from("audit_log")
        .insert(history.slice(i, i + CHUNK) as never);
      if (error) throw new Error(`Could not restore history: ${error.message}`);
    }
    const { error: markErr } = await supabaseAdmin.from("audit_log").insert({
      id: newId(),
      org_id: orgId,
      user_id: userId,
      action: "backup.restored",
      entity: "organization",
      entity_id: orgId,
      after: {
        source: sameInstall ? "this install" : "another install",
        install_fingerprint: installFingerprint,
        original_org_id: backup.manifest.orgId,
        original_name: backup.manifest.orgName,
        exported_at: backup.manifest.exportedAt,
        counts: verified.counts,
        members_not_restored: (backup.tables["user_roles"] ?? backup.tables["member_roles"] ?? [])
          .length,
      },
    } as never);
    if (markErr) throw new Error(`Could not record the restore: ${markErr.message}`);
    return { orgId, name };
  } catch (err) {
    // Roll back the half-built organization (same path as owner delete).
    const { supabaseAdmin } = await adminModule();
    await supabaseAdmin
      .from("deleted_organizations")
      .insert({ id: newId(), org_id: orgId, name, deleted_by: userId });
    await supabaseAdmin.schema("public").from("organizations").delete().eq("id", orgId);
    throw err;
  }
}
