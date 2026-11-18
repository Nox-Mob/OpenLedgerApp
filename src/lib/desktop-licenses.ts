// The desktop app ships Rust libraries the web suite doesn't (SHARED-SPEC §10.3).
import type { Library } from "@shared/ui/About";

/** The suite's libraries plus the desktop app's Rust ones, sorted by name. */
export function withDesktopLibraries(suite: Library[], rust: Library[]): Library[] {
  const seen = new Set(suite.map((l) => `${l.name}\u0000${l.license}`));
  const extra = rust.filter((l) => !seen.has(`${l.name}\u0000${l.license}`));
  return [...suite, ...extra].sort(
    (a, b) => a.name.localeCompare(b.name) || a.license.localeCompare(b.license),
  );
}
