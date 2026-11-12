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
| `email/`              | Suite email (S-16): templates, Resend and SMTP transports, the sender (`deliver.ts`, server-only) and self-hosted settings (`selfhost.ts`, server-only)            |

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
- `1.14.1`: `AutomationsPanel` no longer resets a card on its first render (a late first effect
  could wipe what someone had just typed and switch Save off).
- `1.14.0`: named roles, and each app's role decided on its own (H-09, owner decision 2026-11-12).
  Core `0011_core_named_roles.sql`: the OpenAppHub role is for OpenAppHub only; `public.app_role`
  is the owner, else a role set for the person in that app, else their named role's role there,
  else viewer (`public.app_role_source` says which; `public.org_app_roles(org)` lists everyone).
  `public.org_named_roles` (one per person, `memberships.named_role_id`): a role per app and extra
  permissions from `public.app_permission_types` (apps register them with
  `public.register_app_permission`); `public.has_app_permission(org, app, key)`. `save_named_role`,
  `delete_named_role`, `set_named_role`, `set_invitation_roles` (an invitation carries a named role
  and/or each app's role). Editors for plan limits: `public.is_org_editor` (owner, OpenAppHub admins,
  member or admin in any app). Existing people's access is copied into roles per app once.
- `1.13.0`: a different role in each app. Core `0010_core_app_roles.sql`: `public.app_role_overrides`
  (an owner or admin sets someone's role for one app: admin, member or viewer; the owner is the owner
  everywhere), `public.app_role(org, app)`, `public.has_app_role`, `public.my_app_memberships(app)`
  and `public.set_app_role`; `public.can_write(org, app)` follows the app role. Apps check their
  role instead of the OpenAppHub role (Board 0013, Ledger 0007, Charter 0010).
- `1.12.0`: workflows each organization builds (S-25 part 2). Core `0009_core_workflows.sql`: When → If → Then
  workflows as data (`save_workflow`, validated by `_validate_workflow`; branches with conditions on any field
  the trigger carries, ordered fields like rank compared by place), run by the `core.workflows` email job
  (`run_workflows`) with a history per run; actions email, task (`automation_tasks`, on the task summary) and
  app actions queued in `automation_jobs`. The engine knows no app: apps register triggers
  (`register_automation_trigger`, events via `emit_automation_event` or date scans), actions
  (`register_automation_action`) and recipients (`register_automation_recipient`). Owners and admins edit,
  and may let others (`grant_automation_editor`); a national shares workflows its chapters' organizations
  may use on their own data (`adopt_workflow`), and decides whether they may build their own. New
  `automation/run.ts` (apps run their queued actions; the hub's scheduler asks them, signed) and the
  `automation.message` email template.
- `1.11.0`: the automation engine, first part (S-25). Core `0008_core_automations.sql`: apps
  register kinds of automation (`register_automation_kind`: defaults and a schema of what can
  change); organizations' choices are `public.automations` (no row = the defaults; owners and
  admins change them with `set_automation` / `reset_automation`; members read them with
  `list_automations`); jobs read `automation_settings(org, kind)` and record what they did with
  `log_automation` (kept a year). New `ui/Automations.tsx` (`AutomationsPanel`), on the hub's
  organization settings page and in each app. Board's reminders are the first automations.
- `1.10.0`: the task summary is sent (S-17). Core `0007_core_digest.sql`: each person chooses
  how often (daily, weekly or off), the day, the time and time zone, which of their organizations,
  and whether it includes tasks, meetings or both (`get_digest_preferences`,
  `set_digest_preferences`); `public.digest_for(user)` builds it from every app's `api_*` views
  under each app's rules, and the `core.digest` email job (`public.queue_digests`, every 15
  minutes) queues it once per local day, skipping people with nothing open. The `digest` template
  groups items by organization (`EmailContent.sections`). New `ui/DigestSettings.tsx`
  (`DigestFields`, `loadDigest`, `saveDigest`), used by `EmailPreferencesPanel` and the hub's
  account page.
- `1.9.2`: docs only. SHARED-SPEC: every internal doc is centralized in OpenAppHub's `docs/` (apps keep `docs/README.md` pointing there and the vendored spec).
- `1.9.1`: `EmailPreferencesPanel` says the task summary is coming soon (S-17 isn't sent yet).
- `1.9.0`: chapters on OpenBoardApp. Core `0006_core_child_orgs.sql`: an organization can have a
  parent (one level: a chapter's own organization under its national's), created only by an app's
  security definer function (`public._create_child_organization`, from Charter's approval).
  `listMyOrgs()` gives a chapter's organization its `parent`. The hub's billing 0004 covers a
  chapter with its parent's plan.
- `1.8.0`: email (S-16). Core `0005_core_email.sql`: the outbox every app queues email in
  (`public.enqueue_email`, from an app's own security definer jobs), email jobs
  (`public.email_jobs`), people's choices (`get_/set_email_preferences`), the self-hosted
  instance's SMTP settings and `is_instance_owner()`. `shared/email`: templates (one look for
  every email), Resend and a small SMTP client (Workers TCP sockets), the sender, signed
  unsubscribe links, and the self-hosted settings and sender. `shared/ui`: `EmailPreferencesPanel`
  and `EmailServerPanel`. Hosted: the hub sends everything through Resend. Self-hosted: each app
  sends its own through the SMTP server its owner enters.
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
