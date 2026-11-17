// About page body (SHARED-SPEC §10.4): the services the suite runs on and every open-source
// package this app ships, with its license. The list comes from public/third-party.json, which
// shared/licenses/generate.mjs writes from the installed packages; the full license texts are in
// public/third-party-licenses.txt. Each app puts this inside its own page frame at /about.
import { useEffect, useMemo, useState } from "react";
import { SERVICES } from "../licenses/services";

export type ThirdPartyPackage = { name: string; version: string; license: string; url: string };

type State =
  { status: "loading" } | { status: "error" } | { status: "ready"; packages: ThirdPartyPackage[] };

/** Packages whose name or license contains every word of the search, ignoring case. */
export function filterPackages(packages: ThirdPartyPackage[], query: string): ThirdPartyPackage[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return packages;
  return packages.filter((p) => {
    const hay = `${p.name} ${p.license}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How many packages use each license, most used first. */
export function licenseCounts(packages: ThirdPartyPackage[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function AboutLicenses({
  appName,
  listUrl = "/third-party.json",
  textsUrl = "/third-party-licenses.txt",
}: {
  appName: string;
  listUrl?: string;
  textsUrl?: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    fetch(listUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { packages?: ThirdPartyPackage[] }) => {
        if (live) setState({ status: "ready", packages: data.packages ?? [] });
      })
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [listUrl]);

  const shown = useMemo(
    () => (state.status === "ready" ? filterPackages(state.packages, query) : []),
    [state, query],
  );

  return (
    <div className="space-y-10">
      <section>
        <p className="text-muted-foreground">
          {appName === "OpenAppHub" ? "OpenAppHub is" : `${appName} is part of OpenAppHub,`} a suite
          of open-source apps for member organizations: OpenAppHub, OpenCharterApp, OpenBoardApp and
          OpenLedgerApp. They're built on the work of many other open-source projects and run on a
          few outside services. This page lists them all, with the license each one is used under.
        </p>
      </section>

      <section aria-labelledby="about-services">
        <h2 id="about-services" className="text-lg font-semibold">
          Services we use
        </h2>
        <ul className="mt-3 divide-y rounded-lg border">
          {SERVICES.map((s) => (
            <li key={s.name} className="px-3 py-2.5 text-sm">
              <a
                href={s.url}
                className="font-medium underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                {s.name}
              </a>{" "}
              <span className="text-muted-foreground">{s.what}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-packages">
        <h2 id="about-packages" className="text-lg font-semibold">
          Open-source software in {appName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every package {appName} includes, and the packages those include. The full text of each
          license, with its copyright notice, is in{" "}
          <a href={textsUrl} className="underline underline-offset-4">
            the license file
          </a>
          .
        </p>

        {state.status === "loading" && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            Loading the list…
          </p>
        )}
        {state.status === "error" && (
          <p className="mt-4 text-sm" role="alert">
            The list didn't load. You can still read{" "}
            <a href={textsUrl} className="underline underline-offset-4">
              the license file
            </a>
            .
          </p>
        )}
        {state.status === "ready" && (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {state.packages.length} packages:{" "}
              {licenseCounts(state.packages)
                .map(([l, n]) => `${l} (${n})`)
                .join(", ")}
              .
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="about-search">
              Search packages
            </label>
            <input
              id="about-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or license, like react or MIT"
              className="mt-1 w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p className="sr-only" aria-live="polite">
              {shown.length} packages shown
            </p>
            {/* Focusable, so keyboard users can scroll the table on a small screen. */}
            <div
              className="mt-3 max-h-[32rem] overflow-auto rounded-lg border"
              tabIndex={0}
              role="region"
              aria-label="Open-source packages"
            >
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Package
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Version
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      License
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((p) => (
                    <tr key={`${p.name}@${p.version}`} className="align-top">
                      <td className="px-3 py-2">
                        <a
                          href={p.url}
                          className="break-all underline underline-offset-4"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.name}
                        </a>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {p.version}
                      </td>
                      <td className="px-3 py-2">
                        {p.license === "UNKNOWN" ? "Not stated by the package" : p.license}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">No package matches.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
