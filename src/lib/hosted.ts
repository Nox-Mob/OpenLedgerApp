// Hosted mode (VITE_HOSTED=true, SHARED-SPEC §1.1): sign-in, sign-up, password reset and
// creating organizations happen in OpenAppHub. Self-hosted and desktop: in Ledger, as always.
import { redirect } from "@tanstack/react-router";
import { hubUrl, isHosted, loginRedirect, suiteUrls } from "@shared/supabase/hosted";

/** This app's address, for the hub to send people back to. */
export function appUrl(path = "/ledger"): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : (suiteUrls().ledger ?? "");
  return `${origin}${path}`;
}

/** beforeLoad for Ledger's own sign-in pages: hosted, go to the hub's instead. */
export function hostedAuthRedirect(hubPath: "/login" | "/forgot-password" = "/login"): void {
  if (!isHosted()) return;
  throw redirect({
    href: hubPath === "/login" ? loginRedirect(appUrl()) : hubUrl(hubPath),
  });
}
