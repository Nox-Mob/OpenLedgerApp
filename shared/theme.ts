// Light / dark / system theme for every app (SHARED-SPEC §9).
//
// With the visitor's consent to preference cookies (shared/consent.ts), the
// choice is the `oah_theme` cookie. In hosted mode it's set on
// VITE_COOKIE_DOMAIN (".openapphub.org"), so choosing a theme in one app makes it
// the default in every app of the suite. Without consent the choice still works,
// but only for the browser session (sessionStorage), and no cookie is set.
// "system" (the default) follows the device's light/dark setting.
//
// themeInitScript() goes in <head> so the right class is on <html> before the
// first paint (no flash); it needs `suppressHydrationWarning` on <html>.

import { deleteCookie, hasConsent } from "./consent";
import { cookieDomainFor } from "./supabase/hosted";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_COOKIE = "oah_theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];
const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function readThemeCookie(cookieHeader: string): ThemePreference {
  const match = cookieHeader.match(/(?:^|;\s*)oah_theme=([^;]*)/);
  return parseTheme(match?.[1]);
}

export function themeCookieString(
  pref: ThemePreference,
  opts: { domain?: string | undefined; secure?: boolean } = {},
): string {
  const parts = [`${THEME_COOKIE}=${pref}`, "Path=/", `Max-Age=${ONE_YEAR}`, "SameSite=Lax"];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Applies a preference to <html>: the `dark` class and data-theme="<preference>". */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolveTheme(pref, systemPrefersDark()) === "dark");
  root.dataset["theme"] = pref;
}

const SESSION_KEY = "oah_theme";

function sessionTheme(): ThemePreference | null {
  try {
    const v = window.sessionStorage.getItem(SESSION_KEY);
    return v ? parseTheme(v) : null;
  } catch {
    return null;
  }
}

function setSessionTheme(pref: ThemePreference | null): void {
  try {
    if (pref) window.sessionStorage.setItem(SESSION_KEY, pref);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the choice lasts until the page reloads
  }
}

function writeThemeCookie(pref: ThemePreference): void {
  document.cookie = themeCookieString(pref, {
    domain: cookieDomainFor(location.hostname),
    secure: location.protocol === "https:",
  });
}

export function getThemePreference(): ThemePreference {
  if (typeof document === "undefined") return "system";
  if (/(?:^|;\s*)oah_theme=/.test(document.cookie)) return readThemeCookie(document.cookie);
  return sessionTheme() ?? "system";
}

/**
 * Applies the choice and remembers it: in the cookie (suite-wide) with consent
 * to preference cookies, otherwise for this browser session only.
 */
export function setThemePreference(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  if (hasConsent("preferences")) {
    writeThemeCookie(pref);
    setSessionTheme(null);
  } else {
    setSessionTheme(pref);
  }
  applyTheme(pref);
}

/**
 * Keeps the theme in line with consent: with consent, a session choice moves
 * into the cookie; without it, any theme cookie is removed and the choice is
 * kept for the session only.
 */
export function syncThemeWithConsent(): void {
  if (typeof document === "undefined") return;
  const current = getThemePreference();
  if (hasConsent("preferences")) {
    const fromSession = sessionTheme();
    if (fromSession) {
      writeThemeCookie(fromSession);
      setSessionTheme(null);
    }
  } else if (/(?:^|;\s*)oah_theme=/.test(document.cookie)) {
    setSessionTheme(current);
    deleteCookie(THEME_COOKIE);
  }
}

/** Re-applies "system" when the device switches between light and dark. */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getThemePreference() === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Inline <head> script: applies the saved preference before the first paint. */
export function themeInitScript(): string {
  return `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)oah_theme=(light|dark|system)/);var s=null;try{s=sessionStorage.getItem("oah_theme")}catch(e){}var p=m?m[1]:(s==="light"||s==="dark"?s:"system");var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=p;}catch(e){}})();`;
}
