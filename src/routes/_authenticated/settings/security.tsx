import { useAccess } from "@/hooks/use-access";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { showError } from "@/lib/show-error";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/use-org-context";
import { useAal } from "@/hooks/use-aal";
import { errorMessage } from "@/lib/errors";
import { setRequireMfa } from "@/lib/org.functions";
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
  return (
    <div className="max-w-2xl space-y-4">
      <TwoStep />
      <RequireForOrg />
      {isHosted() ? (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-display text-lg font-semibold">Delete my account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account covers every OpenAppHub app, so it's deleted in OpenAppHub.
          </p>
          <a
            href={hubUrl("/account")}
            className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
          >
            Account settings
          </a>
        </div>
      ) : (
        <DeleteAccount />
      )}
    </div>
  );
}

function TwoStep() {
  const queryClient = useQueryClient();
  const aal = useAal();
  const factors = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp;
    },
  });
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["mfa-factors"] });
    await queryClient.invalidateQueries({ queryKey: ["aal"] });
    await queryClient.invalidateQueries({ queryKey: ["orgs"] });
  }

  async function start() {
    setBusy(true);
    try {
      // Clear any half-finished setup so a new QR code can be issued.
      for (const f of factors.data ?? [])
        if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().getTime()}`,
      });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      showError(err, "Could not start setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enroll.id,
        code: code.trim(),
      });
      if (error) throw new Error("That code didn't work. Try the newest code from the app.");
      setEnroll(null);
      setCode("");
      await refresh();
      toast.success("Two-step sign-in is on");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(id: string) {
    if (!window.confirm("Turn off two-step sign-in for your account?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return void showError(error);
    await refresh();
    toast.success("Two-step sign-in is off");
  }

  const verified = (factors.data ?? []).filter((f) => f.status === "verified");

  return (
    <section className="rounded-lg border bg-card p-5" aria-labelledby="two-step-title">
      <h2 id="two-step-title" className="font-display text-lg font-semibold">
        Two-step sign-in
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        After your password, you also enter a 6-digit code from an authenticator app on your phone
        (for example Google Authenticator, Microsoft Authenticator or 1Password).
      </p>
      {factors.isPending && <LoadingState label="Loading" />}
      {factors.isError && (
        <ErrorState message={errorMessage(factors.error)} onRetry={() => factors.refetch()} />
      )}
      {factors.isSuccess && verified.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">
            On.{" "}
            {aal.data?.current === "aal2"
              ? "This session used it."
              : "Sign out and back in to use it."}
          </p>
          {verified.map((f) => (
            <Button key={f.id} variant="outline" onClick={() => turnOff(f.id)}>
              Turn off
            </Button>
          ))}
        </div>
      )}
      {factors.isSuccess && verified.length === 0 && !enroll && (
        <Button className="mt-4" onClick={start} disabled={busy}>
          Set up two-step sign-in
        </Button>
      )}
      {enroll && (
        <form onSubmit={confirm} className="mt-4 space-y-3">
          <p className="text-sm">1. Scan this code with your authenticator app.</p>
          <img
            src={enroll.qr}
            alt="QR code to add OpenLedgerApp to your authenticator app"
            className="h-44 w-44 rounded bg-background p-2"
          />
          <p className="text-sm text-muted-foreground">
            Can't scan? Enter this key: <code className="break-all">{enroll.secret}</code>
          </p>
          <label htmlFor="enroll-code" className="block text-sm">
            2. Enter the 6-digit code it shows
          </label>
          <input
            id="enroll-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${inputCls} tnum w-40 tracking-widest`}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>
              Turn on
            </Button>
            <Button type="button" variant="outline" onClick={() => setEnroll(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function RequireForOrg() {
  const { org } = useOrgContext();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!org || org.role !== "admin") return null;

  async function toggle(next: boolean) {
    if (!org) return;
    setBusy(true);
    try {
      await setRequireMfa({ data: { orgId: org.id, enabled: next } });
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      toast.success(next ? "Two-step sign-in now required" : "Two-step sign-in no longer required");
    } catch (err) {
      showError(err, "Could not change this");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5" aria-labelledby="require-title">
      <h2 id="require-title" className="font-display text-lg font-semibold">
        Require it for {org.name}
      </h2>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={org.requireMfa}
          disabled={busy || !access.can("manage_settings")}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          Everyone must use two-step sign-in to see or change this organization's books. Members
          without it will be asked to set it up.
        </span>
      </label>
    </section>
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

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await deleteMyAccount({ data: { confirm: "DELETE" } });
      await supabase.auth.signOut();
      queryClient.clear();
      toast.success("Your account was deleted");
      navigate({ to: "/" });
    } catch (err) {
      showError(err, "Could not delete your account");
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
    </section>
  );
}
