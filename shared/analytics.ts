// Cloudflare Web Analytics, on production only (owner request, 2026-11-15). Cloudflare's
// automatic injection is off for openapphub.org; instead each production build adds the script
// itself. VITE_CF_ANALYTICS_TOKEN is set in the production `vars` of each wrangler.jsonc and never
// in the previews (staging and branch previews), so nothing is measured or loaded there.
// Web Analytics sets no cookies and doesn't track people across sites.

export const ANALYTICS_SCRIPT = "https://static.cloudflareinsights.com/beacon.min.js";
/** What the Content Security Policy must allow when analytics is on. */
export const ANALYTICS_CSP = {
  script: "https://static.cloudflareinsights.com",
  connect: "https://cloudflareinsights.com",
} as const;

/** The site's public Web Analytics token, or null when analytics is off (always off off production). */
export function analyticsToken(
  raw: string | undefined = import.meta.env.VITE_CF_ANALYTICS_TOKEN,
): string | null {
  return raw && /^[a-f0-9]{32}$/.test(raw) ? raw : null;
}

/** The <script> to put in the page's head (TanStack Start `head().scripts`), or nothing. */
export function analyticsScripts(token: string | null = analyticsToken()) {
  return token
    ? [
        {
          src: ANALYTICS_SCRIPT,
          defer: true,
          "data-cf-beacon": JSON.stringify({ token }),
        },
      ]
    : [];
}
