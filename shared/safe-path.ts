// Links that come from data (notifications, tasks, action links) are paths inside the suite.
// A path must start with one "/": "//evil.example" and "/\evil.example" are other sites to a
// browser, and "javascript:…" isn't a path at all. The database refuses these too (core 0017);
// this is the second check, where the link becomes an href.

/** The path if it's a safe in-suite path ("/billing", "/orgs/…?tab=x"), otherwise null. */
export function safePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  return /^\/(?!\/)/.test(value) ? value : null;
}
