# shared/

Canonical shared code for the OpenAppHub suite (SHARED-SPEC §8). Apps vendor a read-only copy;
never edit it in an app repo. Change it here, bump `VERSION`, then sync it into each app
(`scripts/sync-shared.mjs`, step 8).

| Path                  | What                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `design/`             | Tokens, Tailwind mapping and preset, `DESIGN.md` (read it first)                                                                                                               |
| `ui/`                 | `AppShell`, `SuiteSwitcher`, `OrgSwitcher`, `BillingBanner`, `HelpLink`, `InvitationPage`, `ThemeToggle`, `CookieConsent`, `CookieTable`, `TwoStep*` (import from `shared/ui`) |
| `format.ts`           | The suite's money and date formats: use these, never local helpers                                                                                                             |
| `theme.ts`            | Light / dark / system, shared across the suite (saved only with consent)                                                                                                       |
| `consent.ts`          | Cookie consent: categories, the catalogue of every cookie, `hasConsent()`, `openCookieSettings()`                                                                              |
| `supabase/client.ts`  | Cookie-session browser client (§4.1)                                                                                                                                           |
| `supabase/hosted.ts`  | `isHosted()`, `hubUrl()`, `loginRedirect()`, `suiteUrls()`, cookie domain                                                                                                      |
| `supabase/org.ts`     | Current organization (`oah_org` cookie), `listMyOrgs()`                                                                                                                        |
| `supabase/billing.ts` | `getOrgBilling()` (feature-detected), access rule, banner wording                                                                                                              |
| `docs.ts`             | Links into docs.openapphub.org                                                                                                                                                 |
| `apps.ts`             | App names, taglines and marks                                                                                                                                                  |
| `email/`              | Suite email (S-16): templates, Resend and SMTP transports, the sender (`deliver.ts`, server-only) and self-hosted settings (`selfhost.ts`, server-only)                        |

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
- `1.17.0`: approvals and actions from email (C-08, owner decisions 2026-11-13). Core
  `0014_core_approvals.sql`: the designer's **Ask for approval** step (`public.approval_requests`,
  `public.approval_approvers`; the builder chooses "first answer decides" or "everyone must approve",
  and an optional time limit with the outcome `timed_out`; `decide_approval`, `my_approvals`,
  `approval`). **Actions from email**: each organization allows each kind (`email_action_kinds`,
  `email_action_settings`, off by default; `set_email_action_allowed`); `action_links_for` makes one
  person's single-use, 7-day signed links (only their SHA-256 is stored); `action_link` /
  `consume_action_link` serve the confirm page, which calls the app's own function as the signed-in
  person. `notify()` takes `p_actions` and `p_action_kind`. Emails show the links as buttons
  (`data.actions`). `ActionLinkPage` (each app's `/act/<token>`) and `EmailActionSettingsPanel`.
  Notifications to particular people (tasks, approvals) can't be turned on by anyone else.
- `1.18.0`: **No access** in an app, and an organization setting for app admins (owner decisions
  2026-11-13). Core `0015_core_app_access.sql`: `app_role_overrides.no_access`, and a named role may
  give an app `"none"`; `app_role()` is null for them (the owner always has access), `can_open_app`
  says whether a person can open an app, `my_app_memberships` leaves those organizations out,
  `org_app_roles` lists them with role null, `has_app_permission` gives them nothing;
  `set_app_access(org, user, app, no_access)`. `public.org_role_settings` (`app_admins_manage_roles`,
  off by default; `org_role_settings`, `set_org_role_settings`): when on, an app's admins may change
  people's roles (and No access) in that app only; named roles and OpenAppHub roles stay with the
  owner and OpenAppHub admins. Each app keeps people with No access out at its own read gate.
- `1.19.0`: pre-production tuning (2026-11-14). Core `0016_core_tuning.sql`:
  `public._tune_schema(schema)` makes every row-level security policy in a schema call
  `auth.uid()` / `auth.jwt()` / `auth.role()` once per query (`(select auth.uid())`) and indexes
  every foreign key that has no index (partial on a nullable single column);
  `public.tuning_problems(schema)` lists what's left, for tests. Each repo calls it for its own
  schemas in a migration after its last policy change, and tests that nothing is left.
- `1.21.0`: security round 2 (2026-11-14). Core `0018_core_auth_hardening.sql`: a person with a
  verified authenticator must be signed in with it (session `aal2`) to see any organization's data
  (`is_member`, `has_role`, `is_member_of_child`, `app_role`); the organization setting
  `org_role_settings.require_mfa_admins` (`set_org_require_mfa`, `org_security_settings`) makes the
  owner and admins set one up; `my_mfa_status()` says who is blocked and why;
  `assert_recent_sign_in(minutes)` (default 15) guards deleting an organization, transferring
  ownership and deleting an account; every function is closed to `PUBLIC` and `anon` except
  `_anon_allowed_functions()`, done by `_tune_schema`, and `tuning_problems` reports any function
  anyone can call without signing in. `shared/ui/TwoStep.tsx`: `TwoStepGate` (asks for the code when
  the session needs it), `TwoStepSettings` (set up and remove an authenticator), `OrgTwoStepPanel`
  (the organization setting) and `TwoStepNotice` (tells blocked owners and admins what to do).
- `1.20.0`: security review (2026-11-14, OWASP Top 10). Core `0017_core_security.sql`: stored
  links (notifications, workflow tasks, action links) must be paths in the suite; outbox addresses
  must be one plain address; registry function names must be `schema.function`; at most 100
  invitations an hour and 500 a day per organization; one read policy on `organizations`;
  `tuning_problems` also reports two permissive policies for the same action. `shared/safe-path.ts`
  (`safePath`) checks links from data before they become an `href` (Notifications, ActionLink);
  `shared/email/smtp.ts` refuses an address that isn't one plain address.
- `1.16.0`: notifications (H-02, owner direction 2026-11-13), apart from the automation engine. Core
  `0013_core_notifications.sql`: `public.notification_kinds` (registered with
  `public.register_notification_kind`: who gets it by default, who may turn it on, its email kind),
  each person's choice per kind (`public.notification_preferences`, in the app and by email), the list
  (`public.notifications`), and `public.notify(org, kind, title, body, link, link_app, users, emails,
dedupe, actor)`, which writes the list and queues the email (template `notification`). The core
  raises people joined, left and roles changed (to the owner), a task given to you, and a workflow
  that couldn't finish. `NotificationBell` (the bell in `AppShell`'s top bar: pass
  `notificationsClient`) and `NotificationSettings` (each person's choices). `Dropdown` takes
  `onOpenChange`.
- `1.15.0`: the low-code workflow designer's engine (S-28). Core `0012_core_designer.sql`: version 2
  definitions (a trigger, then steps that nest: condition, switch, foreach, scope; variables; compose,
  filter, select, join, aggregate; wait; terminate; email; task; the apps' steps). Every step's output
  can be used by later steps (`{{steps.<id>.<field>}}`, `{{item.<field>}}`, `{{vars.<name>}}`,
  `{{trigger.<field>}}`). Steps can retry and "run after" earlier steps failed or were skipped. The
  runner records each step's status and output in the run, so runs pause (waits, retries, app jobs) and
  carry on without repeating anything. `public.register_automation_step` (kind `query`, `call` or
  `job`, with an output schema), `public.test_workflow` (a run that only describes what it would do),
  `public.sample_trigger_data`. When → If → Then workflows keep running as before.
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
