# Dependencies

npm is the only package manager (`package-lock.json`). Core libraries that touch money, data or sign-in are pinned to exact versions; UI helpers use caret ranges and are locked by `package-lock.json`.

| Package                                            | Why it is here                          | Pinned |
| -------------------------------------------------- | --------------------------------------- | ------ |
| @tanstack/react-start, react-router, router-plugin | App framework and routing               | yes    |
| react, react-dom                                   | UI                                      | yes    |
| @supabase/supabase-js                              | Cloud and self-hosted database, sign-in | yes    |
| zod                                                | Input checks in every server function   | yes    |
| @tanstack/react-query                              | Data fetching and caching               | yes    |
| exceljs                                            | Excel exports                           | yes    |
| jspdf, jspdf-autotable                             | PDF reports                             | yes    |
| sql.js (dev)                                       | SQLite adapter contract tests           | yes    |
| postgres (dev)                                     | Driver used by the migration tool       | caret  |
| radix-ui, lucide-react, recharts, sonner, etc.     | UI components and charts                | caret  |

Rules: add a package only when the shared domain or a port can't do it; record it here; never commit registry cache URLs in `package-lock.json` (registry.npmjs.org only).

Audit overrides (package.json): `brace-expansion@1` → 1.1.21, `brace-expansion@5` → 5.0.12, `uuid` → 11.1.1 (only exceljs uses it), `@esbuild-kit/core-utils > esbuild` → 0.25.12. Never run `npm audit fix --force`; it downgrades exceljs to 3.4.0.
npm 11 or newer is required: npm 10 rejects this lock file in `npm ci`. CI uses Node 24. Install scripts: approve only `esbuild` (it fetches its own build tool); core-js only prints a donation message.

pg (dev) runs the migration runner (`scripts/migrate.mjs`, vendored from OpenAppHub). drizzle-kit and drizzle-orm were removed with the old migration path.
eslint 10 runs with the two classic React hook rules; the newer React Compiler rules in eslint-plugin-react-hooks 7 are not enabled yet (roadmap).
