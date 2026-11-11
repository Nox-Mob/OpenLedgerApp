# Account Archiving and U.S. Legal Release Plan

## Scope

This release completes account archiving and the first legal/privacy experience for a U.S.-first launch. GDPR-specific controls and claims are deferred. Legal copy will clearly distinguish the hosted service from self-hosted installations, use centralized placeholder operator/contact details, and be marked for attorney review before launch.

## 1. Archive accounts safely

- Replace account deletion with admin-only archive and reactivate actions.
- Keep required checking and equity/net-assets accounts active.
- Preserve every archived account, transaction line, report balance, bank link, and reconciliation reference.
- Hide archived accounts from new transaction, import, opening-balance, and reconciliation choices while keeping them visible in historical reports and transaction details.
- Show active and archived sections in Settings → Accounts, with usage explanations and a Reactivate action.
- Audit-log every archive and reactivation.
- Enforce the active-state change on the server and verify the account belongs to the selected organization.

## 2. Public legal pages

Create three public, readable pages with unique page titles and social descriptions:

- **Terms of Service** — separate sections for the hosted service and self-hosted software; open-source license remains separate from hosted-service terms.
- **Privacy Policy** — U.S.-first data practices for hosted users, plus a clear statement that self-hosters control their own deployment and data.
- **Not Financial, Tax, or Legal Advice** — explains that Open Ledger is recordkeeping software, automated outputs can be wrong, and users remain responsible for professional review and filings.

All operator name, jurisdiction, effective date, and contact details will come from one placeholder legal configuration so counsel-approved details can replace them consistently later. The pages will not claim GDPR compliance.

## 3. Versioned acceptance and startup reminder

- Add a protected legal-acceptance record for each user and notice version, with explicit database permissions and row-level access.
- Require email signups to check agreement to the Terms and Privacy Policy before account creation.
- After any sign-in method, route users to a legal acceptance screen when the current Terms or Privacy version has not been accepted. This also covers Google sign-in and future policy updates.
- Present the non-advice reminder on that screen and require acknowledgement once per notice version.
- Keep links to all three legal pages on sign-in, signup, the acceptance screen, and the signed-in navigation.
- Never block public access to the legal pages. Existing signed-in users see the gate once after this release.

## 4. Verification

- Add tests for acceptance-version logic and account archive rules.
- Verify email signup cannot continue without agreement, Google/email users reach the same post-sign-in gate, and acknowledgement removes the gate until a version changes.
- Verify archived accounts disappear from every new-entry selector but historical transactions and reports remain unchanged.
- Verify an admin can reactivate an account and non-admins cannot archive or reactivate one.
- Check the public legal pages and acceptance flow on desktop and mobile, then confirm the app builds without errors.

## Deferred

- GDPR-specific rights workflows, EU/UK transfer language, and cookie-consent tooling.
- Final legal entity, address, jurisdiction, contact details, and attorney-approved wording.
- Remaining Phase D work: broader auth hygiene and books-locked-through/year-end close.
