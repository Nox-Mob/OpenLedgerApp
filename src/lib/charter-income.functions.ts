// S-18 / L-17: OpenCharterApp payments into the books, always reviewed first. Cloud only (the
// desktop edition has no OpenCharterApp). The database lists drafts and records decisions
// (migration 0011); posting goes through the usual transaction service.
import { createServerFn } from "@tanstack/react-start";
import { desktopAware } from "@/lib/desktop/bridge";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan } from "./permissions";
import { createSupabaseRepositories } from "./adapters/supabase";
import { postTransaction, voidTransaction } from "./services/ledger";
import {
  draftDescription,
  draftEntries,
  draftKey,
  type CharterDraft,
  type CharterImportConfig,
} from "./services/charter-income";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc = (sb: SupabaseClient | unknown) =>
  (sb as SupabaseClient).schema("ledger").rpc as unknown as Rpc;

async function call<T>(sb: unknown, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(sb)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const getCharterImportConfigCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    try {
      return await call<CharterImportConfig>(context.supabase, "charter_import_config", {
        p_org: data.orgId,
      });
    } catch {
      // A database without migration 0011: nothing to show.
      return null;
    }
  });

const configIn = z.object({
  orgId: uuid,
  enabled: z.boolean(),
  scope: z.enum(["national", "all"]),
  starts_on: isoDate,
  card_account_id: uuid.nullable(),
  other_account_id: uuid.nullable(),
  fee_account_id: uuid.nullable(),
  join_account_id: uuid.nullable(),
  renew_account_id: uuid.nullable(),
  fee_percent_bp: z.number().int().min(0).max(2000),
  fee_fixed_cents: z.number().int().min(0).max(1000),
});

const saveCharterImportConfigCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => configIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_settings");
    const { orgId, ...p } = data;
    await call(context.supabase, "save_charter_import_config", { p_org: orgId, p });
    return { ok: true as const };
  });

async function drafts(sb: unknown, orgId: string): Promise<CharterDraft[]> {
  const rows = await call<CharterDraft[] | null>(sb, "charter_drafts", { p_org: orgId });
  return (rows ?? []).map((r) => ({
    ...r,
    gross_cents: Number(r.gross_cents),
    fee_cents: Number(r.fee_cents),
    lines: (r.lines ?? []).map((l) => ({ ...l, cents: Number(l.cents) })),
  }));
}

const listCharterDraftsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    try {
      return await drafts(context.supabase, data.orgId);
    } catch {
      return [];
    }
  });

const draftIn = z.object({
  orgId: uuid,
  day: isoDate,
  channel: z.enum(["card", "other"]),
  kind: z.enum(["payments", "refunds"]),
  paymentIds: z.array(uuid).min(1).max(5000),
  feeCents: z.number().int().min(0).optional(),
});

/** The draft as the database has it now, matched to the one the reviewer saw. */
async function current(sb: unknown, d: z.infer<typeof draftIn>): Promise<CharterDraft> {
  const all = await drafts(sb, d.orgId);
  const hit = all.find((x) => x.day === d.day && x.channel === d.channel && x.kind === d.kind);
  const same =
    hit &&
    hit.payment_ids.length === d.paymentIds.length &&
    d.paymentIds.every((id) => hit.payment_ids.includes(id));
  if (!hit || !same)
    throw new Error("This draft changed in OpenCharterApp. Refresh to see it as it is now.");
  return hit;
}

const postCharterDraftCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => draftIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    const cfg = await call<CharterImportConfig>(context.supabase, "charter_import_config", {
      p_org: data.orgId,
    });
    const d = await current(context.supabase, data);
    const fee = d.kind === "payments" && d.channel === "card" ? (data.feeCents ?? d.fee_cents) : 0;
    const repos = createSupabaseRepositories(context.supabase);
    const posted = await postTransaction(repos, {
      orgId: data.orgId,
      userId: context.userId,
      transactionDate: d.day,
      postedDate: null,
      description: draftDescription(d),
      source: "import",
      entries: draftEntries(d, cfg, fee).map((e) => ({
        accountId: e.accountId,
        amountCents: e.amountCents,
        categoryId: null,
        projectId: null,
        fundId: null,
        memo: e.memo,
      })),
      idempotencyKey: draftKey(d, d.gross_cents),
    });
    try {
      await call(context.supabase, "record_charter_import", {
        p_org: data.orgId,
        p_day: d.day,
        p_channel: d.channel,
        p_kind: d.kind,
        p_status: "posted",
        p_payment_ids: d.payment_ids,
        p_transaction_id: posted.id,
        p_fee_cents: fee,
      });
    } catch (e) {
      // Someone else covered these payments first: take this transaction back out.
      if (!posted.duplicate)
        await voidTransaction(repos, {
          orgId: data.orgId,
          userId: context.userId,
          transactionId: posted.id,
        }).catch(() => undefined);
      throw e;
    }
    return { id: posted.id };
  });

const skipCharterDraftCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => draftIn.parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    const d = await current(context.supabase, data);
    await call(context.supabase, "record_charter_import", {
      p_org: data.orgId,
      p_day: d.day,
      p_channel: d.channel,
      p_kind: d.kind,
      p_status: "skipped",
      p_payment_ids: d.payment_ids,
      p_transaction_id: null,
      p_fee_cents: 0,
    });
    return { ok: true as const };
  });

export type CharterImportRow = {
  id: string;
  day: string;
  channel: "card" | "other";
  kind: "payments" | "refunds";
  status: "posted" | "skipped";
  transaction_id: string | null;
  payment_count: number;
  gross_cents: number;
  fee_cents: number;
  decided_at: string;
};

const listCharterImportsCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "read");
    const { data: rows, error } = await (context.supabase as unknown as SupabaseClient)
      .schema("ledger")
      .from("charter_imports")
      .select(
        "id, day, channel, kind, status, transaction_id, payment_count, gross_cents, fee_cents, decided_at",
      )
      .eq("org_id", data.orgId)
      .order("decided_at", { ascending: false })
      .limit(50);
    if (error) return [];
    return ((rows ?? []) as CharterImportRow[]).map((r) => ({
      ...r,
      gross_cents: Number(r.gross_cents),
      fee_cents: Number(r.fee_cents),
    }));
  });

const reopenCharterImportCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid, id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "write");
    await call(context.supabase, "reopen_charter_import", { p_org: data.orgId, p_id: data.id });
    return { ok: true as const };
  });

// Wrapped like every server function; the desktop edition never calls these (no OpenCharterApp).
export const getCharterImportConfig = desktopAware(
  "getCharterImportConfig",
  getCharterImportConfigCloud,
);
export const saveCharterImportConfig = desktopAware(
  "saveCharterImportConfig",
  saveCharterImportConfigCloud,
);
export const listCharterDrafts = desktopAware("listCharterDrafts", listCharterDraftsCloud);
export const postCharterDraft = desktopAware("postCharterDraft", postCharterDraftCloud);
export const skipCharterDraft = desktopAware("skipCharterDraft", skipCharterDraftCloud);
export const listCharterImports = desktopAware("listCharterImports", listCharterImportsCloud);
export const reopenCharterImport = desktopAware("reopenCharterImport", reopenCharterImportCloud);
