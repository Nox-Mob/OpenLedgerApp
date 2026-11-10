import { desktopEntryRedirect } from "@/lib/desktop/entry-redirect";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { hostedAuthRedirect } from "@/lib/hosted";
import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  beforeLoad: async () => {
    hostedAuthRedirect("/forgot-password");
    await desktopEntryRedirect();
  },
  head: () => ({
    meta: [
      { title: "Reset Password - OpenLedgerApp" },
      { name: "description", content: "Reset your OpenLedgerApp password." },
      { property: "og:title", content: "Reset Password - OpenLedgerApp" },
      { property: "og:description", content: "Reset your OpenLedgerApp password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

const input =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const primary =
  "w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

function ResetPasswordPage() {
  const navigate = useNavigate();
  // "request" = ask for a link; "update" = arrived from the email link with a recovery session.
  const [mode, setMode] = useState<"request" | "update">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setMode("update");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMessage("If that email has an account, a reset link is on its way.");
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    navigate({ to: "/ledger" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-primary" />
          <h1 className="font-display mt-3 text-2xl font-bold">
            {mode === "request" ? "Reset your password" : "Choose a new password"}
          </h1>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {mode === "request" ? (
            <form onSubmit={requestLink} className="space-y-3">
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              {message && <p className="text-sm text-primary">{message}</p>}
              <button type="submit" disabled={busy} className={primary}>
                Send reset link
              </button>
            </form>
          ) : (
            <form onSubmit={updatePassword} className="space-y-3">
              <input
                type="password"
                required
                minLength={6}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={input}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={busy} className={primary}>
                Save new password
              </button>
            </form>
          )}
          <Link
            to="/auth"
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
