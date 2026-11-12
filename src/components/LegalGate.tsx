import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptCurrentLegalDocuments, getLegalStatus } from "@/lib/legal.functions";

export function LegalGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => getLegalStatus(),
    retry: 1,
  });
  const [agreed, setAgreed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Checking the current notices…
      </div>
    );
  if (status.isError)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="font-display text-xl font-bold">We couldn’t check the current notices</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Refresh the page to try again before continuing.
          </p>
          <Button className="mt-5" onClick={() => status.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (!status.data?.missing.length) return children;
  // H-07: hosted, the Terms and Privacy Policy were accepted in OpenAppHub; only the notice shows.
  const viaHub = !!status.data.viaHub;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptCurrentLegalDocuments({
        data: { terms: !viaHub, privacy: !viaHub, nonAdvice: true },
      });
      await queryClient.invalidateQueries({ queryKey: ["legal-status"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your acknowledgement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-xl rounded-lg border bg-card p-7 shadow-sm">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <h1 className="mt-4 font-display text-2xl font-bold">Before you continue</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {viaHub
            ? "One thing before you start: OpenLedgerApp is a recordkeeping tool, not a professional adviser. (You already agreed to the Terms and Privacy Policy in OpenAppHub.)"
            : "Please review the current legal terms and remember that OpenLedgerApp is a recordkeeping tool, not a professional adviser."}
        </p>
        <div className="mt-5 rounded-md border bg-muted/40 p-4 text-sm leading-6">
          OpenLedgerApp does not provide financial, accounting, tax, or legal advice. Reports and
          automated results can be incomplete or wrong. You are responsible for reviewing your
          records and obtaining qualified professional advice when needed.
          <Link
            to="/not-advice"
            className="ml-1 font-medium text-primary underline underline-offset-2"
          >
            Read the full notice
          </Link>
        </div>
        {viaHub ? null : (
          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              I agree to the{" "}
              <Link to="/terms" className="text-primary underline">
                Terms of Service
              </Link>{" "}
              and acknowledge the{" "}
              <Link to="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        )}
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            I understand that OpenLedgerApp does not give financial, accounting, tax, or legal
            advice.
          </span>
        </label>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <Button
          className="mt-6 w-full"
          disabled={(!agreed && !viaHub) || !acknowledged || busy}
          onClick={accept}
        >
          {busy ? "Saving…" : "Agree and continue"}
        </Button>
      </section>
    </div>
  );
}
