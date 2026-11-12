# shared/

Canonical shared code for the OpenAppHub suite (SHARED-SPEC §8). Apps vendor a read-only copy;
never edit it in an app repo. Change it here, bump `VERSION`, then sync it into each app
(`scripts/sync-shared.mjs`, step 8).

| Path                  | What                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `design/`             | Tokens, Tailwind mapping and preset, `DESIGN.md` (read it first)                                                                                                   |
| `ui/`                 | `AppShell`, `SuiteSwitcher`, `OrgSwitcher`, `BillingBanner`, `HelpLink`, `InvitationPage`, `ThemeToggle`, `CookieConsent`, `CookieTable` (import from `shared/ui`) |
| `format.ts`           | The suite's money and date formats: use these, never local helpers                                                                                                 |
| `theme.ts`            | Light / dark / system, shared across the suite (saved only with consent)                                                                                           |
| `consent.ts`          | Cookie consent: categories, the catalogue of every cookie, `hasConsent()`, `openCookieSettings()`                                                                  |
| `supabase/client.ts`  | Cookie-session browser client (§4.1)                                                                                                                               |
| `supabase/hosted.ts`  | `isHosted()`, `hubUrl()`, `loginRedirect()`, `suiteUrls()`, cookie domain                                                                                          |
| `supabase/org.ts`     | Current organization (`oah_org` cookie), `listMyOrgs()`                                                                                                            |
| `supabase/billing.ts` | `getOrgBilling()` (feature-detected), access rule, banner wording                                                                                                  |
| `docs.ts`             | Links into docs.openapphub.org                                                                                                                                     |
| `apps.ts`             | App names, taglines and marks                                                                                                                                      |

## Requirements in an app

- React 19, Tailwind v4 with `design/tailwind.css` imported (see `DESIGN.md`), so Tailwind scans
  `shared/` for classes.
- `@supabase/supabase-js` and `@supabase/ssr`.
- No icon library, no Radix: shared UI uses inline icons and plain elements, so it doesn't
  depend on the apps' versions of those.
- Everything renders under SSR (no `window` during render); `shared/ui/ssr.test.tsx` checks it.

## Versions

- `1.0.0`: design system, shared UI and helpers complete (AGENTS step 7).
- `1.1.0`: cookie consent (banner, settings, cookie catalogue); the theme is saved only with consent.
- `1.1.1`: migration runner comment only (the hub's billing migration is `0002_billing`).
- `1.2.0`: core `0004_core_org_settings.sql` (organization time zone and currency; ownership
  transfer only to active members, confirmed by typing their name); `getOrgPreferences()` in
  `shared/supabase/org.ts`.
- `1.3.0`: SHARED-SPEC v2.3 (prices in Stripe, editor limits, set-based row rules); shared UI
  compiles under the apps' strictest TypeScript settings (`exactOptionalPropertyTypes`), checked
  by `npm run check:shared-strict` in CI.
- `1.3.1`: `AppShell` takes an optional `sidebar` (desktop-only extra sidebar content, e.g. a
  page's own section menu).
- `1.7.0`: cross-app integrations (S-12, S-13). `shared/integrations/detect.ts` (`isMissing`: the other
  app isn't on this database), `shared/integrations/board.ts` (upcoming Board meetings, add a report
  PDF to one through `board.add_report_to_meeting`) and `AddToBoardPackage` (`shared/ui`), the
  "Add to a board package" button every app puts next to its reports.
- `1.6.0`: `isReadOnly(billing, app)` (`shared/supabase/billing.ts`): true when billing makes the app
  read-only for the organization. Apps use it to switch their write controls off (S-05); reading
  and exporting stay on.
- `1.5.0`: the suite's logos. `shared/brand/marks.ts` draws one family of marks (H, C, B, L on each
  app's accent tile, with the suite's "open" dot); `AppLogo` shows it in the shell, the app
  switcher and the hub. The hub's `scripts/brand-assets.ts` writes each app's favicon (SVG, ICO,
  apple-touch) and transparent PNGs (16–1024 px) into its `public/`.
- `1.4.1`: docs only. SHARED-SPEC §2 says the old build tooling is removed (no editor-specific packages,
  preview helpers or hosts); no code changes.
- `1.4.0`: open apps straight into an organization. `appOrgUrl()` (`shared/apps.ts`) gives each
  app's address for one organization; `takeOrgFromUrl()` (`shared/supabase/org.ts`) makes a link's
  `?org=` the current org. The app switcher is a clear button (bordered, the app's accent colour,
  "Switch app" and a dropdown arrow) and opens the other apps in the current organization.
