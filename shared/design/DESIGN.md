# OpenAppHub suite design system

Canonical copy: `Nox-Mob/OpenAppHub` `shared/design/`. Apps vendor it read-only (SHARED-SPEC §8).
To change anything, edit it in the hub, bump `shared/VERSION` and sync.

**Direction:** "Civic, slightly warm", chosen by the owner on 2026-11-09. Civic's clarity, compact
density, Inter and ink-navy primary, on warm neutrals (less warm than the Commons proposal). Dark
mode is a soft graphite gray, not near-black. The proposals and screenshots are in the hub's
`docs/design/`.

## Files

| File                                   | Use                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`                           | Every colour, font, size, radius, shadow and density value, as CSS variables (light on `:root`, dark on `.dark`, accent by `data-app`) |
| `tailwind.css`                         | Tailwind v4 mapping (`bg-background`, `text-muted-foreground`, `bg-app-accent`, `font-display`, `h-control`, `tnum`…) plus base styles |
| `tailwind-preset.ts`                   | The same mapping for a JavaScript Tailwind config                                                                                      |
| `../theme.ts`, `../ui/ThemeToggle.tsx` | Light / dark / system preference, shared across the suite                                                                              |
| `../format.ts`                         | The suite's money and date formats                                                                                                     |

Set-up in an app's main stylesheet:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@fontsource-variable/inter"; /* npm i @fontsource-variable/inter */
@import "../shared/design/tokens.css";
@import "../shared/design/tailwind.css";
```

In the root route: `<html lang="en" data-app={VITE_APP_ID} suppressHydrationWarning>`, and
`<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />` first in `<head>`.

## Rules

- **Tokens only.** Components use the variables or the Tailwind classes mapped to them. No Tailwind
  palette colours (`bg-green-600`), no hex or `oklch()` in app code. shadcn/ui components are themed
  only through tokens.
- **Primary is neutral in every app** (ink navy; light periwinkle in dark mode). Buttons and links
  use `--primary`, so the hub and the apps behave alike.
- **The app accent marks identity only:** brand mark, active nav item, selected tab, selected
  choice, chart series 1, OrgSwitcher dot. It never carries meaning and is never the only cue.
  The hub's accent is the primary.

| App     | Light                         | Dark                  |
| ------- | ----------------------------- | --------------------- |
| hub     | primary (ink navy)            | primary (periwinkle)  |
| charter | teal `oklch(0.47 0.09 195)`   | `oklch(0.8 0.1 195)`  |
| board   | violet `oklch(0.47 0.16 292)` | `oklch(0.8 0.11 292)` |
| ledger  | green `oklch(0.47 0.12 150)`  | `oklch(0.8 0.13 150)` |

- **Status** uses `--success`, `--warning`, `--destructive` and `--info`, always with a text label
  (badges also show a dot). Badge tones: neutral, info, success, warning, danger, outline.
  Map app statuses onto them, e.g. Board: draft → neutral, awaiting approval → info,
  approved/carried/done → success, failed/cancelled → danger, archived/superseded → outline;
  Charter standing: good → success, grace → warning, lapsed → danger, pending → outline.

## Type, shape, density

|           | Value                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------- |
| Font      | Inter (variable) for everything; monospace stack for code only. Headings 650 weight, -0.02em        |
| Sizes     | xs 12 · sm 13 · base 14 · lg 16 · xl 20 · 2xl 24 · 3xl 30 (px)                                      |
| Radius    | 6px (`--radius`); badges 4px; cards +2px; dialogs +4px                                              |
| Elevation | borders first; `--shadow-sm` on buttons, `--shadow-md` on cards, `--shadow-lg` on dialogs and menus |
| Density   | controls 36px (`--control-h`), table rows 44px (`--row-h`), card padding 20px                       |

## Layout

- `AppShell`: left sidebar (240px) and a 56px top bar with SuiteSwitcher, OrgSwitcher, Help and
  the user menu (which holds the theme toggle). `BillingBanner` sits under the top bar.
- Below 768px: the sidebar becomes a drawer; tables become cards (main cell, status on the right,
  meta on one line); dialogs become bottom sheets with full-width buttons; page actions go full
  width; tabs scroll sideways.
- Content max width 76rem, padding 28px/32px (16px on phones).

## Shared UI (`shared/ui`)

Wrap every signed-in page in `AppShell`. Pass your router's link so navigation stays client-side:

```tsx
import { AppShell } from "../shared/ui";
import { docsUrl } from "../shared/docs";
import { hubUrl, isHosted } from "../shared/supabase/hosted";

<AppShell
  app="board" // VITE_APP_ID
  nav={[{ label: "Meetings", href: "/meetings", icon: <CalendarIcon />, current: true }]}
  navFooter={[{ label: "Settings", href: "/settings" }]}
  user={{ name, email }}
  orgs={orgs} // listMyOrgs(client)
  currentOrgId={currentOrg?.id ?? null} // resolveCurrentOrg(orgs, cookie)
  onSelectOrg={() => router.invalidate()} // cookie already set
  orgCreateHref={isHosted() ? hubUrl("/orgs/new") : "/orgs/new"}
  billing={billing} // getOrgBilling(client, orgId); null = no banner
  canManageBilling={role === "owner" || role === "admin"}
  billingHref={hubUrl("/billing")}
  helpHref={docsUrl("board/")}
  onSignOut={signOut}
  LinkComponent={RouterLink} // ({ href, ...props }) => <Link to={href} {...props} />
>
  {page}
</AppShell>;
```

