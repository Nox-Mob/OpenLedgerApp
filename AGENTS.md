<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# AGENTS.md — OpenLedgerApp (Nox-Mob/OpenLedgerApp)

## Suite migration (v2)

**Read `docs/SHARED-SPEC.md` (v2) first.** Your step plan, inventory and status are `docs/MIGRATION-NOTES.md` (§7 is the plan; §7.1 lists which codebase rules below are replaced and in which step). This section gives the owner's answers and the changes v2 makes to the plan.

App ID `ledger` · schema `ledger` · hosted at `ledger.openapphub.org` (staging `staging.ledger.staging.openapphub.org`) · package manager **npm**.

Ledger's backend today is the Lovable Cloud project `pzzmmltmghmgfwhgzlvl`. It's built fresh in the shared project; nothing is copied. The Lovable project is retired at the end.

The **desktop edition** (Tauri + SQLite) keeps working throughout and stays free for one person ("Ledger Solo"); it's unaffected by the schema move except for keeping its schema in parity (D13).

---

### Owner answers to your notes (§6)

| Your item                | Answer                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 inputs                | Spec §0.1 is filled in. **Design is a full refresh** for every app (spec §9): Ledger isn't a reference app; restyle in step 14 once the hub's direction is approved.                                                                                                                                                                                          |
| D2 hosting, service role | **Workers** (spec §10). Service-role use in hosted mode: **none** (spec §7.2). Invites, org deletion and account deletion move to the hub; history writes go fully through `ledger.audited_write`; restore creates the org with `public.create_organization()` as the caller. Self-hosted-only features may keep the service role behind `VITE_HOSTED=false`. |
| D3 treasurer             | `ledger.member_roles` overlay, as proposed (spec §3.5).                                                                                                                                                                                                                                                                                                       |
| D4 MFA                   | Keep `ledger.mfa_ok` in Ledger's policies, as proposed.                                                                                                                                                                                                                                                                                                       |
| D5 sessions              | As proposed: shared cookie client in the browser; server functions keep the bearer token.                                                                                                                                                                                                                                                                     |
| D6 deletion              | Hosted: org and account deletion in the hub. Self-hosted: keep Ledger's, built on `public.delete_organization`; `deleted_organizations` self-hosted only.                                                                                                                                                                                                     |
| D7 legal                 | Hosted: the hub records acceptance; Ledger keeps `ledger.legal_acceptances` for self-hosted and Ledger-specific consent.                                                                                                                                                                                                                                      |
| D8 AI PDF import         | **Turn it off** (hide the option, refuse on the server) until the owner picks a provider. Then add it with a server-only key. Google sign-in: plain Supabase OAuth (self-hosted), the hub (hosted).                                                                                                                                                           |
| D9–D13                   | Accepted as proposed.                                                                                                                                                                                                                                                                                                                                         |
| Invitations              | **Core, handled by the hub** (spec §4.3). `org_invites` isn't recreated. Ledger keeps an `/invite/<token>` page on `shared/ui/InvitationPage` and adds `ledger.on_invitation_accepted(p_invitation_id)` to set the treasurer overlay from `app_payload`. Expiry becomes the core 14 days (it was 7).                                                          |
| Ownership                | **Core, transferred in the hub** (spec §4.4). `organizations.created_by` ownership is replaced by the core owner. Self-hosted: Ledger's transfer screen calls `public.transfer_ownership`.                                                                                                                                                                    |
| Demo                     | **Staging only** (spec §11). Port `supabase/seed/demo.sql` to `db/seed/0001_ledger_demo.sql`, keeping its refusal to run on real data; demo addresses on `@demo.openapphub.org`.                                                                                                                                                                              |

### Changes to your plan (§7)

