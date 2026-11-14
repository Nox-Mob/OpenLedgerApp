// "Can't use your authenticator app?" and "Confirm your recovery email" (core 0019), for the
// self-hosted apps (OpenAppHub has its own pages in its sign-in style). The app gives the
// server steps (shared/security/server.ts, wrapped in its own server functions).
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState, type FormEvent, type ReactNode } from "react";

type Result = { ok: true } | { error: string };

const primary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";
const outline =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

export function RecoverScreen({
  email,
  token,
  signInHref,
  setupHref,
  recover,
  sendLink,
}: {
  /** The signed-in person's email, or null when nobody is signed in. */
  email: string | null;
  /** From a recovery email's link. */
  token?: string | undefined;
  signInHref: string;
  /** Where to set two-step sign-in up again afterwards. */
  setupHref: string;
  recover: (input: { code: string } | { token: string }) => Promise<Result>;
  sendLink: () => Promise<Result>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  if (!email)
    return (
      <Card title="Sign in first">
        <p className="text-sm text-muted-foreground">
          Sign in with your email and password. When you're asked for the code from your
          authenticator app, choose <strong>Can't use your authenticator app?</strong>
        </p>
        <a href={signInHref} className={primary}>
          Sign in
        </a>
      </Card>
    );

  if (done)
    return (
      <Card title="Two-step sign-in is off">
        <p className="text-sm text-muted-foreground">
          You're back in, and your other sessions were signed out. We emailed you about this. Set up
          two-step sign-in again now, on your new phone, and make new backup codes.
        </p>
        <a href={setupHref} className={primary}>
          Set up two-step sign-in
        </a>
      </Card>
    );

  async function run(input: { code: string } | { token: string }) {
    setBusy(true);
    setError(null);
    const res = await recover(input);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setDone(true);
  }

  if (token)
    return (
      <Card title="Turn off two-step sign-in?">
        <p className="text-sm text-muted-foreground">
          Signed in as <strong className="break-all text-foreground">{email}</strong>. This link
          from your recovery email turns off two-step sign-in, so you can set it up again on a new
          phone. If you didn't ask for it, don't continue, and change your password.
        </p>
        <Problem text={error} />
        <button
          type="button"
          className={primary}
          disabled={busy}
          onClick={() => void run({ token })}
        >
          {busy ? "Turning it off…" : "Turn off two-step sign-in"}
        </button>
      </Card>
    );

  function submit(e: FormEvent) {
    e.preventDefault();
    void run({ code });
  }

  async function emailLink() {
    setBusy(true);
    setError(null);
    const res = await sendLink();
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setSent(true);
  }

  return (
    <Card title="Can't use your authenticator app?">
      <p className="text-sm text-muted-foreground break-all">Signed in as {email}</p>
      <form className="space-y-2" onSubmit={submit}>
        <label htmlFor="backup-code" className="block text-sm font-medium">
          Type one of your backup codes
        </label>
        <input
          id="backup-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXXX-XXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base tracking-wider outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="submit" className={primary} disabled={busy || code.trim().length < 10}>
          {busy ? "Checking…" : "Use backup code"}
        </button>
      </form>
      <div className="space-y-2 border-t pt-4 text-sm">
        <p className="font-medium">No backup codes?</p>
        <p className="text-muted-foreground">
          If you added a recovery email, we can send a link there. It works for 30 minutes.
        </p>
        {sent ? (
          <p role="status">We sent a link to your recovery email. Open it on this device.</p>
        ) : (
          <button
            type="button"
            className={outline}
            disabled={busy}
            onClick={() => void emailLink()}
          >
            Email my recovery address
          </button>
        )}
        <p className="text-muted-foreground">
          Neither works? Ask whoever runs this server to remove your authenticator.
        </p>
      </div>
      <Problem text={error} />
    </Card>
  );
}

export function VerifyRecoveryEmailScreen({
  client,
  email,
  token,
  signInHref,
  accountHref,
}: {
  client: SupabaseClient | null;
  email: string | null;
  token?: string | undefined;
  signInHref: string;
  accountHref: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "bad">("idle");
  if (!token)
    return (
      <Card title="This link isn't complete">
        <p className="text-sm text-muted-foreground">
          Open the link from the email again, or add your recovery email again on your account page.
        </p>
      </Card>
    );
  if (!email || !client)
    return (
      <Card title="Sign in to confirm">
        <p className="text-sm text-muted-foreground">
          Sign in to the account that added this recovery email, then open the link again.
        </p>
        <a href={signInHref} className={primary}>
          Sign in
        </a>
      </Card>
    );

  async function confirm() {
    if (!client) return;
    setState("busy");
    const { data, error } = await client
      .schema("public")
      .rpc("verify_recovery_email", { p_token: token });
    setState(!error && data === true ? "ok" : "bad");
  }

  return (
    <Card title="Confirm your recovery email">
      {state === "ok" ? (
        <>
          <p role="status" className="text-sm">
            Confirmed. If you lose your phone, we can send a link to this address.
          </p>
          <a href={accountHref} className={primary}>
            Back to your account
          </a>
        </>
      ) : state === "bad" ? (
        <Problem text="This link has expired, was already used, or belongs to a different account. Add the recovery email again on your account page." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Signed in as <strong className="break-all text-foreground">{email}</strong>. Make this
            address the place we send a link if you ever lose your phone?
          </p>
          <button
            type="button"
            className={primary}
            disabled={state === "busy"}
            onClick={() => void confirm()}
          >
            {state === "busy" ? "Confirming…" : "Confirm"}
          </button>
        </>
      )}
    </Card>
  );
}
