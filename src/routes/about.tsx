import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AboutLicenses, LIBRARIES, type Library } from "@shared/ui/About";
import { isDesktop } from "@/lib/edition";
import { withDesktopLibraries } from "@/lib/desktop-licenses";

// About and open-source licenses (SHARED-SPEC §10.3): every open-source library used within the
// suite, by name and license (shared/licenses/suite.json). The desktop app also ships Rust
// libraries; its build puts their list and license texts in desktop-dist/
// (scripts/desktop/prepare-dist.mjs), and this page adds them. The web build never has them.
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About and open-source licenses - OpenLedgerApp" },
      {
        name: "description",
        content: "The open-source libraries used within the OpenAppHub suite, with each license.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  const desktop = isDesktop();
  const [libraries, setLibraries] = useState<Library[]>(LIBRARIES);

  useEffect(() => {
    if (!desktop) return;
    let live = true;
    fetch("/rust-libraries.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { libraries?: Library[] } | null) => {
        if (live && data?.libraries) setLibraries(withDesktopLibraries(LIBRARIES, data.libraries));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [desktop]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        OpenLedgerApp
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">About and open-source licenses</h1>
      <div className="mt-6">
        <AboutLicenses
          libraries={libraries}
          moreTexts={
            desktop
              ? { href: "/third-party-licenses-rust.txt", label: "the desktop app's license file" }
              : undefined
          }
        />
      </div>
    </main>
  );
}