- **Step 3 (hygiene):** also add `staging.yml` and `release.yml` (spec §10.2) and switch off any build that deploys production from `main`.
- **Step 4 (vendor):** retire the old migration paths and point `check-migrations.mjs` at `db/` (spec §3.3), in the same PR.
- **Step 5 (baseline):** write helpers always include `public.can_write(org_id,'ledger')` and `ledger.mfa_ok(org_id)`; `ledger.org_settings`, `ledger.user_preferences`, `ledger.member_roles`; `ledger.on_invitation_accepted`. If Ledger ever stores files, the bucket is `ledger-files`.
- **Step 10 (hosted vs self-hosted):** hosted links out to the hub for sign-in, org creation and deletion, core roles, invitations, ownership and account deletion. The treasurer overlay stays in Ledger. Hosted `/` → `/ledger`.
- **Step 14 (design):** adopt the new shared design in the web **and** desktop builds. Separate PRs, before/after screenshots, behaviour and visible text unchanged unless the owner approves.

### Phase 5 — Documentation (steps 15–16)

Docs live in `Nox-Mob/OpenAppHub-docs` under `src/content/docs/ledger/` (spec §12).

15. **Help links** (`src/config/help.ts`). In the desktop edition, links open in the system browser.

    | Screen                                                    | Docs path                           |
    | --------------------------------------------------------- | ----------------------------------- |
    | User menu → Help                                          | `ledger/`                           |
    | Onboarding                                                | `ledger/start/setting-up/`          |
    | Wording setting                                           | `ledger/start/wording/`             |
    | Import                                                    | `ledger/everyday/importing/`        |
    | Statement check                                           | `ledger/everyday/statement-checks/` |
    | Settings → Close the books                                | `ledger/reports/closing/`           |
    | Settings → Exports (backup and restore)                   | `ledger/admin/backups-and-exports/` |
    | Settings → Security                                       | `ledger/admin/security/`            |
    | Settings → Users & roles                                  | `ledger/admin/members-and-roles/`   |
    | Desktop "isn't available in the desktop app yet" messages | `ledger/start/desktop-app/`         |

16. **Docs PR:**
    - `ledger/admin/members-and-roles.md`: core roles plus Treasurer; invitations (14 days) and ownership in the hub when hosted.
    - `ledger/everyday/importing.md`, `ledger/help/troubleshooting.md`, `known-limits.md`, `faq.md`: **PDF statement import is off** until a provider is chosen.
    - `ledger/start/editions.md` and `ledger/index.md`: hosted status; Ledger Solo is the free desktop edition.
    - `ledger/admin/security.md`: account deletion in the hub when hosted.
    - `ledger/help/self-hosting.md`: new setup; remove `LOVABLE_API_KEY`.
    - Any screen renamed or moved by the restyle.

From then on, every step toward desktop parity updates `ledger/start/desktop-app.md` and `ledger/help/known-limits.md`.

### Rules for this repo

- Never write to `public`, `billing`, `hub`, `ops` or another app's schema.
- Financial calculations in SQL or integer arithmetic. Never sum floats.
- Posted entries stay immutable; corrections are voids and reversals.

### Done when

SHARED-SPEC §13 is satisfied; Ledger runs on the shared project; a hub sign-in carries over to `ledger.openapphub.org` in the same org; the desktop edition still passes its tests; and a self-hosted build runs on an empty database with only Ledger's migrations and `db/core`.

---

## Codebase rules (in force until `docs/MIGRATION-NOTES.md` §7.1 says a step replaces one)