| Component        | Notes                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AppShell`       | Sidebar (240px) + top bar; drawer below 768px (focus trapped, Escape closes); skip link; user menu holds the theme toggle, Account, Help and Sign out  |
| `SuiteSwitcher`  | Lists apps from `VITE_SUITE_URLS`; hidden when only this app is known (self-hosted)                                                                    |
| `OrgSwitcher`    | Sets `oah_org` (suite-wide when hosted) and calls `onSelect`; "Create organization" only if you pass `createHref`                                      |
| `BillingBanner`  | Wording from `billingNotice()`: trial days left, payment problem, plan ending, read-only (always says export still works). Nothing when billing is off |
| `HelpLink`       | `<HelpLink path="board/meetings/">How minutes are approved</HelpLink>`; opens the docs in a new tab                                                    |
| `InvitationPage` | `/invite/<token>` flow with the app follow-up hook (below)                                                                                             |

### `InvitationPage` and the follow-up hook

```tsx
<InvitationPage
  token={token}
  app="board"
  client={supabase}
  signInHref={(next) =>
    isHosted() ? loginRedirect(next) : `/auth?next=${encodeURIComponent(next)}`
  }
  continueHref={() => "/meetings"}
  onAccepted={async (inv, client) => {
    const { error } = await client
      .schema("board")
      .rpc("on_invitation_accepted", { p_invitation_id: inv.id });
    if (error) throw error; // shown with a "Try again" that retries only this step
  }}
/>
```

It shows the organization and role (`get_invitation`), sends signed-out visitors to sign in and
back, accepts on an explicit click (`accept_invitation`), then runs `onAccepted` only for
invitations whose `app` is this app. An invitation for **another** app is sent to that app's
`/invite/<token>` **before** it's accepted, so the follow-up always runs where it belongs.

## Cookie consent (every app)

Render the banner **once** in the root layout, next to the router outlet:

```tsx
import { CookieConsent } from "../shared/ui";
<CookieConsent policyHref={isHosted() ? hubUrl("/cookies") : "/cookies"} privacyHref={...} />
```

- **Required** cookies (sign-in session, `oah_org`, `oah_consent`) are always on and have no switch.
- **Preferences** (`oah_theme`) are **off until the visitor agrees** (GDPR/ePrivacy require opt-in).
  Without consent the theme still works for the browser session only.
- "Accept all" and "Reject non-essential" look the same, nothing optional is pre-selected, and
  choices can be changed any time: `openCookieSettings()` (in `AppShell`'s user menu already; add
  a footer link on public pages).
- One choice covers the whole suite (`oah_consent` on the suite domain, 180 days, then we ask again).
- Withdrawing consent deletes preference cookies immediately.
- **Adding a cookie or browser storage:** add it to `COOKIES` in `shared/consent.ts` with its
  category, purpose and duration (the banner and cookie policy read that list). Anything not
  required must check `hasConsent("<category>")` first. A new category means a new entry in
  `CookieConsent`'s list and a bump of `CONSENT_VERSION`, so everyone is asked again.
- Self-hosted apps show the same list on their own page with `<CookieTable />`.

## Money and dates (every app)

Use `shared/format.ts`. Never `toFixed(2)`, `toLocaleString()`, `toLocaleDateString()` or a local helper.

| What                           | Format                                                   | Helper                                        |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------- |
| Money                          | `$1,234.56` · negative `-$1,234.56` · optional `+$50.00` | `formatMoney(cents, { currency, sign })`      |
| Money in exports               | `1234.56`                                                | `formatAmount(cents)`                         |
| Date                           | `Nov 9, 2026`                                            | `formatDate(value, { timeZone })`             |
| Date and time                  | `Nov 9, 2026, 2:30 PM`                                   | `formatDate(value, { time: true, timeZone })` |
| Date in exports and file names | `2026-11-09`                                             | `formatDateISO(value, { timeZone })`          |

- Money is stored as integer cents (`bigint`) and shown with two decimals, US-style grouping and
  the org's currency (`"USD"` by default; `€1,234.56`, `CA$1,234.56`).
- Money columns are right-aligned with tabular figures (`tnum`); negatives use `--destructive`
  in money columns only.
- Dates use the **org's** time zone when it has one. Calendar dates (`"2026-11-09"`, e.g. a meeting
  date or due date) never shift with the time zone. Never show a relative time ("3 days ago") alone.

## Dark mode

- Three choices: **Light**, **Dark** and **System** (the default: follows the device and keeps
  following it).
- The choice is the `oah_theme` cookie. In hosted mode it's set on `.openapphub.org`, so choosing a
  theme in any app makes it the default in every app. Self-hosted, it's per site.
- The toggle lives in the user menu (`ThemeToggle`); until `AppShell` exists, the hub shows it in
  the page header and on sign-in screens.
- `themeInitScript()` applies the choice before the first paint, so there's no flash.

## Accessibility

- Text ≥ 4.5:1; UI boundaries (input borders, focus ring, accent marks) ≥ 3:1. Every pair is
  checked in light and dark by `scripts/design-screenshots.mjs` (`docs/design/contrast.md`).
- Visible focus ring (`--ring`, 2px, offset 2px) on every interactive element.
- Every input has a label; errors are linked with `aria-describedby` and use `--destructive` text,
  not colour alone. Full keyboard use; dialogs trap focus and close on Escape.
