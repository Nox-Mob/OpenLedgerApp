// "Confirm it's you" (core 0019), right before the most dangerous actions: deleting an
// organization, handing over ownership, deleting an account and changing the recovery email.
//
// The person types their password (checked by signing in again in the background, with a
// throwaway session that never touches the shared cookie) or, with `sendCode`, a code we email
// them. If they use two-step sign-in, they type their authenticator code too. The database then
// makes a one-time pass for that one action, and `onConfirmed` gets it to send with the action.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createReauthClient } from "../supabase/client";
import { useFocusTrap } from "./useFocusTrap";

export type ReauthAction =
  "delete_organization" | "transfer_ownership" | "delete_account" | "recovery_settings";

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const outline =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50";
const input =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring";

type Who = { email: string; hasPassword: boolean; factorId: string | null };

async function whoAmI(client: SupabaseClient): Promise<Who | null> {
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  const hasPassword = (user.identities ?? []).some((i) => i.provider === "email");
  let factorId: string | null;
  try {
    const { data: f } = await client.auth.mfa.listFactors();
    factorId = (f?.totp ?? []).find((x) => x.status === "verified")?.id ?? null;
  } catch {
    factorId = null;
  }
  return { email: user.email, hasPassword, factorId };
}

/** True for the database's "confirm it's you" errors, so screens can open this dialog. */
export function needsReauth(error: { hint?: string | null; message?: string } | null): boolean {
  return (
    !!error && (error.hint === "reauthenticate" || /confirm it.s you/i.test(error.message ?? ""))
  );
}

export function ReauthDialog({
  client,
  action,
  open,
  title = "Confirm it's you",
  description,
  confirmLabel = "Confirm",
  onConfirmed,
  onClose,
  sendCode,
}: {
  client: SupabaseClient | null;
  action: ReauthAction;
  open: boolean;
  title?: string;
  /** What's about to happen, in a sentence. */
  description: string;
  confirmLabel?: string;
  /** Gets the one-time pass. Throw (or reject) to show an error and keep the dialog open. */
  onConfirmed: (token: string) => Promise<void> | void;
  onClose: () => void;
  /** Emails a code instead of asking for a password (OpenAppHub). Returns an error message or null. */
  sendCode?: (action: ReauthAction) => Promise<string | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const [who, setWho] = useState<Who | null>(null);
  const [mode, setMode] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusTrap(panel, open, onClose);

  useEffect(() => {
    if (!open || !client) return;
    setPassword("");
    setEmailCode("");
    setTotp("");
    setError(null);
    setCodeSent(false);
    let live = true;
    void whoAmI(client).then((w) => {
      if (!live) return;
      setWho(w);
      setMode(w && !w.hasPassword && sendCode ? "code" : "password");
    });
    return () => {
      live = false;
    };
  }, [open, client, sendCode]);

  if (!open) return null;

  async function emailMeACode() {
    if (!sendCode) return;
    setBusy(true);
    setError(null);
    const err = await sendCode(action);
    setBusy(false);
    if (err) setError(err);
    else setCodeSent(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client || !who) return;
    setBusy(true);
    setError(null);
    try {
      let token: string | null = null;
      if (mode === "password") {
        const temp = createReauthClient();
        if (!temp) throw new Error("This site isn't connected to its database.");
        try {
          const { error: pErr } = await temp.auth.signInWithPassword({
            email: who.email,
            password,
          });
          if (pErr) throw new Error("That password isn't right.");
          if (who.factorId) {
            const { error: tErr } = await temp.auth.mfa.challengeAndVerify({
              factorId: who.factorId,
              code: totp.trim(),
            });
            if (tErr) throw new Error("That authenticator code didn't work. Type the newest code.");
          }
          const { data, error: rErr } = await temp
            .schema("public")
            .rpc("begin_reauth", { p_action: action });
          if (rErr) throw new Error(rErr.message);
          token = (data as string | null) ?? null;
        } finally {
          // End the background session straight away; the person stays signed in as before.
          await temp.auth.signOut({ scope: "local" }).catch(() => undefined);
        }
      } else {
        if (who.factorId) {
          const { error: tErr } = await client.auth.mfa.challengeAndVerify({
            factorId: who.factorId,
            code: totp.trim(),
          });
          if (tErr) throw new Error("That authenticator code didn't work. Type the newest code.");
        }
        const { data, error: rErr } = await client
          .schema("public")
          .rpc("begin_reauth", { p_action: action, p_code: emailCode.trim() });
        if (rErr) throw new Error(rErr.message);
        token = (data as string | null) ?? null;
        if (!token) throw new Error("That code isn't right. Check the newest email.");
      }
      if (!token) throw new Error("That didn't work. Try again.");
      await onConfirmed(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const needTotp = !!who?.factorId;
  const ready =
    !!who &&
    (mode === "password" ? password.length > 0 : emailCode.length === 6) &&
    (!needTotp || totp.length === 6);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl border bg-popover p-5 text-popover-foreground shadow-lg sm:rounded-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={descId} className="mt-1 text-sm text-muted-foreground">
          {description} For your safety, confirm it's you first.
        </p>
        {!who ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4 text-sm">
            {mode === "password" ? (
              <div className="space-y-1.5">
                <label htmlFor={`${titleId}-pw`} className="block font-medium">
                  Your password
                </label>
                <input
                  id={`${titleId}-pw`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={input}
                />
                {sendCode ? (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => setMode("code")}
                  >
                    Email me a code instead
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1.5">
                {codeSent ? (
                  <>
                    <label htmlFor={`${titleId}-ec`} className="block font-medium">
                      6-digit code we emailed to {who.email}
                    </label>
                    <input
                      id={`${titleId}-ec`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                      className={`${input} tracking-widest tabular-nums`}
                    />
                    <button
                      type="button"
                      className="text-sm underline"
                      disabled={busy}
                      onClick={() => void emailMeACode()}
                    >
                      Send a new code
                    </button>
                  </>
                ) : (
                  <>
                    <p>We'll email a 6-digit code to {who.email}. It works for 10 minutes.</p>
                    <button
                      type="button"
                      className={outline}
                      disabled={busy}
                      onClick={() => void emailMeACode()}
                    >
                      Email me a code
                    </button>
                  </>
                )}
                {who.hasPassword ? (
                  <button
                    type="button"
                    className="block text-sm underline"
                    onClick={() => setMode("password")}
                  >
                    Use my password instead
                  </button>
                ) : null}
              </div>
            )}
            {needTotp ? (
              <div className="space-y-1.5">
                <label htmlFor={`${titleId}-totp`} className="block font-medium">
                  6-digit code from your authenticator app
                </label>
                <input
                  id={`${titleId}-totp`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  className={`${input} tracking-widest tabular-nums`}
                />
              </div>
            ) : null}
            {!who.hasPassword && !sendCode ? (
              <p role="alert" className="text-destructive">
                Your account has no password. Set one with "Forgot password" on the sign-in page,
                then try again.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={outline} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={primary} disabled={busy || !ready}>
                {busy ? "Checking…" : confirmLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
