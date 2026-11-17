// About page body (SHARED-SPEC §10.3): every open-source library used within the OpenAppHub suite,
// by name and license only. The list is shared/licenses/suite.json, which the hub's
// scripts/collect-licenses.mjs builds from every app; the full license texts are served by the hub
// at /third-party-licenses.txt. The hub and each app put this inside their own page frame at /about.
import { useMemo, useState } from "react";
import suite from "../licenses/suite.json";
import { hubUrl } from "../supabase/hosted";

export type Library = { name: string; license: string };

export const LIBRARIES: Library[] = suite.libraries;

/** Libraries whose name or license contains every word of the search, ignoring case. */
export function filterLibraries(libraries: Library[], query: string): Library[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return libraries;
  return libraries.filter((l) => {
    const hay = `${l.name} ${l.license}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Where the full license texts are: the hub's copy, or openapphub.org's when no hub is set. */
export function licenseTextsUrl(): string {
  const url = hubUrl("/third-party-licenses.txt");
  return url.startsWith("http") ? url : "https://openapphub.org/third-party-licenses.txt";
}

export function AboutLicenses({ libraries = LIBRARIES }: { libraries?: Library[] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterLibraries(libraries, query), [libraries, query]);
  const texts = licenseTextsUrl();

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        These are all the open-source libraries used within the OpenAppHub suite (OpenAppHub,
        OpenCharterApp, OpenBoardApp and OpenLedgerApp), with the license each is used under. The
        full text of every license, with its copyright notices, is in{" "}
        <a href={texts} className="underline underline-offset-4">
          the license file
        </a>
        .
      </p>

      <div>
        <label className="block text-sm font-medium" htmlFor="about-search">
          Search libraries
        </label>
        <input
          id="about-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or license"
          className="mt-1 w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm"
        />
        <p className="sr-only" aria-live="polite">
          {shown.length} libraries shown
        </p>
      </div>

      {/* Focusable, so keyboard users can scroll the table. */}
      <div
        className="max-h-[36rem] overflow-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label="Open-source libraries"
      >
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Library
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                License
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((l) => (
              <tr key={`${l.name}\u0000${l.license}`} className="align-top">
                <td className="px-3 py-2 break-words">{l.name}</td>
                <td className="px-3 py-2">{l.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">No library matches.</p>
        )}
      </div>
    </div>
  );
}
