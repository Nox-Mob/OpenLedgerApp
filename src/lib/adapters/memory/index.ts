// In-memory adapter for the repository ports. Used by tests today and as the
// reference behavior a future SQLite/desktop adapter must match.
import type {
  Account,
  AuditEvent,
  BankTransaction,
  CatalogItem,
  JsonValue,
  Pledge,
  PledgePayment,
  Organization,
  PeriodClose,
  Project,
  Reconciliation,
  ReconEntry,
  StatementInfo,
  Role,
  Transaction,
} from "@/lib/domain/models";
import type { Occurrence, RecurringMode, TransactionTemplate } from "@/lib/domain/templates";
import type { Budget } from "@/lib/ports";
import { DuplicateKeyError, type Repositories } from "@/lib/ports";

export interface MemoryStore {
  orgs: Map<string, Organization>;
  roles: { userId: string; orgId: string; role: Role }[];
  accounts: Map<string, Account>;
  transactions: Map<string, Transaction>;
  bank: Map<string, BankTransaction>;
  reconciliations: Map<string, Reconciliation>;
  audit: (AuditEvent & { at: string })[];
  /** Test hook: make every history write fail. */
  failAudit?: boolean;
  periodCloses: Map<string, PeriodClose>;
  projects: Map<string, Project>;
  statements: (StatementInfo & { orgId: string; accountId: string })[];
  templates: Map<string, TransactionTemplate>;
  occurrences: Occurrence[];
  budgets: Map<string, Budget>;
  recurringModes: Map<string, RecurringMode>;
  catalog: Map<string, CatalogItem>;
  pledges: Map<string, Pledge>;
  pledgePayments: PledgePayment[];
}

export function createMemoryStore(): MemoryStore {
  return {
    orgs: new Map(),
    roles: [],
    accounts: new Map(),
    transactions: new Map(),
    bank: new Map(),
    reconciliations: new Map(),
    audit: [],
    periodCloses: new Map(),
    projects: new Map(),
    statements: [],
    templates: new Map(),
    occurrences: [],
    budgets: new Map(),
    recurringModes: new Map(),
    catalog: new Map(),
    pledges: new Map(),
    pledgePayments: [],
  };
}

const NOW = "2026-01-01T00:00:00.000Z";

