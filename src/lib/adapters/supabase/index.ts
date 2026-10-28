// Postgres/Supabase adapter for the repository ports (cloud + self-hosted editions).
// Built per request from the caller's RLS-scoped client; never from the admin client,
// except AuditRepository.append, which goes through writeAudit() (service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { writeAudit } from "@/lib/audit";
import { auditedWrite, type WriteOp } from "@/lib/audited-write";
import type {
  Account,
  AuditEvent,
  BankTransaction,
  Entry,
  Organization,
  PeriodClose,
  Reconciliation,
  ReconEntry,
  Role,
  Transaction,
} from "@/lib/domain/models";
import { DuplicateKeyError, type Repositories } from "@/lib/ports";
import { newId } from "@/lib/domain/ledger";
import type { TransactionTemplate } from "@/lib/domain/templates";

type Db = SupabaseClient<Database>;

function auditJson(e: AuditEvent) {
  return {
    id: newId(),
    action: e.action,
    entity: e.entity,
    entity_id: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  };
}

const entryOf = (e: AuditEvent) => ({
  action: e.action,
  entity: e.entity,
  entityId: e.entityId ?? null,
  before: e.before,
  after: e.after,
  kind: e.entity === "transaction" ? ("ledger" as const) : ("change" as const),
});

function fail(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.code === "23505") throw new DuplicateKeyError(error.message);
  throw new Error(error.message);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toOrg = (r: any): Organization => ({
  id: r.id,
  name: r.name,
  orgType: r.org_type,
  currency: r.currency,
  fiscalYearStartMonth: r.fiscal_year_start_month,
  timezone: r.timezone,
  terminology: r.terminology,
  termOverrides: (r.term_overrides ?? {}) as Record<string, string>,
  aiPdfEnabled: !!r.ai_pdf_enabled,
  booksLockedThrough: r.books_locked_through ?? null,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const toAccount = (r: any): Account => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  type: r.type,
  subtype: r.subtype ?? null,
  isActive: !!r.is_active,
  createdAt: r.created_at,
});

const toEntry = (r: any): Entry => ({
  id: r.id,
  transactionId: r.transaction_id,
  accountId: r.account_id,
  amountCents: Number(r.amount_cents),
  categoryId: r.category_id ?? null,
  projectId: r.project_id ?? null,
  fundId: r.fund_id ?? null,
  memo: r.memo ?? null,
  reconciliationId: r.reconciliation_id ?? null,
});

const toTx = (r: any): Transaction => ({
  id: r.id,
  orgId: r.org_id,
  transactionDate: r.transaction_date,
  postedDate: r.posted_date ?? null,
  description: r.description,
  source: r.source,
  status: r.status,
  createdBy: r.created_by ?? null,
  idempotencyKey: r.idempotency_key ?? null,
  createdAt: r.created_at,
  entries: ((r.entries ?? []) as any[]).map(toEntry),
  tagIds: ((r.transaction_tags ?? []) as any[]).map((t) => t.tag_id),
});

const toBank = (r: any): BankTransaction => ({
  id: r.id,
  orgId: r.org_id,
  accountId: r.account_id,
  bankDate: r.bank_date,
  description: r.description,
  amountCents: Number(r.amount_cents),
  externalId: r.external_id ?? null,
  fingerprint: r.fingerprint,
  rowSeq: r.row_seq ?? null,
  batchId: r.batch_id ?? null,
  transactionId: r.transaction_id ?? null,
  needsReview: !!r.needs_review,
});

const toRecon = (r: any): Reconciliation => ({
  id: r.id,
  orgId: r.org_id,
  accountId: r.account_id,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  beginningBalanceCents: Number(r.beginning_balance_cents),
  endingBalanceCents: Number(r.ending_balance_cents),
  mode: r.mode,
  status: r.status,
  batchId: r.batch_id ?? null,
  completedBy: r.completed_by ?? null,
  completedAt: r.completed_at ?? null,
  createdAt: r.created_at ?? null,
});

const TX_SELECT =
  "*, entries(id, transaction_id, account_id, amount_cents, category_id, project_id, fund_id, memo, reconciliation_id), transaction_tags(tag_id)";
const PAGE = 1000;

const RECON_ENTRY_SELECT =
  "id, transaction_id, amount_cents, memo, reconciliation_id, transactions!inner(transaction_date, description, status)";
