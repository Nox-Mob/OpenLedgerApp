// Cookie consent for every suite app (GDPR + ePrivacy).
//
// - "necessary" cookies (sign-in session, current organization, this consent
//   record) are always on: the site can't work without them, so no switch.
// - "preferences" cookies (the theme choice) are OFF until the visitor agrees.
//   Without consent a theme choice still works, for the browser session only.
// - The choice is the `oah_consent` cookie on the suite domain (hosted), so one
//   answer covers every app. It expires after 180 days, then we ask again.
// - Withdrawing consent deletes the preference cookies straight away.
// Add new categories (e.g. analytics) here, bump CONSENT_VERSION to re-ask.
import { cookieDomainFor } from "./supabase/hosted";

export const CONSENT_COOKIE = "oah_consent";
export const CONSENT_VERSION = 1;
const MAX_AGE_DAYS = 180;
export const CONSENT_EVENT = "oah:consent";
export const OPEN_SETTINGS_EVENT = "oah:cookie-settings";

export type ConsentCategory = "necessary" | "preferences";
export type Consent = { version: number; preferences: boolean; at: number };

export type CookieInfo = {
  name: string;
  category: ConsentCategory;
  purpose: string;
  duration: string;
  provider: string;
};

/** Every cookie the suite sets on its own domains. Shown on the cookie policy page. */
export const COOKIES: CookieInfo[] = [
  {
    name: "sb-<project>-auth-token",
    category: "necessary",
    purpose: "Keeps you signed in, across the OpenAppHub apps.",
    duration: "Until you sign out (refreshed while you use the apps)",
    provider: "OpenAppHub (Supabase Auth)",
  },
  {
    name: "sb-<project>-auth-token-code-verifier",
    category: "necessary",
    purpose: "Protects the sign-in step when you sign in with Google or an email link.",
    duration: "Until the sign-in finishes",
    provider: "OpenAppHub (Supabase Auth)",
  },
  {
    name: "oah_org",
    category: "necessary",
    purpose: "Remembers which of your organizations you're working in.",
    duration: "1 year",
    provider: "OpenAppHub",
  },
  {
    name: "oah_consent",
    category: "necessary",
    purpose: "Remembers your cookie choices, so we don't ask on every page.",
    duration: "180 days",
    provider: "OpenAppHub",
  },
  {
    name: "oah_theme",
    category: "preferences",
    purpose: "Remembers whether you chose the light, dark or system theme.",
    duration: "1 year",
    provider: "OpenAppHub",
  },
];

/** Cookie names (exact) that belong to the optional preferences category. */
export const PREFERENCE_COOKIES = COOKIES.filter((c) => c.category === "preferences").map(
  (c) => c.name,
);

/** Value format: v1-p1-<unix seconds>. */
export function parseConsent(value: string | undefined | null): Consent | null {
  const m = /^v(\d+)-p([01])-(\d{1,12})$/.exec(value ?? "");
  if (!m) return null;
  const version = Number(m[1]);
  if (version !== CONSENT_VERSION) return null; // categories changed: ask again
  return { version, preferences: m[2] === "1", at: Number(m[3]) };
}

export function readConsent(cookieHeader: string): Consent | null {
  const m = cookieHeader.match(/(?:^|;\s*)oah_consent=([^;]*)/);
  return parseConsent(m?.[1]);
}

export function consentCookieString(
  consent: Pick<Consent, "preferences" | "at">,
  opts: { domain?: string | undefined; secure?: boolean } = {},
): string {
  const value = `v${CONSENT_VERSION}-p${consent.preferences ? 1 : 0}-${Math.floor(consent.at)}`;
  const parts = [
    `${CONSENT_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${MAX_AGE_DAYS * 24 * 60 * 60}`,
    "SameSite=Lax",
  ];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Browser: the visitor's current choice, or null if they haven't chosen yet. */
export function getConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  return readConsent(document.cookie);
}

/** Necessary cookies never need consent; optional ones need an explicit yes. */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === "necessary") return true;
  return getConsent()?.[category] === true;
}

/** Deletes a cookie both as host-only and on the suite domain. */
export function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  const domain = cookieDomainFor(location.hostname);
  if (domain) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax; Domain=${domain}`;
}

/** Saves the choice (suite-wide when hosted) and tells the page. */
export function saveConsent(choice: { preferences: boolean }): Consent {
  const consent: Consent = {
    version: CONSENT_VERSION,
    preferences: choice.preferences,
    at: Math.floor(Date.now() / 1000),
  };
  if (typeof document === "undefined") return consent;
  document.cookie = consentCookieString(consent, {
    domain: cookieDomainFor(location.hostname),
    secure: location.protocol === "https:",
  });
  if (!consent.preferences) PREFERENCE_COOKIES.forEach(deleteCookie);
  window.dispatchEvent(new CustomEvent<Consent>(CONSENT_EVENT, { detail: consent }));
  return consent;
}

/** Reopens the cookie settings (from a footer link or the user menu). */
export function openCookieSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}
