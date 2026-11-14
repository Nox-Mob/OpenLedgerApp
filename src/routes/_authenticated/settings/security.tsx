import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { showError } from "@/lib/show-error";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ReauthDialog } from "@shared/ui/Reauth";
import { OrgTwoStepPanel, TwoStepSettings } from "@shared/ui/TwoStep";
import { appSaveRecoveryEmail, appSendCode } from "@/lib/security.functions";
import { useOrgContext } from "@/hooks/use-org-context";
import { errorMessage } from "@/lib/errors";
import { deleteMyAccount, getMyAccountDeletion } from "@/lib/members.functions";
import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/PageStates";

export const Route = createFileRoute("/_authenticated/settings/security")({
  head: () => ({
    meta: [
      { title: "Security - OpenLedgerApp" },
      { name: "description", content: "Two-step sign-in and your account." },
      { property: "og:title", content: "Security - OpenLedgerApp" },
      { property: "og:description", content: "Two-step sign-in and your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecuritySettings,
});

const inputCls =
  "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function SecuritySettings() {
  const { org } = useOrgContext();
  const client = supabase as unknown as SupabaseClient;
  // Hosted, every security setting lives in OpenAppHub, for every app at once.
  if (isHosted()) {
    return (
      <div className="max-w-2xl space-y-4">
        <section className="rounded-lg border bg-card p-5" aria-labelledby="hub-security-title">
          <h2 id="hub-security-title" className="font-display text-lg font-semibold">
            Security settings are in OpenAppHub
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account and your organization's security settings cover every OpenAppHub app, so
            they're kept in one place.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href={hubUrl("/account#two-step")}
                className="font-medium text-primary hover:underline"
              >
                Your account
              </a>
              : two-step sign-in, backup codes, recovery email, recent security activity, and
              deleting your account.
            </li>
            <li>
              <a
                href={hubUrl("/settings#security")}
                className="font-medium text-primary hover:underline"
              >
                Organization settings
              </a>
              : who must use two-step sign-in in {org?.name ?? "your organization"}.
            </li>
          </ul>
        </section>
      </div>
    );
  }
  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-lg border bg-card p-5" aria-labelledby="two-step-title">
        <h2 id="two-step-title" className="font-display text-lg font-semibold">
          Two-step sign-in
        </h2>
        <div className="mt-3">
          <TwoStepSettings
            client={client}
            sendCode={appSendCode}
            saveRecoveryEmail={appSaveRecoveryEmail}
          />
        </div>
      </section>
      {org ? (
        <section className="rounded-lg border bg-card p-5" aria-labelledby="org-security-title">
          <h2 id="org-security-title" className="font-display text-lg font-semibold">
            {org.name}
          </h2>
          <div className="mt-3">
            <OrgTwoStepPanel client={client} orgId={org.id} />
          </div>
        </section>
      ) : null}
      <DeleteAccount />
    </div>
  );
}

function DeleteAccount() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["account-deletion"],
    queryFn: () => getMyAccountDeletion(),
  });
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Typing DELETE opens "Confirm it's you" (core 0019); its one-time pass goes with the request.
  function remove(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
  }

  async function removeWith(reauth: string) {
    setBusy(true);
    try {
      await deleteMyAccount({ data: { confirm: "DELETE", reauth } });
      setConfirming(false);
      await supabase.auth.signOut();
      queryClient.clear();
      toast.success("Your account was deleted");
      navigate({ to: "/" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-destructive/40 bg-card p-5"
      aria-labelledby="del-title"
    >
      <h2 id="del-title" className="font-display text-lg font-semibold">
        Delete my account
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Removes your sign-in and takes you out of every organization. The books you worked on stay
        intact, and history shows your past changes as "Deleted user". This can't be undone.
      </p>
      {status.isPending && <LoadingState label="Checking" />}
      {status.isError && (
        <ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} />
      )}
      {status.data?.blocker && (
        <p role="status" className="mt-3 text-sm font-medium">
          {status.data.blocker}
        </p>
      )}
      {status.data && !status.data.blocker && (
        <form onSubmit={remove} className="mt-4 space-y-2">
          <label htmlFor="del-confirm" className="block text-sm">
            Type <strong className="rounded bg-muted px-1.5 py-0.5 font-mono">DELETE</strong> to
            confirm
          </label>
          <input
            id="del-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
          />
          <div>
            <Button type="submit" variant="destructive" disabled={busy || confirm !== "DELETE"}>
              Delete my account
            </Button>
          </div>
        </form>
      )}
      <ReauthDialog
        client={supabase as unknown as SupabaseClient}
        action="delete_account"
        open={confirming}
        title="Delete your account?"
        description="Your sign-in is removed and you leave every organization. This can't be undone."
        confirmLabel="Delete my account"
        sendCode={appSendCode}
        onConfirmed={removeWith}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
