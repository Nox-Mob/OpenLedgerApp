# Desktop startup: skip the website, open setup or the ledger

## Goal
When OpenLedgerApp runs as the desktop app, it never shows the public website, sign-in, or legal-acceptance screens. First launch opens organization setup; every later launch opens the ledger for the last-used organization. The cloud and self-hosted web editions stay exactly as they are.

## User experience
```text
Launch app
  -> any local organization?
       no  -> /onboarding (set up your books)  -> /ledger
       yes -> last-used org (or first one)     -> /ledger
```
- Website pages (`/`, `/changelog`, `/get-started`) and `/auth`, `/reset-password`, `/invite/...` redirect to the start decision above on desktop.
- Terms, Privacy and Not advice stay reachable from the sidebar footer (read-only, no acceptance gate).
- Sidebar hides Sign out and member/invite items on desktop.

## Steps
1. **Desktop flag.** Add `src/lib/edition.ts` with `isDesktop()`: true when built with `VITE_EDITION=desktop` (set by a new `build:desktop` / `dev:desktop` npm script) or when the Tauri runtime is detected. Build-time flag is the source of truth so desktop builds can tree-shake the website.
2. **Start decision.** Add `src/lib/desktop-start.ts` exporting `desktopStartTarget(orgs, storedId)` that returns `/onboarding` when there are no orgs, else `/ledger` after storing the chosen org via `pickCurrentOrg`. Pure function, unit tested.
3. **Root redirect.** In `src/routes/index.tsx` (and the other website/auth routes) add a `beforeLoad` that, on desktop, throws a redirect to the start target. Web behavior unchanged.
4. **Authenticated layout.** In `src/routes/_authenticated/route.tsx`, on desktop skip `supabase.auth.getUser()` and `LegalGate`; provide a fixed local admin user in context instead.
5. **Org list source.** `useOrgContext` reads organizations from the local SQLite repositories on desktop rather than the cloud. If the local org-list port is missing, add `listOrganizations()` to the settings port and the SQLite/memory adapters (with a contract test).
6. **Onboarding on desktop.** Onboarding saves through the shared settings service with SQLite repos and, when done, navigates to `/ledger`. Hide the "invite people" step.
7. **Shell tweaks.** `AppShell` hides Sign out, members and invite links when `isDesktop()`.
8. **Tauri build.** Desktop builds as a static single-page app (no server rendering) so it loads from files; point `src-tauri/tauri.conf.json` `beforeDevCommand`/`beforeBuildCommand` at the new desktop scripts and `frontendDist` at the static output.
9. **Tests and docs.** Unit tests: start target for zero orgs, stored org, stale stored org; web edition still renders the website at `/`. Update `docs/desktop.md`, `docs/architecture.md`, CHANGELOG Unreleased, and an AGENTS.md rule on the edition flag.

## Out of scope
Sync, multiple local users, desktop bank-file import/AI PDF (still cloud-only), installer packaging.

## Technical notes
- The redirect must not run during cloud server rendering: desktop builds have SSR off, and `isDesktop()` is false on the web, so the web `/` stays public as AGENTS.md requires.
- Features that are still cloud-only (members, import parsing, taxonomy setup) will show a "not available on desktop yet" state instead of erroring.
- Step 8 must be verified on your machine with the Rust toolchain (`npm run tauri dev`); it cannot run here.
