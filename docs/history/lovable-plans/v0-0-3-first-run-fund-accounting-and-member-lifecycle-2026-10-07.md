# v0.0.3 first run: Fund accounting and member lifecycle

## 1. Fund accounting (nonprofits)

**Restricted vs unrestricted**
- Every fund is already marked restricted or not. Money In to a restricted fund now requires choosing that fund; unrestricted gifts need no fund.
- Reports gain a "Net assets by restriction" section: without donor restrictions vs with donor restrictions, plus a per-fund balance table (received, spent, released, remaining).
- Fund balances are derived from entries (pure math in the reports service), so desktop and cloud match.

**Releases from restriction**
- New "Release funds" action on the Funds page: pick a restricted fund, amount, date, and note.
- Posts a balanced transaction moving the amount from "Net assets with donor restrictions" to "Net assets without donor restrictions", tagged to the fund. New transaction source `release`.
- Domain rule: a release cannot exceed the fund's remaining restricted balance, and respects the books lock.

**Pledges**
- New "Pledges" list: donor name, fund (optional), amount, date promised, expected date.
- Recording a pledge posts Pledges Receivable (asset) against Contribution revenue. Receiving a payment posts cash against Pledges Receivable and shows the pledge as partly or fully paid.
- Pledges can be written off (voided remainder), never deleted. Adds "Pledges Receivable" to the nonprofit account catalog.

## 2. Member lifecycle

- **Invite links**: admins create a link with a role and expiry (7 days default). Anyone signed in who opens it joins with that role. Links can be revoked and are single use. Shown on Settings > Members with copy button.
- **Change roles**: already exists; keep, and keep the "last admin" guard.
- **Remove member**: admins remove others; anyone can leave. Last admin cannot leave. History stays intact.
- **Transfer ownership**: the current owner hands the organization to another admin, and stays an admin.
- **Delete organization**: owner only, type the organization name to confirm. Erases the organization and all its books. Audit entry kept outside the org scope.

## 3. Wrap-up
- Tests for every new domain rule (release limits, pledge payments, invite expiry/reuse, last admin, owner-only delete) through the memory and SQLite contract tests.
- Update roadmap (14 and 16 checked), CHANGELOG Unreleased section, typecheck, lint, format, build.

## Technical details
- Migration: `pledges` table, `org_invites` table (token hash stored, never the raw token), `transaction_source` enum add `release`, `pledge`; `organizations.created_by` used as owner; RLS: members read, admins write; invite acceptance via a server function that verifies the token server-side and inserts the role with the service role client.
- Org delete: server function checks owner, then service-role cascading delete inside one SQL function (bypasses immutability triggers only for this path).
- New ports: `PledgeRepository`, `InviteRepository`, `MemberRepository`; implemented in supabase, memory, and sqlite adapters (invites/members are cloud-only on desktop and stubbed there).
- Services: `src/lib/services/funds.ts`, `src/lib/services/members.ts`; server functions use `.validator()`.
