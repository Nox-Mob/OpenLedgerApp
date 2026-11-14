// Two-step sign-in (security review round 2, core 0018), shared by every app:
//   TwoStepGate      asks for the 6-digit code when the account has an authenticator app and
//                    this session hasn't used it yet (the database keeps such a session out of
//                    every organization, so without this the apps would just look empty)
//   TwoStepSettings  set up or remove an authenticator app (OpenAppHub's account page)
//   OrgTwoStepPanel  the organization setting: off, the owner and admins, or everyone (core 0019)
//   TwoStepNotice    says which organizations are waiting for a code or for setup, and why
// Backup codes and the recovery email (core 0019) are part of TwoStepSettings; the way back in
// (OpenAppHub's /recover page) is linked from TwoStepGate. Each hides itself on a database
// without the core migration it needs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatDate } from "../format";
import { ReauthDialog, type ReauthAction } from "./Reauth";

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
  recoverHref,
}: {
  client: SupabaseClient | null;
  children: ReactNode;
  onSignOut?: () => void;
  /** OpenAppHub's page for a backup code or a recovery link. */
  recoverHref?: string;
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
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {recoverHref ? (
            <a href={recoverHref} className="underline">
              Can't use your authenticator app?
            </a>
          ) : null}
          {onSignOut ? (
            <button type="button" className="underline" onClick={onSignOut}>
              Sign out instead
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Set up or remove an authenticator app for the signed-in person, with backup codes, the
 * recovery email (when `saveRecoveryEmail` is given: OpenAppHub sends the emails straight away)
 * and the account's recent security activity.
 */
export function TwoStepSettings({
  client,
  sendCode,
  saveRecoveryEmail,
}: {
  client: SupabaseClient | null;
  /** Emails a code for "confirm it's you" (OpenAppHub). */
  sendCode?: (action: ReauthAction) => Promise<string | null>;
  /** Saves (or, with null, removes) the recovery email. Returns an error message or null. */
  saveRecoveryEmail?: (email: string | null, token: string) => Promise<string | null>;
}) {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [statusKey, setStatusKey] = useState(0);
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
    // Backup codes straight away, so nobody is one lost phone away from being locked out.
    if (saveRecoveryEmail) {
      const { data: codes } = await client.schema("public").rpc("create_recovery_codes");
      if (Array.isArray(codes)) setFreshCodes(codes as string[]);
    }
    setStatusKey((k) => k + 1);
  }

  // Turning it off asks for a fresh code first, so a computer left signed in can't be used to
  // remove it quietly.
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(id: string) {
    if (!client) return;
    setRemoving(null);
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
                {f.created_at ? `, added ${formatDate(f.created_at)}` : ""}
              </span>
              <button type="button" className={outline} onClick={() => setRemoving(f.id)}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {removing ? (
        <div className="space-y-2 rounded-md border p-4">
          <p>
            Turning it off means your password alone opens your account. To confirm, type a code
            from your authenticator app.
          </p>
          <TwoStepCodeForm
            client={client}
            label="6-digit code"
            onDone={() => void remove(removing)}
          />
          <button type="button" className="text-sm underline" onClick={() => setRemoving(null)}>
            Keep it on
          </button>
        </div>
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
      {/* Backup codes and the recovery email need OpenAppHub's recovery page, so they show
          where it exists (saveRecoveryEmail is given there). */}
      {verified.length && saveRecoveryEmail ? (
        <BackupCodes
          client={client}
          fresh={freshCodes}
          onFresh={(c) => {
            setFreshCodes(c);
            setStatusKey((k) => k + 1);
          }}
          refreshKey={statusKey}
        />
      ) : null}
      {saveRecoveryEmail ? (
        <RecoveryEmail
          client={client}
          sendCode={sendCode}
          save={saveRecoveryEmail}
          refreshKey={statusKey}
          onChanged={() => setStatusKey((k) => k + 1)}
        />
      ) : null}
      <SecurityActivity client={client} refreshKey={statusKey} />
    </div>
  );
}

type SecurityStatus = {
  has_factor: boolean;
  codes_total: number;
  codes_left: number;
  codes_created_at: string | null;
  recovery_email: string | null;
  recovery_email_verified: boolean;
  events: Array<{ kind: string; detail: Record<string, unknown>; at: string }>;
};

function useSecurityStatus(client: SupabaseClient, refreshKey: number) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await client.schema("public").rpc("account_security_status");
      if (live && !error && data) setStatus(data as SecurityStatus);
    })();
    return () => {
      live = false;
    };
  }, [client, refreshKey]);
  return status;
}

