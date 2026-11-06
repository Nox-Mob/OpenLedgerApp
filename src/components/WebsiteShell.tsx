import { Link } from "@tanstack/react-router";
import { BookOpen, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LEGAL_CONFIG } from "@/lib/legal";

export function WebsiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="website min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-semibold">
            <BookOpen className="h-6 w-6 text-primary" strokeWidth={1.6} />
            OpenLedgerApp
            <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
              / open-source accounting
            </span>
          </Link>
          <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-5">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to="/changelog">Changelog</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/auth">
                Sign in <ArrowUpRight />
              </Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link to="/get-started">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-6 px-5 py-9 text-sm sm:flex-row sm:px-8">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <BookOpen className="h-4 w-4 text-primary" />
              OpenLedgerApp
            </p>
            <p className="mt-2 text-muted-foreground">A project by {LEGAL_CONFIG.operatorName}.</p>
          </div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3 text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/not-advice" className="hover:text-foreground">
              Not advice
            </Link>
            <a href="mailto:support@awhl.com" className="hover:text-foreground">
              Contact <ArrowUpRight className="inline h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
