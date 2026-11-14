import { hubUrl, isHosted } from "@shared/supabase/hosted";
import { desktopEntryRedirect } from "@/lib/desktop/entry-redirect";
import { errorMessage } from "@/lib/errors";
import { PENDING_INVITE_KEY } from "@/lib/invite-link";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { hostedAuthRedirect } from "@/lib/hosted";
import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MfaCodeForm } from "@/components/MfaCodeForm";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    hostedAuthRedirect();
    await desktopEntryRedirect();
  },
  head: () => ({
    meta: [
      { title: "Sign In - OpenLedgerApp" },
      {
        name: "description",
        content:
          "Sign in to OpenLedgerApp, free open-source accounting for small businesses and nonprofits.",
      },
      { property: "og:title", content: "Sign In - OpenLedgerApp" },
      { property: "og:description", content: "Sign in to OpenLedgerApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  // A pending invite link (saved before sign-in) takes priority over the dashboard.
  function goAfterAuth() {
    const token = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (token) void navigate({ to: "/invite/$token", params: { token } });
    else void navigate({ to: "/ledger" });
  }
  const [needsCode, setNeedsCode] = useState(false);
  // OAuth returns here, keeping the public homepage public while restoring app access.
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session) return;
      void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: a }) => {
        if (a?.nextLevel === "aal2" && a.currentLevel !== "aal2") setNeedsCode(true);
        else goAfterAuth();
      });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: a }) => {
          if (a?.nextLevel === "aal2" && a.currentLevel !== "aal2") setNeedsCode(true);
          else goAfterAuth();
        });
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legalAgreement, setLegalAgreement] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  function passwordIssue(pw: string): string | null {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter.";
    if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Password needs a number.";
    if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a symbol (e.g. ! @ # $).";
    return null;
  }

  function friendlyError(err: unknown): string {
    const msg = errorMessage(err, "Something went wrong");
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code ?? "")
        : "";
    if (code === "over_email_send_rate_limit" || /rate limit/i.test(msg))
      return "Too many attempts. Wait a few minutes and try again.";
    if (/email not confirmed/i.test(msg)) {
      setNeedsVerification(true);
      return "Your email isn't verified yet. Check your inbox, or resend the verification email below.";
    }
    if (/invalid login credentials/i.test(msg))
      return "Wrong email or password. If you signed up with Google, use the Google button.";
    if (/weak_password|password is known to be weak|breached/i.test(msg + code))
      return "That password has appeared in a data breach. Choose a different one.";
    return msg;
  }

  async function resendVerification() {
    setError(null);
    setMessage(null);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) setError(friendlyError(error));
    else setMessage("Verification email sent. Check your inbox.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setNeedsVerification(false);
    if (Date.now() < lockedUntil) {
      setError("Too many attempts. Wait a moment and try again.");
      return;
    }
    if (mode === "signup") {
      const issue = passwordIssue(password);
      if (issue) {
        setError(issue);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") setNeedsCode(true);
        else goAfterAuth();
      } else {
        if (!legalAgreement)
          throw new Error("Agree to the Terms and Privacy Policy to create an account.");
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Account created. Check your email to verify it, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      if (next >= 5) {
        setLockedUntil(Date.now() + 30_000);
        setFailedAttempts(0);
      }
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) setError(error.message || "Google sign-in failed");
  }

  if (needsCode)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <main className="w-full max-w-sm rounded-lg border bg-card p-6">
          <h1 className="font-display text-xl font-semibold">Two-step sign-in</h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Open your authenticator app and enter the code for OpenLedgerApp.
          </p>
          <MfaCodeForm onDone={goAfterAuth} />
          <a
            href={isHosted() ? hubUrl("/recover") : "/recover"}
            className="mt-3 inline-block text-sm underline"
          >
            Can't use your authenticator app?
          </a>
          <button
            type="button"
            className="mt-4 text-sm underline"
            onClick={async () => {
              await supabase.auth.signOut();
              setNeedsCode(false);
            }}
          >
            Use a different account
          </button>
        </main>
      </div>
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-primary" />
          <h1 className="font-display mt-3 text-2xl font-bold">OpenLedgerApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simple, honest accounting for small businesses and nonprofits.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <button
            onClick={signInWithGoogle}
            className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Continue with Google
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or with email
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              aria-label="Email"
              autoComplete="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {mode === "signup" && (
              <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <input
                  type="checkbox"
                  required
                  checked={legalAgreement}
                  onChange={(event) => setLegalAgreement(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span>
                  I agree to the{" "}
                  <Link to="/terms" className="text-foreground underline">
                    Terms of Service
                  </Link>{" "}
                  and acknowledge the{" "}
                  <Link to="/privacy" className="text-foreground underline">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
            )}
            <input
              type="password"
              aria-label="Password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground">
                At least 8 characters with an uppercase letter, a lowercase letter, a number, and a
                symbol.
              </p>
            )}
            {needsVerification && (
              <button
                type="button"
                onClick={resendVerification}
                className="text-sm text-foreground underline underline-offset-2"
              >
                Resend verification email
              </button>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {message && <p className="text-sm text-primary">{message}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {mode === "signin" && (
            <a
              href="/reset-password"
              className="mt-3 block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Forgot your password?
            </a>
          )}

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>

          <div className="mt-5 flex justify-center gap-3 border-t pt-4 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/not-advice" className="hover:text-foreground">
              Not advice
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