export function createMemoryRepositories(s: MemoryStore = createMemoryStore()): Repositories & {
  store: MemoryStore;
} {
  const allEntries = () => [...s.transactions.values()].flatMap((t) => t.entries);
  const reconEntries = (pred: (e: ReconEntry) => boolean): ReconEntry[] =>
    [...s.transactions.values()]
      .filter((t) => t.status === "posted")
      .flatMap((t) =>
        t.entries.map((e) => ({
          id: e.id,
          transactionId: t.id,
          accountId: e.accountId,
          date: t.transactionDate,
          description: e.memo || t.description,
          amountCents: e.amountCents,
          reconciliationId: e.reconciliationId,
        })),
      )
      .filter((e) => pred(e))
      .map(({ accountId: _a, ...e }) => e);
  let tick = 0;
  // Monotonic fake clock so "newest first" ordering is deterministic in tests.
  const pushAudit = (e: AuditEvent) =>
    s.audit.push({ ...e, at: new Date(Date.parse(NOW) + tick++).toISOString() });
  /** Fail before mutating when history is broken, so a change never exists without it. */
  const guardAudit = (audit?: AuditEvent) => {
    if (audit && s.failAudit) throw new Error("history unavailable");
  };
  const afterAudit = (audit?: AuditEvent) => {
    if (audit) pushAudit(audit);
  };
  return {
    store: s,
    orgs: {
      async get(id) {
        return s.orgs.get(id) ?? null;
      },
      async listForUser(userId) {
        return s.roles
          .filter((r) => r.userId === userId && s.orgs.has(r.orgId))
          .map((r) => ({ ...s.orgs.get(r.orgId)!, role: r.role }));
      },
      async create(org) {
        if (s.orgs.has(org.id)) throw new DuplicateKeyError();
        s.orgs.set(org.id, { ...org, createdAt: NOW });
        s.roles.push({ userId: org.createdBy, orgId: org.id, role: "admin" });
      },
      async updateSettings(id, patch, audit) {
        guardAudit(audit);
        const o = s.orgs.get(id);
        if (o) s.orgs.set(id, { ...o, ...patch });
        afterAudit(audit);
      },
      async setBooksLockedThrough(id, date, audit) {
        guardAudit(audit);
        const o = s.orgs.get(id);
        if (o) s.orgs.set(id, { ...o, booksLockedThrough: date });
        afterAudit(audit);
      },
      async roleOf(userId, orgId) {
        return s.roles.find((r) => r.userId === userId && r.orgId === orgId)?.role ?? null;
      },
      async listMembers(orgId) {
        return s.roles.filter((r) => r.orgId === orgId).map((r) => ({ ...r, displayName: null }));
      },
    },
    accounts: {
      async list(orgId, opts) {
        return [...s.accounts.values()].filter(
          (a) => a.orgId === orgId && (opts?.includeArchived || a.isActive),
        );
      },
      async getMany(orgId, ids) {
        return ids
          .map((id) => s.accounts.get(id))
          .filter((a): a is Account => !!a && a.orgId === orgId);
      },
      async create(list) {
        for (const a of list) {
          if (s.accounts.has(a.id)) throw new DuplicateKeyError();
          s.accounts.set(a.id, { ...a, createdAt: NOW });
        }
      },
      async rename(orgId, id, name) {
        const a = s.accounts.get(id);
        if (a?.orgId === orgId) s.accounts.set(id, { ...a, name });
      },
      async setActive(orgId, id, isActive) {
        const a = s.accounts.get(id);
        if (a?.orgId === orgId) s.accounts.set(id, { ...a, isActive });
      },
      async hasOpeningBalance(orgId, accountId) {
        return [...s.transactions.values()].some(
          (t) =>
            t.orgId === orgId &&
            t.source === "opening_balance" &&
            t.status === "posted" &&
            t.entries.some((e) => e.accountId === accountId),
        );
      },
    },
    transactions: {
      async post(tx, audit) {
        if (s.transactions.has(tx.id)) throw new DuplicateKeyError();
        if (audit && s.failAudit) throw new Error("history unavailable");
        if (
          tx.idempotencyKey &&
          [...s.transactions.values()].some(
            (t) => t.orgId === tx.orgId && t.idempotencyKey === tx.idempotencyKey,
          )
        )
          throw new DuplicateKeyError("idempotency_key");
        s.transactions.set(tx.id, {
          id: tx.id,
          orgId: tx.orgId,
          transactionDate: tx.transactionDate,
          postedDate: tx.postedDate,
          description: tx.description,
          source: tx.source,
          status: "posted",
          createdBy: tx.createdBy,
          idempotencyKey: tx.idempotencyKey,
          createdAt: NOW,
          tagIds: tx.tagIds ?? [],
          entries: tx.entries.map((e) => ({
            id: e.id,
            transactionId: tx.id,
            accountId: e.accountId,
            amountCents: e.amountCents,
            categoryId: e.categoryId ?? null,
            projectId: e.projectId ?? null,
            fundId: e.fundId ?? null,
            memo: e.memo ?? null,
            reconciliationId: null,
          })),
        });
        if (audit) pushAudit(audit);
      },
      async findByIdempotencyKey(orgId, key) {
        for (const t of s.transactions.values())
          if (t.orgId === orgId && t.idempotencyKey === key) return t.id;
        return null;
      },
      async get(orgId, id) {
        const t = s.transactions.get(id);
        return t && t.orgId === orgId ? structuredClone(t) : null;
      },
      async list(orgId, opts) {
        return [...s.transactions.values()]
          .filter(
            (t) =>
              t.orgId === orgId &&
              (opts?.includeVoid || t.status === "posted") &&
              (!opts?.from || t.transactionDate >= opts.from) &&
              (!opts?.to || t.transactionDate <= opts.to) &&
              (!opts?.accountId || t.entries.some((e) => e.accountId === opts.accountId)),
          )
          .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
          .slice(0, opts?.limit ?? 100);
      },
      async markVoid(orgId, id, audit) {
        const t = s.transactions.get(id);
        if (!t || t.orgId !== orgId || t.status !== "posted") return false;
        if (audit && s.failAudit) throw new Error("history unavailable");
        t.status = "void";
        if (audit) pushAudit(audit);
        return true;
      },
      async clearReconciliation(ids) {
        for (const e of allEntries()) if (ids.includes(e.id)) e.reconciliationId = null;
      },
      async ledgerRows(orgId, opts) {
        return [...s.transactions.values()]
          .filter(
            (t) =>
              t.orgId === orgId &&
              t.status === "posted" &&
              t.source !== "closing" &&
              (!opts?.to || t.transactionDate <= opts.to),
          )
          .flatMap((t) =>
            t.entries.map((e) => {
              const a = s.accounts.get(e.accountId)!;
              return {
                amountCents: e.amountCents,
                accountId: e.accountId,
                transactionId: t.id,
                description: t.description,
                accountName: a.name,
                accountType: a.type,
                projectId: e.projectId,
                fundId: e.fundId,
                source: t.source,
                transactionDate: t.transactionDate,
              };
            }),
          );
      },
    },
    bank: {
      async insertMany(rows) {
        let inserted = 0;
        let duplicates = 0;
        for (const r of rows) {
          const dup = [...s.bank.values()].some(
            (b) =>
              b.accountId === r.accountId &&
              (r.externalId
                ? b.externalId === r.externalId
                : b.fingerprint === r.fingerprint && b.rowSeq === r.rowSeq),
          );
          if (dup) duplicates++;
          else {
            s.bank.set(r.id, { ...r, transactionId: null, needsReview: false });
            inserted++;
          }
        }
        return { inserted, duplicates };
      },
      async get(orgId, id) {
        const b = s.bank.get(id);
        return b && b.orgId === orgId ? { ...b } : null;
      },
      async listUnmatched(orgId, accountId) {
        return [...s.bank.values()].filter(
          (b) => b.orgId === orgId && !b.transactionId && (!accountId || b.accountId === accountId),
        );
      },
      async claim(orgId, id, transactionId, audit) {
        const b = s.bank.get(id);
        if (!b || b.orgId !== orgId || b.transactionId) return false;
        guardAudit(audit);
        b.transactionId = transactionId;
        b.needsReview = false;
        afterAudit(audit);
        return true;
      },
      async unlinkTransaction(orgId, transactionId) {
        let n = 0;
        for (const b of s.bank.values())
          if (b.orgId === orgId && b.transactionId === transactionId) {
            b.transactionId = null;
            n++;
          }
        return n;
      },
      async listInPeriod(orgId, accountId, from, to) {
        return [...s.bank.values()]
          .filter(
            (b) =>
              b.orgId === orgId &&
              b.accountId === accountId &&
              b.bankDate >= from &&
              b.bankDate <= to,
          )
          .sort((a, b) => a.bankDate.localeCompare(b.bankDate))
          .map((b) => ({ ...b }));
      },
      async latestStatement(orgId, accountId) {
        const hit = s.statements
          .filter((x) => x.orgId === orgId && x.accountId === accountId)
          .sort((a, b) => b.statementEnd.localeCompare(a.statementEnd))[0];
        if (!hit) return null;
        const { orgId: _o, accountId: _a, ...info } = hit;
        return info;
      },
    },
    reconciliations: {
      async start(r, audit) {
        guardAudit(audit);
        afterAudit(audit);
        s.reconciliations.set(r.id, {
          id: r.id,
          orgId: r.orgId,
          accountId: r.accountId,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          beginningBalanceCents: r.beginningBalanceCents,
          endingBalanceCents: r.endingBalanceCents,
          mode: r.mode,
          status: "in_progress",
          batchId: r.batchId,
          completedBy: null,
          completedAt: null,
          createdAt: NOW,
        });
      },
      async locate(id) {
        const r = s.reconciliations.get(id);
        return r ? { ...r } : null;
      },
      async itemCounts(orgId) {
        const out: Record<string, number> = {};
        for (const r of s.reconciliations.values()) if (r.orgId === orgId) out[r.id] = 0;
        for (const e of allEntries())
          if (e.reconciliationId && e.reconciliationId in out) out[e.reconciliationId]!++;
        return out;
      },
      async workspaceEntries(accountId, through, rid) {
        return reconEntries(
          (e) =>
            (e as ReconEntry & { accountId: string }).accountId === accountId &&
            e.date <= through &&
            (e.reconciliationId === null || e.reconciliationId === rid),
        );
      },
      async entriesOf(rid) {
        return reconEntries((e) => e.reconciliationId === rid);
      },
      async get(orgId, id) {
        const r = s.reconciliations.get(id);
        return r && r.orgId === orgId ? { ...r } : null;
      },
      async list(orgId, accountId) {
        return [...s.reconciliations.values()].filter(
          (r) => r.orgId === orgId && (!accountId || r.accountId === accountId),
        );
      },
      async setTicked(rid, ids, ticked, audit) {
        const r = s.reconciliations.get(rid);
        if (!r) return;
        guardAudit(audit);
        afterAudit(audit);
        for (const e of allEntries()) {
          if (!ids.includes(e.id) || e.accountId !== r.accountId) continue;
          if (ticked && e.reconciliationId === null) e.reconciliationId = rid;
          else if (!ticked && e.reconciliationId === rid) e.reconciliationId = null;
        }
      },
      async clearedTotalCents(rid) {
        return allEntries()
          .filter((e) => e.reconciliationId === rid)
          .reduce((a, e) => a + e.amountCents, 0);
      },
      async finish(orgId, id, userId, audit) {
        guardAudit(audit);
        afterAudit(audit);
        const r = s.reconciliations.get(id);
        if (r?.orgId === orgId)
          Object.assign(r, { status: "completed", completedBy: userId, completedAt: NOW });
      },
      async reopen(orgId, id, audit) {
        guardAudit(audit);
        afterAudit(audit);
        const r = s.reconciliations.get(id);
        if (r?.orgId === orgId)
          Object.assign(r, { status: "in_progress", completedBy: null, completedAt: null });
      },
      async discard(orgId, id, audit) {
        const r = s.reconciliations.get(id);
        if (r?.orgId !== orgId || r.status !== "in_progress") return;
        guardAudit(audit);
        afterAudit(audit);
        for (const e of allEntries()) if (e.reconciliationId === id) e.reconciliationId = null;
        s.reconciliations.delete(id);
      },
    },
    periodCloses: {
      async list(orgId) {
        return [...s.periodCloses.values()]
          .filter((c) => c.orgId === orgId)
          .sort((a, b) => b.fiscalYearEnd.localeCompare(a.fiscalYearEnd));
      },
      async find(orgId, fye) {
        return (
          [...s.periodCloses.values()].find((c) => c.orgId === orgId && c.fiscalYearEnd === fye) ??
          null
        );
      },
      async create(c) {
        if (
          s.periodCloses.has(c.id) ||
          [...s.periodCloses.values()].some(
            (x) => x.orgId === c.orgId && x.fiscalYearEnd === c.fiscalYearEnd,
          )
        )
          throw new DuplicateKeyError();
        s.periodCloses.set(c.id, { ...c, createdAt: NOW });
      },
      async closeAndLock(c, lockThrough, audit) {
        guardAudit(audit);
        if (
          s.periodCloses.has(c.id) ||
          [...s.periodCloses.values()].some(
            (x) => x.orgId === c.orgId && x.fiscalYearEnd === c.fiscalYearEnd,
          )
        )
          throw new DuplicateKeyError();
        s.periodCloses.set(c.id, { ...c, createdAt: NOW });
        const o = s.orgs.get(c.orgId);
        if (o) s.orgs.set(c.orgId, { ...o, booksLockedThrough: lockThrough });
        afterAudit(audit);
      },
    },
    projects: {
      async list(orgId) {
        return [...s.projects.values()]
          .filter((p) => p.orgId === orgId)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    },
    catalog: {
      async list(orgId, kind) {
        const own = [...s.catalog.values()].filter((c) => c.orgId === orgId && c.kind === kind);
        if (kind === "project")
          for (const p of s.projects.values())
            if (p.orgId === orgId && !s.catalog.has(p.id))
              own.push({
                id: p.id,
                orgId,
                kind,
                name: p.name,
                categoryType: null,
                isRestricted: false,
                budgetCents: p.budgetCents,
                status: p.status,
              });
        return own.sort((a, b) => a.name.localeCompare(b.name));
      },
      async create(item, audit) {
        guardAudit(audit);
        s.catalog.set(item.id, { ...item });
        if (item.kind === "project")
          s.projects.set(item.id, {
            id: item.id,
            orgId: item.orgId,
            name: item.name,
            budgetCents: item.budgetCents,
            status: item.status,
          });
        afterAudit(audit);
      },
      async setRestricted(orgId, fundId, isRestricted, audit) {
        const f = s.catalog.get(fundId);
        if (!f || f.orgId !== orgId || f.kind !== "fund") throw new Error("Fund not found.");
        guardAudit(audit);
        s.catalog.set(fundId, { ...f, isRestricted });
        afterAudit(audit);
      },
      async setActive(orgId, kind, id, active, audit) {
        const all = await this.list(orgId, kind);
        const item = all.find((c) => c.id === id);
        if (!item) throw new Error("Not found.");
        guardAudit(audit);
        const status = active ? "active" : "archived";
        s.catalog.set(id, { ...item, status });
        const p = s.projects.get(id);
        if (p) s.projects.set(id, { ...p, status });
        afterAudit(audit);
      },
    },
    pledges: {
      async list(orgId) {
        return [...s.pledges.values()]
          .filter((p) => p.orgId === orgId)
          .sort((a, b) => b.pledgeDate.localeCompare(a.pledgeDate));
      },
      async get(orgId, id) {
        const p = s.pledges.get(id);
        return p && p.orgId === orgId ? p : null;
      },
      async payments(orgId) {
        return s.pledgePayments.filter((p) => p.orgId === orgId);
      },
      async create(p, audit) {
        guardAudit(audit);
        s.pledges.set(p.id, { ...p });
        afterAudit(audit);
      },
      async addPayment(p, newStatus, audit) {
        guardAudit(audit);
        s.pledgePayments.push({ ...p });
        const pl = s.pledges.get(p.pledgeId);
        if (pl && newStatus) s.pledges.set(pl.id, { ...pl, status: newStatus });
        afterAudit(audit);
      },
    },
    templates: {
      async list(orgId) {
        return [...s.templates.values()]
          .filter((t) => t.orgId === orgId)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      async get(orgId, id) {
        const t = s.templates.get(id);
        return t && t.orgId === orgId ? t : null;
      },
      async save(t, audit) {
        guardAudit(audit);
        s.templates.set(t.id, { ...t, lines: t.lines.map((l) => ({ ...l })) });
        afterAudit(audit);
      },
      async occurrences(orgId) {
        return s.occurrences.filter((o) => o.orgId === orgId);
      },
      async recordOccurrence(o, nextDue, audit) {
        if (s.occurrences.some((x) => x.templateId === o.templateId && x.dueDate === o.dueDate))
          return false;
        guardAudit(audit);
        s.occurrences.push({ ...o });
        const t = s.templates.get(o.templateId);
        if (t) s.templates.set(t.id, { ...t, nextDue });
        afterAudit(audit);
        return true;
      },
      async getMode(orgId) {
        return s.recurringModes.get(orgId) ?? "drafts";
      },
      async setMode(orgId, mode, audit) {
        guardAudit(audit);
        s.recurringModes.set(orgId, mode);
        afterAudit(audit);
      },
    },
    budgets: {
      async list(orgId, periodType, periodStart) {
        return [...s.budgets.values()].filter(
          (b) => b.orgId === orgId && b.periodType === periodType && b.periodStart === periodStart,
        );
      },
      async set(b, audit) {
        guardAudit(audit);
        const same = [...s.budgets.values()].find(
          (x) =>
            x.orgId === b.orgId &&
            x.accountId === b.accountId &&
            x.fundId === b.fundId &&
            x.projectId === b.projectId &&
            x.periodType === b.periodType &&
            x.periodStart === b.periodStart,
        );
        if (b.amountCents === null) {
          if (same) s.budgets.delete(same.id);
        } else if (same) s.budgets.set(same.id, { ...same, amountCents: b.amountCents });
        else s.budgets.set(b.id, { ...b, amountCents: b.amountCents });
        afterAudit(audit);
      },
    },
    audit: {
      async append(e) {
        if (s.failAudit) throw new Error("history unavailable");
        pushAudit(e);
      },
      async listFor(orgId, entity, entityId, limit = 50) {
        return s.audit
          .filter((a) => a.orgId === orgId && a.entity === entity && a.entityId === entityId)
          .reverse()
          .slice(0, limit)
          .map((a) => ({ action: a.action, at: a.at, after: (a.after ?? null) as JsonValue }));
      },
    },
  };
}
