// Repository ports: the only way application code may read or write ledger data.
// Adapters (Supabase/Postgres now, SQLite/Tauri later) implement these.
// Contract for every adapter:
// - Callers pass app-generated IDs (newId()); adapters never invent IDs.
// - Callers run src/lib/domain rules first; adapters may also enforce them (DB triggers).
// - Adapters throw on storage errors; `DuplicateKeyError` signals an idempotency/unique hit.
// - Every method is scoped by orgId; cloud adapters additionally rely on RLS.

import type {
  Account,
  AccountType,
  AuditEvent,
  AuditRecord,
  CatalogItem,
  CatalogKind,
  Pledge,
  PledgePayment,
  BankTransaction,
  Id,
  IsoDate,
  Member,
  Organization,
  PeriodClose,
  Project,
  Reconciliation,
  ReconEntry,
  ReconcileMode,
  Role,
  Transaction,
  StatementInfo,
  TransactionSource,
} from "../domain/models";
import type { Occurrence, RecurringMode, TransactionTemplate } from "../domain/templates";

export class DuplicateKeyError extends Error {
  constructor(message = "Duplicate key") {
    super(message);
    this.name = "DuplicateKeyError";
  }
}

export interface OrgRepository {
  get(orgId: Id): Promise<Organization | null>;
  listForUser(userId: Id): Promise<(Organization & { role: Role })[]>;
  create(org: Omit<Organization, "createdAt">): Promise<void>;
  updateSettings(
    orgId: Id,
    patch: Partial<
      Pick<
        Organization,
        | "name"
        | "orgType"
        | "currency"
        | "fiscalYearStartMonth"
        | "timezone"
        | "terminology"
        | "termOverrides"
        | "aiPdfEnabled"
      >
    >,
    audit?: AuditEvent,
  ): Promise<void>;
  /** Audited methods: with `audit`, the change and its history entry are saved atomically. */
  setBooksLockedThrough(orgId: Id, date: IsoDate | null, audit?: AuditEvent): Promise<void>;
  roleOf(userId: Id, orgId: Id): Promise<Role | null>;
  listMembers(orgId: Id): Promise<Member[]>;
}

export interface AccountRepository {
  list(orgId: Id, opts?: { includeArchived?: boolean }): Promise<Account[]>;
  getMany(orgId: Id, ids: Id[]): Promise<Account[]>;
  create(accounts: Omit<Account, "createdAt">[]): Promise<void>;
  rename(orgId: Id, id: Id, name: string): Promise<void>;
  setActive(orgId: Id, id: Id, isActive: boolean): Promise<void>;
  hasOpeningBalance(orgId: Id, accountId: Id): Promise<boolean>;
}

export interface NewTransaction {
  id: Id;
  orgId: Id;
  transactionDate: IsoDate;
  postedDate: IsoDate | null;
  description: string;
  source: Exclude<TransactionSource, "closing">;
  createdBy: Id;
  idempotencyKey: string | null;
  entries: {
    id: Id;
    accountId: Id;
    amountCents: number;
    categoryId?: Id | null | undefined;
    projectId?: Id | null | undefined;
    fundId?: Id | null | undefined;
    memo?: string | null | undefined;
  }[];
  tagIds?: Id[] | undefined;
}

export interface TransactionRepository {
  /**
   * Writes header + entries and, when given, its history entry in one atomic step:
   * if any part fails, nothing is kept. Throws DuplicateKeyError on idempotency hit.
   */
  post(tx: NewTransaction, audit?: AuditEvent): Promise<void>;
  findByIdempotencyKey(orgId: Id, key: string): Promise<Id | null>;
  get(orgId: Id, id: Id): Promise<Transaction | null>;
  list(
    orgId: Id,
    opts?: { accountId?: Id; from?: IsoDate; to?: IsoDate; limit?: number; includeVoid?: boolean },
  ): Promise<Transaction[]>;
  /** posted → void only. Returns false if it was already void (lost a race). */
  /** With `audit`, the void and its history entry are saved atomically. */
  markVoid(orgId: Id, id: Id, audit?: AuditEvent): Promise<boolean>;
  clearReconciliation(entryIds: Id[]): Promise<void>;
  /** Signed ledger rows for report math (posted only, legacy 'closing' excluded). */
  ledgerRows(
    orgId: Id,
    opts?: { to?: IsoDate },
  ): Promise<
    {
      amountCents: number;
      accountId: Id;
      transactionId: Id;
      description: string;
      accountName: string;
      accountType: AccountType;
      projectId: Id | null;
      fundId: Id | null;
      source: TransactionSource;
      transactionDate: IsoDate;
    }[]
  >;
}

export interface BankTransactionRepository {
  insertMany(
    rows: Omit<BankTransaction, "transactionId" | "needsReview">[],
  ): Promise<{ inserted: number; duplicates: number }>;
  get(orgId: Id, id: Id): Promise<BankTransaction | null>;
  listUnmatched(orgId: Id, accountId?: Id): Promise<BankTransaction[]>;
  /** Links only if still unlinked; false means someone else claimed it. */
  claim(orgId: Id, id: Id, transactionId: Id, audit?: AuditEvent): Promise<boolean>;
  unlinkTransaction(orgId: Id, transactionId: Id): Promise<number>;
  listInPeriod(orgId: Id, accountId: Id, from: IsoDate, to: IsoDate): Promise<BankTransaction[]>;
  latestStatement(orgId: Id, accountId: Id): Promise<StatementInfo | null>;
}

