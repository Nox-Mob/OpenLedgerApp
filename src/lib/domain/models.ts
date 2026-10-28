// Storage-agnostic domain models. camelCase, cents as integers, dates as YYYY-MM-DD.
// No Supabase/PostgREST or SQLite types may appear here or in src/lib/ports/.

export type Id = string;
export type IsoDate = string; // YYYY-MM-DD in org timezone
export type IsoTimestamp = string;

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type OrgType = "nonprofit" | "business";
export type Role = "admin" | "treasurer" | "member" | "viewer";
export type TransactionSource =
  | "manual"
  | "import"
  | "opening_balance"
  | "adjustment"
  | "transfer"
  | "closing"
  | "release"
  | "pledge";
export type TransactionStatus = "posted" | "void";
export type ReconcileMode = "simple" | "full";
export type ReconcileStatus = "in_progress" | "completed";

export interface Organization {
  id: Id;
  name: string;
  orgType: OrgType;
  currency: string;
  fiscalYearStartMonth: number;
  timezone: string;
  terminology: string;
  termOverrides: Record<string, string>;
  aiPdfEnabled: boolean;
  booksLockedThrough: IsoDate | null;
  createdBy: Id;
  createdAt: IsoTimestamp;
}

export interface Member {
  userId: Id;
  orgId: Id;
  role: Role;
  displayName: string | null;
}

export interface Account {
  id: Id;
  orgId: Id;
  name: string;
  type: AccountType;
  subtype: string | null;
  isActive: boolean;
  createdAt: IsoTimestamp;
}

export interface Entry {
  id: Id;
  transactionId: Id;
  accountId: Id;
  amountCents: number; // >0 debit, <0 credit
  categoryId: Id | null;
  projectId: Id | null;
  fundId: Id | null;
  memo: string | null;
  reconciliationId: Id | null;
}

export interface Transaction {
  id: Id;
  orgId: Id;
  transactionDate: IsoDate;
  postedDate: IsoDate | null;
  description: string;
  source: TransactionSource;
  status: TransactionStatus;
  createdBy: Id | null;
  idempotencyKey: string | null;
  createdAt: IsoTimestamp;
  entries: Entry[];
  tagIds: Id[];
}

export interface BankTransaction {
  id: Id;
  orgId: Id;
  accountId: Id;
  bankDate: IsoDate;
  description: string;
  amountCents: number;
  externalId: string | null;
  fingerprint: string;
  rowSeq: number | null;
  batchId: Id | null;
  transactionId: Id | null;
  needsReview: boolean;
}

export interface Reconciliation {
  id: Id;
  orgId: Id;
  accountId: Id;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  beginningBalanceCents: number;
  endingBalanceCents: number;
  mode: ReconcileMode;
  status: ReconcileStatus;
  batchId: Id | null;
  completedBy: Id | null;
  completedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp | null;
}

export interface AuditEvent {
  orgId: Id;
  userId: Id;
  action: string;
  entity: string;
  entityId?: Id | null;
  before?: unknown;
  after?: unknown;
}

export interface PeriodClose {
  id: Id;
  orgId: Id;
  fiscalYearEnd: IsoDate;
  netIncomeCents: number;
  closedBy: Id;
  createdAt: IsoTimestamp;
}

export interface Project {
  id: Id;
  orgId: Id;
  name: string;
  budgetCents: number;
  status: string;
}

/** Latest imported statement for an account (used to prefill a statement check). */
export interface StatementInfo {
  batchId: Id;
  statementStart: IsoDate | null;
  statementEnd: IsoDate;
  beginningBalanceCents: number | null;
  endingBalanceCents: number | null;
}

/** An entry line as a statement check sees it. */
export interface ReconEntry {
  id: Id;
  transactionId: Id;
  date: IsoDate;
  description: string;
  amountCents: number;
  reconciliationId: Id | null;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AuditRecord {
  action: string;
  at: IsoTimestamp;
  after: JsonValue;
}

/** Labels used to sort and group entries. Names are unique per organization and kind. */
export type CatalogKind = "category" | "tag" | "fund" | "project";

export interface CatalogItem {
  id: Id;
  orgId: Id;
  kind: CatalogKind;
  name: string;
  /** Categories only. */
  categoryType: "revenue" | "expense" | null;
  /** Funds only. */
  isRestricted: boolean;
  /** Projects only. */
  budgetCents: number;
  status: string;
}

export interface Pledge {
  id: Id;
  orgId: Id;
  donorName: string;
  fundId: Id | null;
  amountCents: number;
  pledgeDate: IsoDate;
  expectedDate: IsoDate | null;
  note: string | null;
  transactionId: Id;
  status: "open" | "paid" | "written_off";
  createdBy: Id | null;
}

export interface PledgePayment {
  id: Id;
  orgId: Id;
  pledgeId: Id;
  transactionId: Id;
  kind: "payment" | "write_off";
  amountCents: number;
  paidDate: IsoDate;
}
