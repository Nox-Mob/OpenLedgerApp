import { createFileRoute } from "@tanstack/react-router";
import { openCookieSettings } from "@shared/consent";
import { CookieTable } from "@shared/ui/CookieConsent";
import { LegalPage } from "@/components/LegalPage";

// Cookie policy: every cookie the suite sets (shared/consent.ts), so this page, the banner
// and the code use the same list.
export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy - OpenLedgerApp" },
      {
        name: "description",
        content: "The cookies OpenLedgerApp uses, what they're for and how to change your choices.",
      },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      summary="OpenLedgerApp uses a few cookies and similar browser storage, all its own. No advertising or tracking cookies."
    >
      <section>
        <h2>What we use</h2>
        <CookieTable />
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          Required cookies keep you signed in and remember your organization; they can't be turned
          off. Everything else is off until you allow it.
        </p>
        <button
          type="button"
          onClick={() => openCookieSettings()}
          className="mt-2 inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Cookie settings
        </button>
      </section>
    </LegalPage>
  );
}