- Double-entry: ≥2 entries, sum=0, both signs (deferred trigger; void exempt). amount_cents >0 debit, <0 credit.
- DB-enforced immutability: transactions only posted→void; entries only reconciliation_id; bank rows are evidence (FITID/hash+row_seq; link must match amount/account).
- Void: idempotent, blocked by completed reconciliation, unticks/unlinks in-progress evidence.
- Reconciliation finish needs difference=0 (DB trigger); completed ones lock entries.
- Audit rows: change + history in one DB transaction: post/void_transaction_atomic RPCs, else audited_write (src/lib/audited-write.ts). writeAudit() only for event-only history (e.g. backup export). Users can't INSERT audit_log.
- Org data: requireSupabaseAuth + assertCan + member RLS; settings/accounts admin-only.
- Terminology is presentation-only; reports/PDFs use org level only.
- Catalog archive: categories/tags/funds archive via is_active, projects via status='archived'; names stay unique across archived rows, so create returns {ok:false, archived} (UI offers restore) instead of a duplicate; restricted funds with money left can't be archived.
- Accounts: catalog-based; delete only if never used (domain/accounts.ts + DB trigger), otherwise archive. Names unique per org ignoring case/spaces (DB trigger backs it up).
- Dates YYYY-MM-DD in org.timezone; never toISOString.
- Reports: pure math; retained earnings derived; year-end close is virtual (no closing tx; legacy source='closing' excluded).
- Currency: two-decimal only, frozen once transactions exist.
- Idempotency keys: one per form submit; `bank:<id>`, `opening:<acct>:...`.
- AI PDF import is off (L-01, 2026-11-11): bank import takes CSV, OFX and QFX only. `ledger.ai_usage` and `org_settings.ai_pdf_enabled` stay for when a provider is chosen; old PDF rows keep `needs_review`.
- Legal acceptance append-only/versioned; U.S.-first; no GDPR claim. Demo login: manual dev seed only.
- CI, tests and migration-safety rules: see scripts/ci/AGENTS.md.
- Server functions: use createServerFn().validator(), never deprecated .inputValidator().
- Routing: public website owns `/`; the existing authenticated dashboard lives at `/ledger` so public visitors never need a session to read the website.
- Releases: two steps (docs/release-checklist.md); version/changelog date/architecture bump only after GitHub CI is confirmed green (release.test.ts). Desktop drafts build from main after all CI.
- MFA: org require_mfa enforced in DB via mfa_ok inside membership helpers; org row and own role stay visible to explain why.

- Domain rules: accounting invariants live in pure src/lib/domain/ (no storage imports) and run before every write; DB triggers are a backup, so a future SQLite edition gets the same guarantees.
- IDs: every new record gets an app-generated UUID (newId()), never a DB default, so identity survives future offline sync.
- Desktop/SQLite/backup: see src/lib/adapters, src/lib/domain AGENTS.md.
- Storage ports: data access goes through interfaces in src/lib/ports/ using models from src/lib/domain/models.ts (no DB types); adapters implement them so cloud and desktop share app code.
- Adapters/services: workflows live in src/lib/services/ (ports only); server functions do auth + assertCan, then call a service with createSupabaseRepositories(context.supabase). src/lib/adapters/memory is the reference adapter for tests and future SQLite parity.
- Funds: balances/restricted split derived from fund-tagged rows (domain/funds.ts); releases are balanced Net Assets to Net Assets (source 'release') so equity never changes.
- Members: organizations.created_by is the owner; invite links store only a SHA-256 hash of the token and are claimed atomically before the role is granted.
- Budgets/templates use ports; one budget row per account+period+scope, updated in place; recurring never auto-posts (key recurring:<tpl>:<date>). Exports/history cloud-only; exports escape formulas (src/lib/export.ts).
- Org delete needs deferrable "no action" FKs and a balance trigger skipping deleted transactions; keep new FKs deferrable.
- Package manager: npm only (package-lock.json, installed with npm ci); no bun.lock, so every install resolves the same tree.
- Permissions: CAPABILITIES in src/lib/permissions.ts is the only role table; permissions.test.ts pins every cell so changes are deliberate.
- Direct table writes: *.functions.ts never write tables directly (services or audited_write); only cloud-only non-book records may, each marked `// cloud-only-write: <reason>`. Enforced by direct-writes.test.ts as its own CI step.
- Inputs: amounts, dates and names go through src/lib/validation.ts on both form and server so every form shows the same message.
- Page states: lists use PageStates.tsx components; read errors with errorMessage() (src/lib/errors.ts), never `catch (e: any)`.
- Types: no-explicit-any is an error in app code (tests exempt); typed client is `Db`, table-walking backup code uses `UntypedDb` (src/lib/db.ts).
- Periods: month close/reopen only move books_locked_through (services/periods.ts); moving it back needs a saved reason so no lock change goes unexplained.
- Edition: isDesktop() is the only desktop check; server fns wrapped in desktopAware() (docs/desktop.md).
