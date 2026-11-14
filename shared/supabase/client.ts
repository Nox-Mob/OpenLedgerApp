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
  client = createBrowserClient(config.url, config.key, { cookieOptions: cookieOptions() });
  return client;
}