function BackupCodes({
  client,
  fresh,
  onFresh,
  refreshKey,
}: {
  client: SupabaseClient;
  fresh: string[] | null;
  onFresh: (codes: string[] | null) => void;
  refreshKey: number;
}) {
  const status = useSecurityStatus(client, refreshKey);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Making new codes needs a code typed in the last five minutes (core 0019).
  const [askCode, setAskCode] = useState(false);
  if (!status) return null;

  async function create() {
    setError(null);
    const { data, error: e } = await client.schema("public").rpc("create_recovery_codes");
    if (e) {
      if (e.hint === "mfa") return setAskCode(true);
      return setError(e.message);
    }
    setAskCode(false);
    onFresh(data as string[]);
  }

  async function make() {
    if (
      status &&
      status.codes_total > 0 &&
      typeof window !== "undefined" &&
      !window.confirm("Make new backup codes? Your old codes will stop working.")
    )
      return;
    await create();
  }

  function download() {
    if (!fresh || typeof document === "undefined") return;
    const text = [
      "OpenAppHub backup codes",
      "Each code works once. Keep them somewhere safe, like a password manager.",
      "",
      ...fresh,
      "",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "openapphub-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section aria-labelledby="backup-codes-h" className="space-y-3 rounded-md border p-4">
      <h3 id="backup-codes-h" className="font-medium">
        Backup codes
      </h3>
      <p className="text-muted-foreground">
        If you lose your phone, a backup code gets you back in. Each code works once. Keep them
        somewhere safe, like a password manager or a printed page at home.
      </p>
      {fresh ? (
        <div className="space-y-3">
          <p role="status" className="font-medium">
            Save these codes now. You won't see them again.
          </p>
          <ul
            className="grid grid-cols-2 gap-2 font-mono text-base sm:grid-cols-5"
            aria-label="Backup codes"
          >
            {fresh.map((c) => (
              <li key={c} className="rounded bg-muted px-2 py-1 text-center">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={outline}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.join("\n")).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={outline} onClick={download}>
              Download
            </button>
            <button type="button" className={primary} onClick={() => onFresh(null)}>
              I saved them
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            {status.codes_total
              ? `${status.codes_left} of ${status.codes_total} codes left.`
              : "You don't have backup codes yet."}
          </span>
          <button type="button" className={outline} onClick={() => void make()}>
            {status.codes_total ? "Make new codes" : "Make backup codes"}
          </button>
        </div>
      )}
      {askCode ? (
        <div className="rounded-md border p-3">
          <TwoStepCodeForm
            client={client}
            label="To make new codes, type the 6-digit code from your authenticator app"
            onDone={() => void create()}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RecoveryEmail({
  client,
  sendCode,
  save,
  refreshKey,
  onChanged,
}: {
  client: SupabaseClient;
  sendCode?: ((action: ReauthAction) => Promise<string | null>) | undefined;
  save: (email: string | null, token: string) => Promise<string | null>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const status = useSecurityStatus(client, refreshKey);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!status) return null;

  return (
    <section aria-labelledby="recovery-email-h" className="space-y-3 rounded-md border p-4">
      <h3 id="recovery-email-h" className="font-medium">
        Recovery email
      </h3>
      <p className="text-muted-foreground">
        A second email address, different from the one you sign in with. If you lose your phone, we
        can send a link there to turn off two-step sign-in so you can set it up again.
      </p>
      {status.recovery_email ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            <strong className="break-all">{status.recovery_email}</strong>{" "}
            {status.recovery_email_verified
              ? "(confirmed)"
              : "(waiting for you to confirm it: check that inbox)"}
          </span>
          <button type="button" className={outline} onClick={() => setPending(null)}>
            Remove
          </button>
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) setPending(email.trim());
        }}
      >
        <label className="grow space-y-1">
          <span className="block text-sm font-medium">
            {status.recovery_email ? "Change it to" : "Recovery email address"}
          </span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button type="submit" className={primary} disabled={!email.trim()}>
          Save
        </button>
      </form>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "" : "text-destructive"}>
          {message.text}
        </p>
      ) : null}
      <ReauthDialog
        client={client}
        action="recovery_settings"
        open={pending !== undefined}
        description={
          pending
            ? `You're about to make ${pending} your recovery email.`
            : "You're about to remove your recovery email."
        }
        onClose={() => setPending(undefined)}
        {...(sendCode ? { sendCode } : {})}
        onConfirmed={async (token) => {
          const err = await save(pending ?? null, token);
          if (err) throw new Error(err);
          setPending(undefined);
          setEmail("");
          setMessage({
            ok: true,
            text: pending
              ? "Saved. We sent a link to that address: open it to confirm it's yours."
              : "Removed.",
          });
          onChanged();
        }}
      />
    </section>
  );
}

const EVENT_TEXT: Record<string, string> = {
  reauthenticated: "Confirmed it was you",
  reauth_code_sent: "A confirmation code was emailed",
  backup_codes_created: "New backup codes were made",
  backup_code_used: "A backup code was used",
  recovery_email_set: "A recovery email was added",
  recovery_email_verified: "The recovery email was confirmed",
  recovery_email_removed: "The recovery email was removed",
  recovery_link_sent: "A recovery link was sent",
  recovery_failed: "A wrong backup code or recovery link was tried",
  two_step_removed: "Two-step sign-in was turned off to recover the account",
};

const ACTION_TEXT: Record<string, string> = {
  delete_organization: "to delete an organization",
  transfer_ownership: "to hand over ownership",
  delete_account: "to delete the account",
  recovery_settings: "to change the recovery email",
};

function SecurityActivity({ client, refreshKey }: { client: SupabaseClient; refreshKey: number }) {
  const status = useSecurityStatus(client, refreshKey);
  if (!status || !status.events.length) return null;
  return (
    <section aria-labelledby="security-activity-h" className="space-y-2">
      <h3 id="security-activity-h" className="font-medium">
        Recent security activity
      </h3>
      <ul className="divide-y rounded-md border">
        {status.events.map((e, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-3">
            <span>
              {EVENT_TEXT[e.kind] ?? e.kind}
              {typeof e.detail?.["action"] === "string" && ACTION_TEXT[e.detail["action"] as string]
                ? ` ${ACTION_TEXT[e.detail["action"] as string]}`
                : ""}
            </span>
            <time className="text-muted-foreground" dateTime={e.at}>
              {formatDate(e.at, { time: true })}
            </time>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Don't recognize something here? Change your password and check your two-step sign-in.
      </p>
    </section>
  );
}

type Level = "off" | "admins" | "everyone";
type OrgSecurity = {
  mfa_required: Level;
  can_change: boolean;
  admins_without: number;
  members_without: number;
};

const LEVELS: Array<{ value: Level; label: string; help: string }> = [
  {
    value: "off",
    label: "Not required",
    help: "Everyone may use two-step sign-in, and we recommend it, but nobody has to.",
  },
  {
    value: "admins",
    label: "Required for the owner and admins",
    help: "The people who can change everything must use it. Members may choose.",
  },
  {
    value: "everyone",
    label: "Required for everyone",
    help: "Every person in this organization must use it, including the owner and admins.",
  },
];

/** The organization setting: off, the owner and admins, or everyone. */
export function OrgTwoStepPanel({
  client,
  orgId,
}: {
  client: SupabaseClient | null;
  orgId: string;
}) {
  const [state, setState] = useState<OrgSecurity | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    const d = data as Partial<OrgSecurity> | null;
    // A database without core 0019 has no levels.
    if (!d || !d.mfa_required) return setMissing(true);
    setState(d as OrgSecurity);
  }, [client, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function choose(level: Level) {
    if (!client || !state || level === state.mfa_required) return;
    const affected =
      level === "everyone" ? state.members_without : level === "admins" ? state.admins_without : 0;
    if (
      affected > 0 &&
      typeof window !== "undefined" &&
      !window.confirm(
        `${affected} ${affected === 1 ? "person hasn't" : "people haven't"} set up two-step sign-in yet. ` +
          "They won't be able to open this organization until they do (they'll be shown how). Continue?",
      )
    )
      return;
    setError(null);
    setSaved(false);
    const { error: e } = await client
      .schema("public")
      .rpc("set_org_mfa_level", { p_org: orgId, p_level: level });
    if (e) setError(e.message);
    else setSaved(true);
    await load();
  }

  if (missing || !state) return null;
  return (
    <fieldset className="space-y-3 text-sm">
      <legend className="font-medium">Two-step sign-in</legend>
      <p className="text-muted-foreground">
        Two-step sign-in asks for a code from an app on the person's phone, as well as their
        password. To require it, set it up for yourself first.
      </p>
      {LEVELS.map((l) => (
        <label
          key={l.value}
          className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
        >
          <input
            type="radio"
            name={`mfa-level-${orgId}`}
            value={l.value}
            className="mt-1 size-4 accent-primary"
            checked={state.mfa_required === l.value}
            disabled={!state.can_change}
            onChange={() => void choose(l.value)}
          />
          <span>
            <span className="font-medium">{l.label}</span>
            <span className="block text-muted-foreground">{l.help}</span>
          </span>
        </label>
      ))}
      <p className="text-muted-foreground">
        {state.members_without === 0
          ? "Everyone here has set it up."
          : `${state.members_without} ${state.members_without === 1 ? "person hasn't" : "people haven't"} set it up yet` +
            (state.admins_without ? `, including ${state.admins_without} owner or admin.` : ".")}
      </p>
      {!state.can_change ? (
        <p className="text-xs text-muted-foreground">The owner and admins change this.</p>
      ) : null}
      {saved ? <p role="status">Saved.</p> : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
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
    Array<{ org_id: string; name: string; reason: "code" | "setup"; level?: Level }>
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
  const everyone = orgs.some((o) => o.level === "everyone");
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {orgs.map((o) => o.name).join(", ")} {orgs.length === 1 ? "requires" : "require"} two-step
        sign-in{everyone ? "" : " for owners and admins"}.
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
