// Security headers for every response from the Worker (docs/SHARED-SPEC.md §10.1).
// Set by the server entry (src/server.ts), not public/_headers: Workers don't read that file.
// script-src keeps 'unsafe-inline' because SSR hydration and the theme bootstrap are inline
// scripts; switching to per-request nonces is a later hardening step.

/** Origins for connect-src: the Supabase REST/Auth URL plus its realtime (wss) twin. */
export function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) return [];
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    const ws = u.protocol === "https:" ? "wss:" : "ws:";
    return [u.origin, `${ws}//${u.host}`];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    ["connect-src 'self'", ...supabaseOrigins(supabaseUrl)].join(" "),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(supabaseUrl: string | undefined): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    // HTTPS only, two years, every subdomain; no camera, microphone, location or payment request
    // (the suite uses none); own browsing context group (security review 2026-11-14).
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": contentSecurityPolicy(supabaseUrl),
  };
}

/** Copy of `response` with the security headers set (headers on fetched responses can be immutable). */
export function withSecurityHeaders(response: Response, supabaseUrl: string | undefined): Response {
  // 1xx (e.g. a WebSocket upgrade) can't be rebuilt with new Response(); pass it through.
  if (response.status < 200) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(securityHeaders(supabaseUrl))) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
