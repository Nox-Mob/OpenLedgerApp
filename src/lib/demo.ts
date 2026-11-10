export const DEMO_EMAIL = "ledger.demo@demo.openapphub.org";

/** Demo sign-in is allowed on dev servers and editor preview links, or when a self-hoster sets VITE_ALLOW_DEMO_LOGIN=true. */
export function demoAllowedHere(): boolean {
  if (import.meta.env.DEV || import.meta.env["VITE_ALLOW_DEMO_LOGIN"] === "true") return true;
  if (typeof window === "undefined") return false;
  return (
    /(^|\.)id-preview(-[a-z0-9]+)*--/i.test(window.location.hostname) ||
    window.location.hostname === "localhost"
  );
}
