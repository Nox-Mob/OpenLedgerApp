// Browser Supabase client with cookie sessions (SHARED-SPEC §4.1).
// Hosted: the cookie is set on VITE_COOKIE_DOMAIN (".openapphub.org") so one
// sign-in covers every app. Self-hosted: no cookie domain.
// Cookie names include the project ref (sb-<ref>-auth-token), so staging and
// production sessions never collide.
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookieDomainFor } from "./hosted";

export type SupabaseConfig = { url: string; key: string };

/** Placeholder values in wrangler.jsonc (e.g. PROD_PROJECT_REF) count as "not configured". */
export function isPlaceholder(value: string | undefined): boolean {
  return !value || value.includes("PROJECT_REF") || /^[A-Z][A-Z0-9_]*$/.test(value);
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (isPlaceholder(url) || isPlaceholder(key)) return null;
  return { url: url as string, key: key as string };
}

export function cookieOptions() {
  const domain = cookieDomainFor(typeof location === "undefined" ? undefined : location.hostname);
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: typeof location === "undefined" ? true : location.protocol === "https:",
    ...(domain ? { domain } : {}),
  };
}

/**
 * A short-lived client for confirming it's you (core 0019): it signs in again in the background,
 * keeps its session in memory only (never in the shared cookie), and is signed out right after.
 */
export function createReauthClient(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config) return null;
  const memory = new Map<string, string>();
  return createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "oah-reauth",
      storage: {
        getItem: (k) => memory.get(k) ?? null,
        setItem: (k, v) => void memory.set(k, v),
        removeItem: (k) => void memory.delete(k),
      },
    },
  });
}

/**
 * Where a stale copy of this project's sign-in cookie may sit: every parent domain of this host
 * other than the one we use now, and the host itself (host-only) when we use a shared domain.
 * Example: staging once set its cookie on ".openapphub.org"; it now uses ".staging.openapphub.org".
 * A browser that signed in before the change still sends the old cookie, which signing out can't
 * clear, so it keeps the old person signed in. `undefined` in the list means host-only.
 */
export function staleCookieDomains(
  hostname: string,
  current: string | undefined,
): (string | undefined)[] {
  const labels = hostname.toLowerCase().split(".");
  const out: (string | undefined)[] = [];
  if (current) out.push(undefined);
  // Parents with at least two labels (never ".org"), from the widest to the host itself.
  for (let i = labels.length - 2; i >= 0; i--) {
    const d = `.${labels.slice(i).join(".")}`;
    if (d !== current?.toLowerCase()) out.push(d);
  }
  return out;
}

/** The cookie names @supabase/ssr uses for this project: sb-<ref>-auth-token, and its chunks. */
export function authCookiePrefix(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/**
 * Removes stale copies of this project's sign-in cookie (see staleCookieDomains). Only this
 * project's cookies are touched, so production and staging never sign each other out. Expiring a
 * cookie on one domain leaves the copy on the domain we use alone. Returns true when it removed
 * one, so the caller can reload: the page may have been drawn for the old person.
 */
export function clearStaleAuthCookies(config: SupabaseConfig | null = supabaseConfig()): boolean {
  if (typeof document === "undefined" || !config) return false;
  const current = cookieOptions().domain;
  if (!current) return false; // host-only sessions (self-hosted, previews): nothing can shadow them
  const prefix = authCookiePrefix(config.url);
  const count = () =>
    document.cookie
      .split(";")
      .map((c) => c.split("=")[0]!.trim())
      .filter((n) => n.startsWith(prefix));
  const before = count();
  for (const name of new Set(before)) {
    for (const d of staleCookieDomains(location.hostname, current)) {
      document.cookie = `${name}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ""}; SameSite=Lax${
        location.protocol === "https:" ? "; Secure" : ""
      }`;
    }
  }
  return count().length < before.length;
}

let client: SupabaseClient | null = null;

/**
 * Returns the browser client, or null when Supabase isn't configured yet or
 * when called during SSR (server code uses a per-request client instead).
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  if (clearStaleAuthCookies(config)) {
    // Once per tab session, so a cookie that can't be removed never causes a reload loop.
    let reloaded = true;
    try {
      reloaded = sessionStorage.getItem("oah-stale-cookie-reload") === "1";
      sessionStorage.setItem("oah-stale-cookie-reload", "1");
    } catch {
      // Storage blocked: don't reload.
    }
    if (!reloaded) location.reload();
  }
  client = createBrowserClient(config.url, config.key, { cookieOptions: cookieOptions() });
  return client;
}
