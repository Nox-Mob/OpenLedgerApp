import { BookOpen } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LEGAL_CONFIG } from "@/lib/legal";

export function LegalPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 font-display font-bold">
            <BookOpen className="h-5 w-5 text-primary" /> OpenLedgerApp
          </Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-12">
        <p className="text-sm font-medium text-primary">
          Effective {LEGAL_CONFIG.effectiveDate} · Last updated {LEGAL_CONFIG.lastUpdatedDate}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Operating organization: {LEGAL_CONFIG.operatorName}
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">{summary}</p>
        <div className="mt-10 space-y-9 text-[15px] leading-7 text-foreground [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2">
          {children}
        </div>
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-4xl flex-wrap gap-x-5 gap-y-2 px-5 py-6 text-sm text-muted-foreground">
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
      </footer>
    </div>
  );
}