const toReconEntry = (r: any): ReconEntry => ({
  id: r.id,
  transactionId: r.transaction_id,
  date: r.transactions?.transaction_date ?? "",
  description: r.memo || r.transactions?.description || "",
  amountCents: Number(r.amount_cents),
  reconciliationId: r.reconciliation_id ?? null,
});
const toClose = (r: any): PeriodClose => ({
  id: r.id,
  orgId: r.org_id,
  fiscalYearEnd: r.fiscal_year_end,
  netIncomeCents: Number(r.net_income_cents),
  closedBy: r.closed_by,
  createdAt: r.created_at,
});

const toTemplate = (r: any): TransactionTemplate => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  description: r.description,
  lines: Array.isArray(r.lines) ? r.lines : [],
  frequency: r.frequency ?? null,
  nextDue: r.next_due ?? null,
  active: !!r.active,
});

const templateAudit = (orgId: string, id: string): AuditEvent => ({
  orgId,
  userId: "",
  action: "update",
  entity: "template",
  entityId: id,
});

export function createSupabaseRepositories(db: Db): Repositories {
  const sb = db as any; // keep the adapter readable; mapping functions are the typed boundary

  return {
    orgs: {
      async get(orgId) {
        const { data, error } = await sb.from("organizations").select("*").eq("id", orgId).maybeSingle();
        fail(error);
        return data ? toOrg(data) : null;
      },
      async listForUser(userId) {
        const { data, error } = await sb
          .from("user_roles")
          .select("role, organizations(*)")
          .eq("user_id", userId);
        fail(error);
        return ((data ?? []) as any[])
          .filter((r) => r.organizations)
          .map((r) => ({ ...toOrg(r.organizations), role: r.role as Role }));
      },
      async create(org) {
        const { error } = await sb.from("organizations").insert({
          id: org.id,
          name: org.name,
          org_type: org.orgType,
          currency: org.currency,
          fiscal_year_start_month: org.fiscalYearStartMonth,
          timezone: org.timezone,
          terminology: org.terminology,
          term_overrides: org.termOverrides,
          ai_pdf_enabled: org.aiPdfEnabled,
          books_locked_through: org.booksLockedThrough,
          created_by: org.createdBy,
        });
        fail(error);
      },
      async updateSettings(orgId, p, audit) {
        const row: any = {};
        if (p.name !== undefined) row.name = p.name;
        if (p.orgType !== undefined) row.org_type = p.orgType;
        if (p.currency !== undefined) row.currency = p.currency;
        if (p.fiscalYearStartMonth !== undefined) row.fiscal_year_start_month = p.fiscalYearStartMonth;
        if (p.timezone !== undefined) row.timezone = p.timezone;
        if (p.terminology !== undefined) row.terminology = p.terminology;
        if (p.termOverrides !== undefined) row.term_overrides = p.termOverrides;
        if (p.aiPdfEnabled !== undefined) row.ai_pdf_enabled = p.aiPdfEnabled;
        if (audit) {
          if (!Object.keys(row).length) return;
          await auditedWrite(sb, orgId, [{ table: "organizations", op: "update", values: row }], entryOf(audit));
          return;
        }
        const { error } = await sb.from("organizations").update(row).eq("id", orgId);
        fail(error);
      },
      async setBooksLockedThrough(orgId, date, audit) {
        if (audit) {
          await auditedWrite(
            sb,
            orgId,
            [{ table: "organizations", op: "update", values: { books_locked_through: date } }],
            entryOf(audit),
          );
          return;
        }
        const { error } = await sb
          .from("organizations")
          .update({ books_locked_through: date })
          .eq("id", orgId);
        fail(error);
      },
      async roleOf(userId, orgId) {
        const { data, error } = await sb
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("org_id", orgId)
          .maybeSingle();
        fail(error);
        return (data?.role as Role) ?? null;
      },
      async listMembers(orgId) {
        const { data, error } = await sb.from("user_roles").select("user_id, role").eq("org_id", orgId);
        fail(error);
        return ((data ?? []) as any[]).map((r) => ({
          userId: r.user_id,
          orgId,
          role: r.role,
          displayName: null,
        }));
      },
    },

    accounts: {
      async list(orgId, opts) {
        let q = sb.from("accounts").select("*").eq("org_id", orgId).order("name");
        if (!opts?.includeArchived) q = q.eq("is_active", true);
        const { data, error } = await q;
        fail(error);
        return ((data ?? []) as any[]).map(toAccount);
      },
      async getMany(orgId, ids) {
        if (!ids.length) return [];
        const { data, error } = await sb.from("accounts").select("*").eq("org_id", orgId).in("id", ids);
        fail(error);
        return ((data ?? []) as any[]).map(toAccount);
      },
      async create(accounts) {
        if (!accounts.length) return;
        const { error } = await sb.from("accounts").insert(
          accounts.map((a) => ({
            id: a.id,
            org_id: a.orgId,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            is_active: a.isActive,
          })),
        );
        fail(error);
      },
      async rename(orgId, id, name) {
        const { error } = await sb.from("accounts").update({ name }).eq("org_id", orgId).eq("id", id);
        fail(error);
      },
      async setActive(orgId, id, isActive) {
        const { error } = await sb
          .from("accounts")
          .update({ is_active: isActive })
          .eq("org_id", orgId)
          .eq("id", id);
        fail(error);
      },
      async hasOpeningBalance(orgId, accountId) {
        const { data, error } = await sb
          .from("entries")
          .select("id, transactions!inner(id, source, status, org_id)")
          .eq("account_id", accountId)
          .eq("transactions.org_id", orgId)
          .eq("transactions.source", "opening_balance")
          .eq("transactions.status", "posted")
          .limit(1);
        fail(error);
        return (data ?? []).length > 0;
      },
    },

    transactions: {
      async post(tx, audit) {
        // One database function writes the header, lines, tags and history entry together.
        const { error } = await (sb as any).rpc("post_transaction_atomic", {
          p_tx: {
            id: tx.id,
            org_id: tx.orgId,
            transaction_date: tx.transactionDate,
            posted_date: tx.postedDate,
            description: tx.description,
            source: tx.source,
            idempotency_key: tx.idempotencyKey,
          },
          p_entries: tx.entries.map((e) => ({
            id: e.id,
            account_id: e.accountId,
            amount_cents: e.amountCents,
            category_id: e.categoryId ?? null,
            project_id: e.projectId ?? null,
            fund_id: e.fundId ?? null,
            memo: e.memo ?? null,
          })),
          p_tags: tx.tagIds ?? [],
          p_audit: audit ? auditJson(audit) : null,
        });
        fail(error);
      },
      async findByIdempotencyKey(orgId, key) {
        const { data, error } = await sb
          .from("transactions")
          .select("id")
          .eq("org_id", orgId)
          .eq("idempotency_key", key)
          .maybeSingle();
        fail(error);
        return (data?.id as string) ?? null;
      },
      async get(orgId, id) {
        const { data, error } = await sb
          .from("transactions")
          .select(TX_SELECT)
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        fail(error);
        return data ? toTx(data) : null;
      },
      async list(orgId, opts) {
        let q = sb
          .from("transactions")
          .select(TX_SELECT)
          .eq("org_id", orgId)
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(opts?.limit ?? 100);
        if (opts?.from) q = q.gte("transaction_date", opts.from);
        if (opts?.to) q = q.lte("transaction_date", opts.to);
        if (!opts?.includeVoid) q = q.eq("status", "posted");
        const { data, error } = await q;
        fail(error);
        let rows = ((data ?? []) as any[]).map(toTx);
        if (opts?.accountId)
          rows = rows.filter((t) => t.entries.some((e) => e.accountId === opts.accountId));
        return rows;
      },
      async markVoid(orgId, id, audit) {
        const { data, error } = await (sb as any).rpc("void_transaction_atomic", {
          p_org: orgId,
          p_id: id,
          p_audit: audit ? auditJson(audit) : null,
        });
        fail(error);
        return data === true;
      },
      async clearReconciliation(entryIds) {
        if (!entryIds.length) return;
        const { error } = await sb.from("entries").update({ reconciliation_id: null }).in("id", entryIds);
        fail(error);
      },
      async ledgerRows(orgId, opts) {
        const out: Awaited<ReturnType<Repositories["transactions"]["ledgerRows"]>> = [];
        for (let from = 0; ; from += PAGE) {
          let q = sb
            .from("entries")
            .select(
              "id, amount_cents, account_id, transaction_id, project_id, fund_id, accounts!inner(name, type), transactions!inner(org_id, status, source, transaction_date, description)",
            )
            .eq("transactions.org_id", orgId)
            .eq("transactions.status", "posted")
            .neq("transactions.source", "closing")
            .order("id")
            .range(from, from + PAGE - 1);
          if (opts?.to) q = q.lte("transactions.transaction_date", opts.to);
          const { data, error } = await q;
          fail(error);
          const rows = (data ?? []) as any[];
          for (const r of rows)
            out.push({
              amountCents: Number(r.amount_cents),
              accountId: r.account_id,
              transactionId: r.transaction_id,
              description: r.transactions.description ?? "",
              accountName: r.accounts.name,
              accountType: r.accounts.type,
              projectId: r.project_id ?? null,
              fundId: r.fund_id ?? null,
              source: r.transactions.source,
              transactionDate: r.transactions.transaction_date,
            });
          if (rows.length < PAGE) break;
        }
        return out;
      },
    },

    bank: {
      async insertMany(rows) {
        let inserted = 0;
        let duplicates = 0;
        for (const r of rows) {
          const { error } = await sb.from("bank_transactions").insert({
            id: r.id,
            org_id: r.orgId,
            account_id: r.accountId,
            bank_date: r.bankDate,
            description: r.description,
            amount_cents: r.amountCents,
            external_id: r.externalId,
            fingerprint: r.fingerprint,
            row_seq: r.rowSeq,
            batch_id: r.batchId,
          });
          if (error?.code === "23505") duplicates++;
          else {
            fail(error);
            inserted++;
          }
        }
        return { inserted, duplicates };
      },
      async get(orgId, id) {
        const { data, error } = await sb
          .from("bank_transactions")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        fail(error);
        return data ? toBank(data) : null;
      },
      async listUnmatched(orgId, accountId) {
        let q = sb
          .from("bank_transactions")
          .select("*")
          .eq("org_id", orgId)
          .is("transaction_id", null)
          .order("bank_date");
        if (accountId) q = q.eq("account_id", accountId);
        const { data, error } = await q;
        fail(error);
        return ((data ?? []) as any[]).map(toBank);
      },
      async claim(orgId, id, transactionId, audit) {
        if (audit) {
          try {
            await auditedWrite(
              sb,
              orgId,
              [
                {
                  table: "bank_transactions",
                  op: "update",
                  values: { transaction_id: transactionId, needs_review: false },
                  match: { id, transaction_id: null },
                  minRows: 1,
                },
              ],
              entryOf(audit),
            );
            return true;
          } catch {
            return false;
          }
        }
        const { data, error } = await sb
          .from("bank_transactions")
          .update({ transaction_id: transactionId, needs_review: false })
          .eq("org_id", orgId)
          .eq("id", id)
          .is("transaction_id", null)
          .select("id");
        if (error) return false;
        return (data ?? []).length > 0;
      },
      async unlinkTransaction(orgId, transactionId) {
        const { data, error } = await sb
          .from("bank_transactions")
          .update({ transaction_id: null })
          .eq("org_id", orgId)
          .eq("transaction_id", transactionId)
          .select("id");
        fail(error);
        return (data ?? []).length;
      },
      async listInPeriod(orgId, accountId, from, to) {
        const { data, error } = await sb
          .from("bank_transactions")
          .select("*")
          .eq("org_id", orgId)
          .eq("account_id", accountId)
          .gte("bank_date", from)
          .lte("bank_date", to)
          .order("bank_date");
        fail(error);
        return ((data ?? []) as any[]).map(toBank);
      },
      async latestStatement(orgId, accountId) {
        const { data, error } = await sb
          .from("import_batches")
          .select("id, statement_start, statement_end, beginning_balance_cents, ending_balance_cents")
          .eq("org_id", orgId)
          .eq("account_id", accountId)
          .eq("status", "active")
          .not("statement_end", "is", null)
          .order("statement_end", { ascending: false })
          .limit(1)
          .maybeSingle();
        fail(error);
        const r = data as any;
        return r
          ? {
              batchId: r.id,
              statementStart: r.statement_start ?? null,
              statementEnd: r.statement_end,
              beginningBalanceCents: r.beginning_balance_cents ?? null,
              endingBalanceCents: r.ending_balance_cents ?? null,
            }
          : null;
      },
    },

    reconciliations: {
      async start(r, audit) {
        const row = {
          id: r.id,
          org_id: r.orgId,
          account_id: r.accountId,
          period_start: r.periodStart,
          period_end: r.periodEnd,
          beginning_balance_cents: r.beginningBalanceCents,
          ending_balance_cents: r.endingBalanceCents,
          mode: r.mode,
          batch_id: r.batchId,
          created_by: r.createdBy,
        };
        if (audit) {
          const { org_id: _o, ...values } = row;
          await auditedWrite(sb, r.orgId, [{ table: "reconciliations", op: "insert", values }], entryOf(audit));
          return;
        }
        const { error } = await sb.from("reconciliations").insert(row);
        fail(error);
      },
      async get(orgId, id) {
        const { data, error } = await sb
          .from("reconciliations")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        fail(error);
        return data ? toRecon(data) : null;
      },
      async locate(id) {
        const { data, error } = await sb.from("reconciliations").select("*").eq("id", id).maybeSingle();
        fail(error);
        return data ? toRecon(data) : null;
      },
      async itemCounts(orgId) {
        const { data, error } = await sb
          .from("reconciliations")
          .select("id, entries(id)")
          .eq("org_id", orgId);
        fail(error);
        return Object.fromEntries(
          ((data ?? []) as any[]).map((r) => [r.id, (r.entries ?? []).length]),
        );
      },
      async workspaceEntries(accountId, through, rid) {
        const { data, error } = await sb
          .from("entries")
          .select(RECON_ENTRY_SELECT)
          .eq("account_id", accountId)
          .eq("transactions.status", "posted")
          .lte("transactions.transaction_date", through)
          .or(`reconciliation_id.is.null,reconciliation_id.eq.${rid}`);
        fail(error);
        return ((data ?? []) as any[]).map(toReconEntry);
      },
      async entriesOf(rid) {
        const { data, error } = await sb
          .from("entries")
          .select(RECON_ENTRY_SELECT)
          .eq("reconciliation_id", rid);
        fail(error);
        return ((data ?? []) as any[]).map(toReconEntry);
      },
      async list(orgId, accountId) {
        let q = sb
          .from("reconciliations")
          .select("*")
          .eq("org_id", orgId)
          .order("period_end", { ascending: false });
        if (accountId) q = q.eq("account_id", accountId);
        const { data, error } = await q;
        fail(error);
        return ((data ?? []) as any[]).map(toRecon);
      },
      async setTicked(reconciliationId, entryIds, ticked, audit) {
        if (!entryIds.length) return;
        const { data: rec, error: rErr } = await sb
          .from("reconciliations")
          .select("account_id, org_id")
          .eq("id", reconciliationId)
          .maybeSingle();
        fail(rErr);
        if (!rec) return;
        if (audit) {
          await auditedWrite(
            sb,
            rec.org_id,
            [
              {
                table: "entries",
                op: "update",
                values: { reconciliation_id: ticked ? reconciliationId : null },
                match: {
                  account_id: rec.account_id,
                  reconciliation_id: ticked ? null : reconciliationId,
                },
                in: { id: entryIds },
              },
            ],
            entryOf(audit),
          );
          return;
        }
        const q = sb
          .from("entries")
          .update({ reconciliation_id: ticked ? reconciliationId : null })
          .in("id", entryIds)
          .eq("account_id", rec.account_id);
        const { error } = await (ticked
          ? q.is("reconciliation_id", null)
          : q.eq("reconciliation_id", reconciliationId));
        fail(error);
      },
      async clearedTotalCents(reconciliationId) {
        const { data, error } = await sb
          .from("entries")
          .select("amount_cents")
          .eq("reconciliation_id", reconciliationId);
        fail(error);
        return ((data ?? []) as any[]).reduce((s, r) => s + Number(r.amount_cents), 0);
      },
      async finish(orgId, id, userId, audit) {
        if (audit) {
          await auditedWrite(
            sb,
            orgId,
            [
              {
                table: "reconciliations",
                op: "update",
                values: { status: "completed", completed_by: userId, completed_at: new Date().toISOString() },
                match: { id },
                minRows: 1,
              },
            ],
            entryOf(audit),
          );
          return;
        }
        const { error } = await sb
          .from("reconciliations")
          .update({ status: "completed", completed_by: userId, completed_at: new Date().toISOString() })
          .eq("org_id", orgId)
          .eq("id", id);
        fail(error);
      },
      async reopen(orgId, id, audit) {
        if (audit) {
          await auditedWrite(
            sb,
            orgId,
            [
              {
                table: "reconciliations",
                op: "update",
                values: { status: "in_progress", completed_by: null, completed_at: null },
                match: { id },
                minRows: 1,
              },
            ],
            entryOf(audit),
          );
          return;
        }
        const { error } = await sb
          .from("reconciliations")
          .update({ status: "in_progress", completed_by: null, completed_at: null })
          .eq("org_id", orgId)
          .eq("id", id);
        fail(error);
      },
      async discard(orgId, id, audit) {
        if (audit) {
          const ops: WriteOp[] = [
            {
              table: "entries",
              op: "update",
              values: { reconciliation_id: null },
              match: { reconciliation_id: id },
            },
            { table: "reconciliations", op: "delete", match: { id, status: "in_progress" }, minRows: 1 },
          ];
          await auditedWrite(sb, orgId, ops, entryOf(audit));
          return;
        }
        const { error: uErr } = await sb
          .from("entries")
          .update({ reconciliation_id: null })
          .eq("reconciliation_id", id);
        fail(uErr);
        const { error } = await sb
          .from("reconciliations")
          .delete()
          .eq("org_id", orgId)
          .eq("id", id)
          .eq("status", "in_progress");
        fail(error);
      },
    },

    periodCloses: {
      async list(orgId) {
        const { data, error } = await sb
          .from("period_closes")
          .select("*")
          .eq("org_id", orgId)
          .order("fiscal_year_end", { ascending: false });
        fail(error);
        return ((data ?? []) as any[]).map(toClose);
      },
      async find(orgId, fye) {
        const { data, error } = await sb
          .from("period_closes")
          .select("*")
          .eq("org_id", orgId)
          .eq("fiscal_year_end", fye)
          .maybeSingle();
        fail(error);
        return data ? toClose(data) : null;
      },
      async closeAndLock(c, lockThrough, audit) {
        await auditedWrite(
          sb,
          c.orgId,
          [
            {
              table: "period_closes",
              op: "insert",
              values: {
                id: c.id,
                fiscal_year_end: c.fiscalYearEnd,
                transaction_id: null,
                net_income_cents: c.netIncomeCents,
                closed_by: c.closedBy,
              },
            },
            { table: "organizations", op: "update", values: { books_locked_through: lockThrough } },
          ],
          entryOf(audit),
        );
      },
      async create(c) {
        const { error } = await sb.from("period_closes").insert({
          id: c.id,
          org_id: c.orgId,
          fiscal_year_end: c.fiscalYearEnd,
          transaction_id: null,
          net_income_cents: c.netIncomeCents,
          closed_by: c.closedBy,
        });
        fail(error);
      },
    },

    projects: {
      async list(orgId) {
        const { data, error } = await sb
          .from("projects")
          .select("id, org_id, name, budget_cents, status")
          .eq("org_id", orgId)
          .order("name");
        fail(error);
        return ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          orgId: r.org_id,
          name: r.name,
          budgetCents: Number(r.budget_cents),
          status: r.status,
        }));
      },
    },

    templates: {
      async list(orgId) {
        const { data, error } = await sb
          .from("transaction_templates")
          .select("*")
          .eq("org_id", orgId)
          .order("name");
        fail(error);
        return ((data ?? []) as any[]).map(toTemplate);
      },
      async get(orgId, id) {
        const { data, error } = await sb
          .from("transaction_templates")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .maybeSingle();
        fail(error);
        return data ? toTemplate(data) : null;
      },
      async save(t, audit) {
        const { data: existing } = await sb
          .from("transaction_templates")
          .select("id")
          .eq("org_id", t.orgId)
          .eq("id", t.id)
          .maybeSingle();
        const values = {
          name: t.name,
          description: t.description,
          lines: t.lines,
          frequency: t.frequency,
          next_due: t.nextDue,
          active: t.active,
        };
        const op: WriteOp = existing
          ? { table: "transaction_templates", op: "update", values, match: { id: t.id }, minRows: 1 }
          : { table: "transaction_templates", op: "insert", values: { id: t.id, ...values } };
        await auditedWrite(sb, t.orgId, [op], entryOf(audit ?? templateAudit(t.orgId, t.id)));
      },
      async occurrences(orgId) {
        const { data, error } = await sb
          .from("recurring_occurrences")
          .select("id, org_id, template_id, due_date, status, transaction_id")
          .eq("org_id", orgId)
          .order("due_date");
        fail(error);
        return ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          orgId: r.org_id,
          templateId: r.template_id,
          dueDate: r.due_date,
          status: r.status,
          transactionId: r.transaction_id ?? null,
        }));
      },
      async recordOccurrence(o, nextDue, audit) {
        const { data: prior } = await sb
          .from("recurring_occurrences")
          .select("id")
          .eq("template_id", o.templateId)
          .eq("due_date", o.dueDate)
          .maybeSingle();
        if (prior) return false;
        await auditedWrite(
          sb,
          o.orgId,
          [
            {
              table: "recurring_occurrences",
              op: "insert",
              values: {
                id: o.id,
                template_id: o.templateId,
                due_date: o.dueDate,
                status: o.status,
                transaction_id: o.transactionId,
              },
            },
            {
              table: "transaction_templates",
              op: "update",
              values: { next_due: nextDue },
              match: { id: o.templateId },
              minRows: 1,
            },
          ],
          entryOf(audit ?? templateAudit(o.orgId, o.templateId)),
        );
        return true;
      },
      async getMode(orgId) {
        const { data, error } = await sb
          .from("organizations")
          .select("recurring_mode")
          .eq("id", orgId)
          .maybeSingle();
        fail(error);
        return (data as any)?.recurring_mode === "reminder" ? "reminder" : "drafts";
      },
      async setMode(orgId, mode, audit) {
        await auditedWrite(
          sb,
          orgId,
          [{ table: "organizations", op: "update", values: { recurring_mode: mode } }],
          entryOf(audit ?? { orgId, userId: "", action: "update", entity: "organization", entityId: orgId }),
        );
      },
    },

    budgets: {
      async list(orgId, periodType, periodStart) {
        const { data, error } = await sb
          .from("budgets")
          .select("id, org_id, account_id, fund_id, project_id, period_type, period_start, amount_cents")
          .eq("org_id", orgId)
          .eq("period_type", periodType)
          .eq("period_start", periodStart);
        fail(error);
        return ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          orgId: r.org_id,
          accountId: r.account_id,
          fundId: r.fund_id ?? null,
          projectId: r.project_id ?? null,
          periodType: r.period_type,
          periodStart: r.period_start,
          amountCents: Number(r.amount_cents),
        }));
      },
      async set(b, audit) {
        const match = {
          account_id: b.accountId,
          fund_id: b.fundId,
          project_id: b.projectId,
          period_type: b.periodType,
          period_start: b.periodStart,
        };
        const entry = entryOf(
          audit ?? { orgId: b.orgId, userId: "", action: "budget.set", entity: "budget", entityId: b.accountId },
        );
        if (b.amountCents === null) {
          await auditedWrite(sb, b.orgId, [{ table: "budgets", op: "delete", match }], entry);
          return;
        }
        let q = sb.from("budgets").select("id").eq("org_id", b.orgId).eq("account_id", b.accountId).eq("period_type", b.periodType).eq("period_start", b.periodStart);
        q = b.fundId ? q.eq("fund_id", b.fundId) : q.is("fund_id", null);
        q = b.projectId ? q.eq("project_id", b.projectId) : q.is("project_id", null);
        const { data: existing } = await q.maybeSingle();
        await auditedWrite(
          sb,
          b.orgId,
          [
            existing
              ? { table: "budgets", op: "update", values: { amount_cents: b.amountCents }, match: { id: (existing as any).id } }
              : { table: "budgets", op: "insert", values: { id: b.id, ...match, amount_cents: b.amountCents } },
          ],
          entry,
        );
      },
    },

    audit: {
      async append(e) {
        await writeAudit({
          org_id: e.orgId,
          user_id: e.userId,
          action: e.action,
          entity: e.entity,
          entity_id: e.entityId ?? null,
          before: e.before,
          after: e.after,
        });
      },
      async listFor(orgId, entity, entityId, limit = 50) {
        const { data, error } = await sb
          .from("audit_log")
          .select("action, created_at, after")
          .eq("org_id", orgId)
          .eq("entity", entity)
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(limit);
        fail(error);
        return ((data ?? []) as any[]).map((h) => ({
          action: h.action,
          at: h.created_at,
          after: h.after ?? null,
        }));
      },
    },
  };
}