export interface ReconciliationRepository {
  start(
    r: {
      id: Id;
      orgId: Id;
      accountId: Id;
      periodStart: IsoDate;
      periodEnd: IsoDate;
      beginningBalanceCents: number;
      endingBalanceCents: number;
      mode: ReconcileMode;
      batchId: Id | null;
      createdBy: Id;
    },
    audit?: AuditEvent,
  ): Promise<void>;
  get(orgId: Id, id: Id): Promise<Reconciliation | null>;
  /** Lookup by id alone; the adapter's own scoping (RLS / single-tenant file) applies. */
  locate(id: Id): Promise<Reconciliation | null>;
  list(orgId: Id, accountId?: Id): Promise<Reconciliation[]>;
  /** Ticked-line count per reconciliation in the org. */
  itemCounts(orgId: Id): Promise<Record<Id, number>>;
  /** Posted entries on the account dated <= throughDate, unticked or ticked by this check. */
  workspaceEntries(
    accountId: Id,
    throughDate: IsoDate,
    reconciliationId: Id,
  ): Promise<ReconEntry[]>;
  /** Entries ticked by this check. */
  entriesOf(reconciliationId: Id): Promise<ReconEntry[]>;
  /** Ticks only unticked lines on the check's account; unticks only this check's lines. */
  setTicked(
    reconciliationId: Id,
    entryIds: Id[],
    ticked: boolean,
    audit?: AuditEvent,
  ): Promise<void>;
  clearedTotalCents(reconciliationId: Id): Promise<number>;
  finish(orgId: Id, id: Id, userId: Id, audit?: AuditEvent): Promise<void>;
  reopen(orgId: Id, id: Id, audit?: AuditEvent): Promise<void>;
  /** In-progress only: unticks its lines and removes it. */
  discard(orgId: Id, id: Id, audit?: AuditEvent): Promise<void>;
}

export interface PeriodCloseRepository {
  list(orgId: Id): Promise<PeriodClose[]>;
  find(orgId: Id, fiscalYearEnd: IsoDate): Promise<PeriodClose | null>;
  /** Throws DuplicateKeyError if that fiscal year is already closed. */
  create(c: Omit<PeriodClose, "createdAt">): Promise<void>;
  /**
   * Records the close and locks the books through `lockThrough` with its history entry,
   * all in one step. Throws DuplicateKeyError if that fiscal year is already closed.
   */
  closeAndLock(
    c: Omit<PeriodClose, "createdAt">,
    lockThrough: IsoDate,
    audit: AuditEvent,
  ): Promise<void>;
}

export interface ProjectRepository {
  list(orgId: Id): Promise<Project[]>;
}

export interface AuditRepository {
  /** Append-only. Cloud adapter writes with the service role. */
  append(event: AuditEvent): Promise<void>;
  listFor(orgId: Id, entity: string, entityId: Id, limit?: number): Promise<AuditRecord[]>;
}

export interface TemplateRepository {
  list(orgId: Id): Promise<TransactionTemplate[]>;
  get(orgId: Id, id: Id): Promise<TransactionTemplate | null>;
  /** Insert or update by id (app-generated, stable). */
  save(t: TransactionTemplate, audit?: AuditEvent): Promise<void>;
  occurrences(orgId: Id): Promise<Occurrence[]>;
  /**
   * Records one due date as posted/skipped and moves the template's next due date, in one step.
   * Returns false when that due date was already recorded (no change, no history).
   */
  recordOccurrence(o: Occurrence, nextDue: IsoDate | null, audit?: AuditEvent): Promise<boolean>;
  getMode(orgId: Id): Promise<RecurringMode>;
  setMode(orgId: Id, mode: RecurringMode, audit?: AuditEvent): Promise<void>;
}

export interface Budget {
  id: Id;
  orgId: Id;
  accountId: Id;
  fundId: Id | null;
  projectId: Id | null;
  periodType: "year" | "month";
  periodStart: IsoDate;
  amountCents: number;
}

export interface BudgetRepository {
  list(orgId: Id, periodType: Budget["periodType"], periodStart: IsoDate): Promise<Budget[]>;
  /** Updates the matching row in place (same id) or inserts it; null amount removes it. */
  set(
    b: Omit<Budget, "amountCents" | "id"> & { id: Id; amountCents: number | null },
    audit?: AuditEvent,
  ): Promise<void>;
}

export interface CatalogRepository {
  list(orgId: Id, kind: CatalogKind): Promise<CatalogItem[]>;
  /** Insert with an app-generated id; caller checks name rules first. */
  create(item: CatalogItem, audit?: AuditEvent): Promise<void>;
  setRestricted(orgId: Id, fundId: Id, isRestricted: boolean, audit?: AuditEvent): Promise<void>;
}

export interface PledgeRepository {
  list(orgId: Id): Promise<Pledge[]>;
  get(orgId: Id, id: Id): Promise<Pledge | null>;
  payments(orgId: Id): Promise<PledgePayment[]>;
  create(p: Pledge, audit?: AuditEvent): Promise<void>;
  /** Saves the payment and any status change together. */
  addPayment(
    p: PledgePayment,
    newStatus: Pledge["status"] | null,
    audit?: AuditEvent,
  ): Promise<void>;
}

/** Everything a request needs, built per request by the active adapter. */
export interface Repositories {
  orgs: OrgRepository;
  accounts: AccountRepository;
  transactions: TransactionRepository;
  bank: BankTransactionRepository;
  reconciliations: ReconciliationRepository;
  periodCloses: PeriodCloseRepository;
  projects: ProjectRepository;
  audit: AuditRepository;
  templates: TemplateRepository;
  budgets: BudgetRepository;
  catalog: CatalogRepository;
  pledges: PledgeRepository;
}
