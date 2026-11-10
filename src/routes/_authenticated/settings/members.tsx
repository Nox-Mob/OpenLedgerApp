import { OrgPending } from "@/components/AppShell";
import { showError } from "@/lib/show-error";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOrgContext } from "@/hooks/use-org-context";
import { listOrgMembers, updateMemberRole } from "@/lib/org.functions";
import {
  createInvite,
  deleteOrganization,
  getOrgOwner,
  listInvites,
  removeMember,
  revokeInvite,
  transferOwnership,
} from "@/lib/members.functions";
import { inviteUrl } from "@/lib/invite-link";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/members")({
  head: () => ({
    meta: [
      { title: "Users & Roles - OpenLedgerApp" },
      {
        name: "description",
        content: "Manage who belongs to the organization and what they can do.",
      },
      { property: "og:title", content: "Users & Roles - OpenLedgerApp" },
      {
        property: "og:description",
        content: "Manage who belongs to the organization and what they can do.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MembersSettings,
});

type RoleName = "admin" | "treasurer" | "member" | "viewer";

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access, including settings and roles",
  treasurer: "Keeps the books, closes the year, no settings or people",
  member: "Can record and edit transactions",
  viewer: "Can look, but not change anything",
};

/** What each role can do, in plain words. Mirrors CAPABILITIES in src/lib/permissions.ts. */
const ROLE_DETAILS: { role: RoleName; label: string; can: string[] }[] = [
  {
    role: "member",
    label: "Member",
    can: [
      "See every page and report",
      "Record transactions, import bank files and check statements",
      "Cannot change settings, invite people or close the year",
    ],
  },
  {
    role: "treasurer",
    label: "Treasurer",
    can: [
      "Everything a member can do",
      "Close the year, lock the books and reopen finished statement checks",
      "Cannot change settings, invite people or change roles",
    ],
  },
  {
    role: "admin",
    label: "Admin",
    can: [
      "Everything a member can do",
      "Everything a treasurer can do",
      "Change settings and accounts, invite and remove people",
    ],
  },
  {
    role: "viewer",
    label: "View only",
    can: ["See every page and report, and export them", "Cannot record, import or change anything"],
  },
];

const selectCls = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const btnCls =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

function MembersSettings() {
  // Hosted, people and ownership are managed in OpenAppHub (SHARED-SPEC §1.1).
  const hosted = isHosted();
  const { org } = useOrgContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [inviteRole, setInviteRole] = useState<RoleName>("member");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = org?.role === "admin";
  const { data: members } = useQuery({
    queryKey: ["org-members", org?.id],
    queryFn: () => listOrgMembers({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const { data: owner } = useQuery({
    queryKey: ["org-owner", org?.id],
    queryFn: () => getOrgOwner({ data: { orgId: org!.id } }),
    enabled: !!org,
  });
  const { data: invites } = useQuery({
    queryKey: ["org-invites", org?.id],
    queryFn: () => listInvites({ data: { orgId: org!.id } }),
    enabled: !!org && isAdmin,
  });

  if (!org) return <OrgPending inShell={false} />;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["org-members", org.id] });
    queryClient.invalidateQueries({ queryKey: ["org-invites", org.id] });
    queryClient.invalidateQueries({ queryKey: ["org-owner", org.id] });
  };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (err) {
      showError(err, "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function makeInvite() {
    setBusy(true);
    try {
      const res = await createInvite({ data: { orgId: org!.id, role: inviteRole, days: 7 } });
      const url = inviteUrl(res.token);
      setNewLink(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Invite link created and copied");
      refresh();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const otherAdmins = (members ?? []).filter((m) => m.role === "admin" && !m.isYou);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">Users & roles</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who can see this organization's books.
          {!isAdmin && " Only admins can change roles."}
        </p>
        <ul className="mt-4 divide-y">
          {(members ?? []).map((m) => {
            const isOwner = owner?.ownerId === m.userId;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium">
                    {m.displayName ?? (m.isYou ? "You" : "Member")}
                    {m.isYou && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    {isOwner && (
                      <span className="ml-2 rounded border px-1.5 py-0.5 text-xs">Owner</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[m.role]}</div>
                </div>
                <div className="flex items-center gap-3">
                  {isAdmin && !m.isYou ? (
                    <select
                      aria-label="Role"
                      className={selectCls}
                      value={m.role}
                      onChange={(e) =>
                        run(
                          () =>
                            updateMemberRole({
                              data: {
                                orgId: org.id,
                                userId: m.userId,
                                role: e.target.value as RoleName,
                              },
                            }),
                          "Role updated",
                        )
                      }
                    >
                      <option value="admin">Admin</option>
                      <option value="treasurer">Treasurer</option>
                      <option value="member">Member</option>
                      <option value="viewer">View only</option>
                    </select>
                  ) : (
                    <span className="rounded-md border border-border px-2 py-1 text-xs font-medium capitalize">
                      {m.role}
                    </span>
                  )}
                  {isAdmin && !m.isYou && !isOwner && (
                    <button
                      disabled={busy}
                      className="text-xs font-medium text-destructive hover:underline"
                      onClick={() => {
                        if (!confirm("Remove this person? Their past work stays in the history."))
                          return;
                        void run(
                          () => removeMember({ data: { orgId: org.id, userId: m.userId } }),
                          "Member removed",
                        );
                      }}
                    >
                      Remove
                    </button>
                  )}
                  {m.isYou && !isOwner && (
                    <button
                      disabled={busy}
                      className="text-xs font-medium text-destructive hover:underline"
                      onClick={async () => {
                        if (!confirm("Leave this organization? You will lose access to its books."))
                          return;
                        const ok = await run(
                          () => removeMember({ data: { orgId: org.id, userId: m.userId } }),
                          "You left the organization",
                        );
                        if (ok) {
                          await queryClient.invalidateQueries();
                          void navigate({ to: "/ledger" });
                        }
                      }}
                    >
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {hosted && isAdmin && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Invitations and ownership</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inviting people, transferring ownership and deleting the organization are done in
            OpenAppHub, for every app at once.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
            <a href={hubUrl("/members")} className="text-primary hover:underline">
              Members and invitations
            </a>
            <a href={hubUrl("/settings")} className="text-primary hover:underline">
              Organization settings
            </a>
          </div>
        </div>
      )}

      {isAdmin && !hosted && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Invite someone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a link and send it however you like. Each link works once and expires in 7 days.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label="Invite role"
              className={selectCls}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as RoleName)}
            >
              <option value="member">Member</option>
              <option value="viewer">View only</option>
              <option value="treasurer">Treasurer</option>
              <option value="admin">Admin</option>
            </select>
            <button disabled={busy} className={btnCls} onClick={makeInvite}>
              Create invite link
            </button>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            {ROLE_DETAILS.map((r) => (
              <div
                key={r.role}
                className={`rounded-md border p-3 text-sm ${inviteRole === r.role ? "border-primary bg-accent/40" : ""}`}
              >
                <dt className="font-semibold">{r.label}</dt>
                <dd>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                    {r.can.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
          {newLink && (
            <div className="mt-3 rounded-md border bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">
                Copy this link now. For security it will not be shown again.
              </div>
              <div className="mt-1 flex gap-2">
                <input readOnly value={newLink} className="w-full bg-transparent text-sm" />
                <button
                  className="text-xs font-medium text-primary"
                  onClick={() => navigator.clipboard?.writeText(newLink)}
                >
                  Copy
                </button>
              </div>
            </div>
          )}
          {(invites ?? []).length > 0 && (
            <ul className="mt-4 divide-y text-sm">
              {(invites ?? []).map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="capitalize">{i.role}</span> link, created{" "}
                    {i.createdAt.slice(0, 10)}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs capitalize">{i.status}</span>
                    {i.status === "active" && (
                      <button
                        className="text-xs font-medium text-destructive hover:underline"
                        onClick={() =>
                          run(
                            () => revokeInvite({ data: { orgId: org.id, inviteId: i.id } }),
                            "Invite revoked",
                          )
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {owner?.isOwner && !hosted && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Transfer ownership</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hand the organization to another admin. You stay an admin.
          </p>
          {otherAdmins.length === 0 ? (
            <p className="mt-3 text-sm">Make someone else an admin first.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                aria-label="New owner"
                className={selectCls}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              >
                <option value="">Choose an admin</option>
                {otherAdmins.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName ?? "Admin"}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !transferTo}
                className={btnCls}
                onClick={() =>
                  run(
                    () => transferOwnership({ data: { orgId: org.id, toUserId: transferTo } }),
                    "Ownership transferred",
                  )
                }
              >
                Transfer
              </button>
            </div>
          )}
        </div>
      )}

      {owner?.isOwner && !hosted && (
        <div className="rounded-lg border border-destructive/50 bg-card p-5">
          <h2 className="font-display text-lg font-semibold text-destructive">
            Delete organization
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently erases {org.name} and all of its books for everyone. This cannot be undone.
            Type the organization name to confirm.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              aria-label="Confirm organization name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={org.name}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              disabled={busy || confirmName.trim() !== org.name.trim()}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
              onClick={async () => {
                const ok = await run(
                  () => deleteOrganization({ data: { orgId: org.id, confirmName } }),
                  "Organization deleted",
                );
                if (ok) {
                  await queryClient.invalidateQueries();
                  void navigate({ to: "/ledger" });
                }
              }}
            >
              Delete forever
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
