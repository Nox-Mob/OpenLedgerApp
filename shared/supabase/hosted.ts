// Hosted-mode helpers (SHARED-SPEC §1.1, §4.1). Safe to import during SSR.

export type AppId = "hub" | "charter" | "board" | "ledger";
export const SUITE_APPS = ["charter", "board", "ledger"] as const;
export type SuiteApp = (typeof SUITE_APPS)[number];

export function isHosted(): boolean {
  return import.meta.env.VITE_HOSTED === "true";
}

export function appId(): AppId {
  return (import.meta.env.VITE_APP_ID as AppId | undefined) ?? "hub";
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Absolute URL on the hub, e.g. hubUrl("/billing"). */
export function hubUrl(path = "/"): string {
  const base = trimSlash(import.meta.env.VITE_HUB_URL || suiteUrls().hub || "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const ALL_APPS = ["hub", ...SUITE_APPS] as const;

export type SuiteUrls = Partial<Record<AppId, string>>;

/**
 * Parses VITE_SUITE_URLS, a JSON object of app origins (SHARED-SPEC §7.1):
 *   {"hub":"https://openapphub.org","charter":"https://charter.openapphub.org",
 *    "board":"https://board.openapphub.org","ledger":"https://ledger.openapphub.org"}
 * Unknown keys, non-http(s) URLs and malformed values are ignored; invalid JSON
 * gives {}. Values are normalised to origins.
 */
export function parseSuiteUrls(raw: unknown): SuiteUrls {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SuiteUrls = {};
  for (const app of ALL_APPS) {
    const url = (value as Record<string, unknown>)[app];
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") out[app] = parsed.origin;
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

export function suiteUrls(): SuiteUrls {
  return parseSuiteUrls(import.meta.env.VITE_SUITE_URLS);
}

/** Hosted sign-in: send the visitor to the hub, coming back to `next` afterwards. */
export function loginRedirect(next: string): string {
  return hubUrl(`/login?next=${encodeURIComponent(next)}`);
}

/**
 * The cookie domain to use on this host: VITE_COOKIE_DOMAIN in hosted mode, but
 * only when the current host is under it (so previews on workers.dev or
 * localhost still get working, host-only cookies). undefined = host-only.
 */
export function cookieDomainFor(
  hostname: string | undefined,
  domain = import.meta.env.VITE_COOKIE_DOMAIN,
): string | undefined {
  if (!isHosted() || !domain) return undefined;
  if (!hostname) return domain; // server side: the request host is checked by the browser
  const bare = domain.replace(/^\./, "").toLowerCase();
  const host = hostname.toLowerCase();
  return host === bare || host.endsWith(`.${bare}`) ? domain : undefined;
}
