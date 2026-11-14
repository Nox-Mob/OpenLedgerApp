// Two-step sign-in (security review round 2, core 0018), shared by every app:
//   TwoStepGate      asks for the 6-digit code when the account has an authenticator app and
//                    this session hasn't used it yet (the database keeps such a session out of
//                    every organization, so without this the apps would just look empty)
//   TwoStepSettings  set up or remove an authenticator app (OpenAppHub's account page)
//   OrgTwoStepPanel  the organization setting: require it of the owner and admins
//   TwoStepNotice    says which organizations are waiting for a code or for setup, and why
// Each hides itself on a database without core 0018.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

const card = "rounded-xl border bg-card p-6 shadow-sm";
const primary =
  "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const outline =
  "inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50";
const codeInput =
  "w-40 rounded-md border border-input bg-background px-3 py-2 text-lg tracking-widest tabular-nums outline-none focus:ring-2 focus:ring-ring";

type Factor = { id: string; status: string; friendly_name?: string | null; created_at?: string };

/** The 6-digit code form. Calls onDone when the session is signed in with the code. */
export function TwoStepCodeForm({
  client,
  onDone,
  label = "6-digit code from your authenticator app",
}: {
  client: SupabaseClient;
  onDone: () => void;
  label?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data, error: fErr } = await client.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const factor = (data?.totp ?? []).find((f: Factor) => f.status === "verified");
      if (!factor) throw new Error("No authenticator app is set up for this account.");
      const { error: vErr } = await client.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: code.trim(),
      });
      if (vErr) throw new Error("That code didn't work. Open the app and type the newest code.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="two-step-code" className="block text-sm font-medium">
        {label}
      </label>
      <input
        id="two-step-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className={codeInput}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button type="submit" className={primary} disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

/**
 * Shows the code form instead of the app when this account has two-step sign-in and the session
 * was opened with a password only. Everything else renders the app as usual.
 */
export function TwoStepGate({
  client,
  children,
  onSignOut,
}: {
  client: SupabaseClient | null;
  children: ReactNode;
  onSignOut?: () => void;
}) {
  const [needsCode, setNeedsCode] = useState(false);
  const check = useCallback(async () => {
    if (!client) return;
    try {
      const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      setNeedsCode(!!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2");
    } catch {
      setNeedsCode(false);
    }
  }, [client]);
  useEffect(() => {
    void check();
    if (!client) return;
    // A stand-in client (tests, previews) may not have these; the app still renders.
    try {
      const { data } = client.auth.onAuthStateChange(() => void check());
      return () => data.subscription.unsubscribe();
    } catch {
      return undefined;
    }
  }, [client, check]);

  if (!client || !needsCode) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className={`${card} w-full max-w-md space-y-4`}>
        <h1 className="text-lg font-semibold">One more step</h1>
        <p className="text-sm text-muted-foreground">
          Your account uses two-step sign-in. Open your authenticator app and type the 6-digit code
          it shows for OpenAppHub. This keeps your organizations safe even if someone learns your
          password.
        </p>
        <TwoStepCodeForm
          client={client}
          onDone={() => {
            setNeedsCode(false);
            // Fresh data now that the session can see the organizations.
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
        {onSignOut ? (
          <button type="button" className="text-sm underline" onClick={onSignOut}>
            Sign out instead
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Set up or remove an authenticator app for the signed-in person. */
export function TwoStepSettings({ client }: { client: SupabaseClient | null }) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) return setMessage({ ok: false, text: error.message });
    setFactors((data?.totp ?? []) as Factor[]);
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      // Clear any half-finished setup so a new QR code can be made.
      for (const f of factors ?? [])
        if (f.status !== "verified") await client.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${Date.now()}`,
      });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Setup didn't start." });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!client || !enroll) return;
    setBusy(true);
    setMessage(null);
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId: enroll.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error)
      return setMessage({
        ok: false,
        text: "That code didn't work. Type the newest code from the app.",
      });
    setEnroll(null);
    setCode("");
    setMessage({
      ok: true,
      text: "Two-step sign-in is on. You'll be asked for a code when you sign in.",
    });
    await load();
  }

  async function remove(id: string) {
    if (!client) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Turn off two-step sign-in? Your account will be protected by your password only.",
      )
    )
      return;
    const { error } = await client.auth.mfa.unenroll({ factorId: id });
    if (error)
      return setMessage({
        ok: false,
        text: "To turn it off, sign in with your code first (sign out, then sign in again).",
      });
    setMessage({ ok: true, text: "Two-step sign-in is off." });
    await load();
  }

  if (!client) return null;
  const verified = (factors ?? []).filter((f) => f.status === "verified");
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        With two-step sign-in, signing in takes your password <strong>and</strong> a 6-digit code
        from an app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and
        others). If someone learns your password, they still can't get in. We recommend it for
        everyone, and your organization may require it for owners and admins.
      </p>
      {factors === null ? <p className="text-muted-foreground">Loading…</p> : null}
      {verified.length ? (
        <ul className="space-y-2">
          {verified.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <span>
                <strong>On</strong>: an authenticator app
                {f.created_at ? `, added ${new Date(f.created_at).toLocaleDateString()}` : ""}
              </span>
              <button type="button" className={outline} onClick={() => void remove(f.id)}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!verified.length && !enroll && factors !== null ? (
        <button type="button" className={primary} disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Set up two-step sign-in"}
        </button>
      ) : null}
      {enroll ? (
        <form onSubmit={confirm} className="space-y-3 rounded-md border p-4">
          <p>
            <strong>1.</strong> Open your authenticator app and add an account by scanning this
            code.
          </p>
          <img
            src={enroll.qr}
            alt="QR code to add OpenAppHub to your authenticator app"
            className="h-44 w-44 bg-white p-2"
          />
          <p className="text-muted-foreground">
            Can't scan it? Type this key into the app instead:{" "}
            <code className="break-all rounded bg-muted px-1">{enroll.secret}</code>
          </p>
          <p>
            <strong>2.</strong> Type the 6-digit code the app shows.
          </p>
          <input
            aria-label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={codeInput}
          />
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || code.length !== 6}>
              Turn on
            </button>
            <button type="button" className={outline} onClick={() => setEnroll(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "" : "text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** The organization setting: owners and admins must use two-step sign-in. */
export function OrgTwoStepPanel({
  client,
  orgId,
}: {
  client: SupabaseClient | null;
  orgId: string;
}) {
  const [state, setState] = useState<{ require_mfa_admins: boolean; can_change: boolean } | null>(
    null,
  );
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error: e } = await client
      .schema("public")
      .rpc("org_security_settings", { p_org: orgId });
    if (e) {
      if (e.code === "PGRST202" || e.code === "42883") setMissing(true);
      else setError(e.message);
      return;
    }
    setState(data as { require_mfa_admins: boolean; can_change: boolean } | null);
  }, [client, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(on: boolean) {
    if (!client) return;
    setError(null);
    const { error: e } = await client
      .schema("public")
      .rpc("set_org_require_mfa", { p_org: orgId, p_on: on });
    if (e) setError(e.message);
    await load();
  }

  if (missing || !state) return null;
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={state.require_mfa_admins}
          disabled={!state.can_change}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <span className="font-medium">Require two-step sign-in for the owner and admins</span>
          <span className="block text-muted-foreground">
            The people who can change everything must sign in with a code from an authenticator app.
            Until they do, they can't open this organization (they'll see how to set it up). To
            switch this on, set up two-step sign-in for yourself first.
          </span>
        </span>
      </label>
      {!state.can_change ? (
        <p className="text-xs text-muted-foreground">The owner and admins change this.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Which organizations are waiting for this person's code, or for them to set one up. */
export function TwoStepNotice({
  client,
  accountHref,
}: {
  client: SupabaseClient | null;
  /** Where people set up two-step sign-in (OpenAppHub's account page). */
  accountHref: string;
}) {
  const [orgs, setOrgs] = useState<
    Array<{ org_id: string; name: string; reason: "code" | "setup" }>
  >([]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void (async () => {
      const { data, error } = await client.schema("public").rpc("my_mfa_status");
      if (!live || error || !data) return;
      setOrgs(((data as { blocked_orgs?: typeof orgs }).blocked_orgs ?? []) as typeof orgs);
    })();
    return () => {
      live = false;
    };
  }, [client]);
  if (!orgs.length) return null;
  const setup = orgs.filter((o) => o.reason === "setup");
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {orgs.map((o) => o.name).join(", ")} {orgs.length === 1 ? "requires" : "require"} two-step
        sign-in for owners and admins.
      </p>
      <p className="mt-1">
        {setup.length
          ? "Set up two-step sign-in on your account page, then sign out and sign in again with your code. Until then, you can't open "
          : "Sign out and sign in again with the code from your authenticator app. Until then, you can't open "}
        {orgs.length === 1 ? "it" : "them"}.
      </p>
      <a href={accountHref} className="mt-2 inline-block font-medium underline">
        Go to two-step sign-in
      </a>
    </div>
  );
}
