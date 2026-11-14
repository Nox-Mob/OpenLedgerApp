import { desktopAware } from "@/lib/desktop/bridge";
import type { Db } from "@/lib/db";
// Member lifecycle on the OpenAppHub core: invitation links, remove/leave, transfer
// ownership, delete organization. Memberships, invitations and ownership are core
// (schema public, SHARED-SPEC §4); Ledger adds the treasurer overlay and its history.
// Each handler acts as the signed-in user, so the core's own rules apply.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCan, type OrgRole } from "./permissions";
import {
  assertCanDeleteOrg,
  assertCanRemove,
  accountDeletionBlocker,
  assertCanTransfer,
  inviteStatus,
  type MemberRef,
} from "./domain/members";
import { auditedWrite } from "./audited-write";
import { coreRoleFor, loadMembers, ledgerRole, type CoreRole } from "./core-org";

const uuid = z.string().uuid();

async function orgMembers(supabase: Db, orgId: string) {
  const members = await loadMembers(supabase, orgId);
  const owner = members.find((m) => m.coreRole === "owner");
  const refs: MemberRef[] = members.map((m) => ({ userId: m.userId, role: m.role }));
  return { refs, ownerId: owner?.userId ?? "" };
}

async function orgRow(supabase: Db, orgId: string) {
  const { data, error } = await supabase
    .schema("public")
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Organization not found.");
  return data as { id: string; name: string };
}

const getOrgOwnerCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { ownerId } = await orgMembers(context.supabase, data.orgId);
    return { ownerId, isOwner: ownerId === context.userId };
  });
export const getOrgOwner = desktopAware("getOrgOwner", getOrgOwnerCloud);

// ---------- Invites ----------

const listInvitesCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_members");
    // Core invitations (owner/admin read); Ledger's role is the core role plus the overlay.
    const { data: rows, error } = await context.supabase
      .schema("public")
      .from("invitations")
      .select("id, role, app, app_payload, expires_at, accepted_at, revoked_at, created_at")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? [])
      .filter((r) => r.role !== null)
      .map((r) => {
        const payload = (r.app_payload ?? {}) as { ledger_role?: string };
        const treasurer = r.app === "ledger" && payload.ledger_role === "treasurer";
        return {
          id: r.id as string,
          role: (ledgerRole(r.role as CoreRole, treasurer) ?? "member") as string,
          expiresAt: r.expires_at as string,
          createdAt: r.created_at as string,
          status: inviteStatus({
            expiresAt: r.expires_at,
            usedAt: r.accepted_at,
            revokedAt: r.revoked_at,
          }),
        };
      });
  });
export const listInvites = desktopAware("listInvites", listInvitesCloud);

const createInviteCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: uuid,
        role: z.enum(["admin", "treasurer", "member", "viewer"]),
        days: z.number().int().min(1).max(30).default(7),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_members");
    // A core invitation link (no email): anyone with the link can join once. H-09: they join
    // OpenAppHub as a member with this role in Ledger only; a treasurer is a Ledger member and
    // ledger.on_invitation_accepted adds the overlay.
    const ledgerRole = coreRoleFor(data.role as OrgRole);
    const invite = async (hubRole: typeof ledgerRole) => {
      const { data: rows, error } = await context.supabase
        .schema("public")
        .rpc("create_invitation", {
          p_org: data.orgId,
          p_email: "",
          p_role: hubRole,
          p_app: "ledger",
          p_payload: data.role === "treasurer" ? { ledger_role: "treasurer" } : {},
          p_days: data.days,
        });
      if (error) throw new Error(error.message);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error("Couldn't create the invite.");
      return row;
    };
    let row = await invite("member");
    // set_invitation_roles isn't in the generated types until they're regenerated (H-06).
    const pub = context.supabase.schema("public") as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ error: { code?: string; message: string } | null }>;
    };
    const { error: rolesError } = await pub.rpc("set_invitation_roles", {
      p_invitation: row.invitation_id,
      p_named_role: null,
      p_app_roles: { ledger: ledgerRole },
    });
    if (rolesError) {
      // A database before core 0011: the role was the OpenAppHub role then.
      if (rolesError.code !== "PGRST202" && !/set_invitation_roles/.test(rolesError.message))
        throw new Error(rolesError.message);
      await context.supabase
        .schema("public")
        .rpc("revoke_invitation", { p_id: row.invitation_id as string });
      row = await invite(ledgerRole);
    }
    const expiresAt = new Date(Date.now() + data.days * 86400000).toISOString();
    // The raw token is returned once and never stored.
    return { id: row.invitation_id as string, token: row.token as string, expiresAt };
  });
export const createInvite = desktopAware("createInvite", createInviteCloud);

const revokeInviteCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid, inviteId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCan(context.supabase, context.userId, data.orgId, "manage_members");
    const { error } = await context.supabase
      .schema("public")
      .rpc("revoke_invitation", { p_id: data.inviteId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const revokeInvite = desktopAware("revokeInvite", revokeInviteCloud);

const acceptInviteCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ token: z.string().min(16).max(100) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: info } = await db.schema("public").rpc("get_invitation", { p_token: data.token });
    const invite = Array.isArray(info) ? info[0] : info;
    if (!invite) throw new Error("This invite link is not valid.");
    const orgName = invite.org_name ?? "the organization";
    // Core accepts it once, for this user, and adds the membership (existing members
    // keep their role); then Ledger applies the treasurer overlay if the link has one.
    const { data: accepted, error } = await db
      .schema("public")
      .rpc("accept_invitation", { p_token: data.token });
    if (error) throw new Error(error.message);
    const row = Array.isArray(accepted) ? accepted[0] : accepted;
    if (!row) throw new Error("This invite link is not valid.");
    if (row.app === "ledger") {
      const { error: overlayError } = await db.rpc("on_invitation_accepted", {
        p_invitation_id: row.id,
      });
      if (overlayError) throw new Error(overlayError.message);
    }
    return { orgId: row.org_id as string, orgName, alreadyMember: false };
  });
export const acceptInvite = desktopAware("acceptInvite", acceptInviteCloud);

// ---------- Remove, leave, transfer, delete ----------

const removeMemberCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orgId: uuid, userId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const leaving = data.userId === userId;
    await assertCan(supabase, userId, data.orgId, leaving ? "read" : "manage_members");
    const { refs, ownerId } = await orgMembers(supabase, data.orgId);
    assertCanRemove(refs, data.userId, ownerId);
    // Ledger's overlay and history first (service role, so someone leaving can clear
    // their own treasurer role), then the core membership as the signed-in user.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await auditedWrite(
      supabaseAdmin,
      data.orgId,
      [{ table: "member_roles", op: "delete", match: { user_id: data.userId } }],
      {
        action: leaving ? "leave" : "remove",
        entity: "user_role",
        entityId: data.userId,
        before: { role: refs.find((m) => m.userId === data.userId)?.role },
        kind: "system",
      },
      userId,
    );
    const { error } = await supabase
      .schema("public")
      .from("memberships")
      // cloud-only-write: core membership (schema public), not organization books
      .delete()
      .eq("org_id", data.orgId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const removeMember = desktopAware("removeMember", removeMemberCloud);

const transferOwnershipCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ orgId: uuid, toUserId: uuid, reauth: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { refs, ownerId } = await orgMembers(supabase, data.orgId);
    assertCanTransfer(refs, userId, ownerId, data.toUserId);
    // Core swaps the roles: the new owner becomes owner, the old owner an admin. It uses the
    // one-time pass from "Confirm it's you" (core 0019).
    const { error } = await supabase.schema("public").rpc("transfer_ownership", {
      p_org: data.orgId,
      p_new_owner: data.toUserId,
      p_reauth: data.reauth,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const transferOwnership = desktopAware("transferOwnership", transferOwnershipCloud);

const deleteOrganizationCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        orgId: uuid,
        confirmName: z.string().max(200),
        reauth: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [org, { ownerId }] = await Promise.all([
      orgRow(supabase, data.orgId),
      orgMembers(supabase, data.orgId),
    ]);
    assertCanDeleteOrg(userId, ownerId, org.name, data.confirmName);
    // Ledger keeps a record that outlives the org, then core deletes it and
    // everything that belongs to it.
    const { error: logError } = await supabase.rpc("log_org_deletion", { p_org: org.id });
    if (logError) throw new Error(logError.message);
    const { error } = await supabase.schema("public").rpc("delete_organization", {
      p_org: org.id,
      p_confirm_name: org.name,
      p_reauth: data.reauth,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const deleteOrganization = desktopAware("deleteOrganization", deleteOrganizationCloud);

// ---------- Delete my account ----------

const getMyAccountDeletionCloud = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return {
      blocker: accountDeletionBlocker(await myMemberships(context.supabase, context.userId)),
    };
  });
export const getMyAccountDeletion = desktopAware("getMyAccountDeletion", getMyAccountDeletionCloud);

async function myMemberships(supabase: Db, userId: string) {
  const { data, error } = await supabase
    .schema("public")
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return Promise.all(
    (data ?? []).map(async (r) => {
      const members = await loadMembers(supabase, r.org_id);
      return {
        orgId: r.org_id,
        orgName: r.organizations?.name ?? "an organization",
        role: ledgerRole(r.role as CoreRole, false) as OrgRole,
        isOwner: r.role === "owner",
        adminCount: members.filter((m) => m.role === "admin").length,
      };
    }),
  );
}

const deleteMyAccountCloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({ confirm: z.literal("DELETE"), reauth: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const memberships = await myMemberships(supabase, userId);
    const blocker = accountDeletionBlocker(memberships);
    if (blocker) throw new Error(blocker);
    // The one-time pass from "Confirm it's you" (core 0019), used as the person themselves.
    const { error: reauthError } = await supabase
      .schema("public")
      .rpc("use_reauth", { p_action: "delete_account", p_token: data.reauth });
    if (reauthError) throw new Error(reauthError.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // A history entry in each organization, then remove the sign-in account (its
    // core memberships go with it).
    for (const m of memberships) {
      await auditedWrite(
        supabaseAdmin,
        m.orgId,
        [{ table: "member_roles", op: "delete", match: { user_id: userId } }],
        {
          action: "account_deleted",
          entity: "user_role",
          entityId: userId,
          before: { role: m.role },
          kind: "system",
        },
        userId,
      );
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const deleteMyAccount = desktopAware("deleteMyAccount", deleteMyAccountCloud);
