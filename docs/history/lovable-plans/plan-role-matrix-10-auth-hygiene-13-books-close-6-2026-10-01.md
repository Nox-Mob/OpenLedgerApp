# Plan: Role matrix (10), Auth hygiene (13), Books close (6)

## 10. Role authorization matrix
One written rulebook of who can do what, enforced on the server and in the database, and used to hide buttons people can't use.

| Action | Admin | Member | Viewer |
|---|---|---|---|
| View books, reports, exports | yes | yes | yes |
| Post / void transactions, import, reconcile | yes | yes | no |
| Reopen completed reconciliation | yes | no | no |
| Org settings, accounts setup, archive accounts | yes | no | no |
| Change member roles | yes | no | no |
| Lock books / year-end close / unlock | yes | no | no |

- Last-admin protection already exists in the database; surface a clear message in the UI when it blocks a change.
- Viewers see read-only screens (no "New transaction", "Import", "Void" buttons).

## 13. Auth hygiene
- Email verification required before first sign-in (no auto-confirm); "resend verification email" on the sign-in page.
- Password reset already exists; add password strength rules: minimum 8 characters requiring an uppercase letter, lowercase letter, number, and symbol — checked in the form before submit and enforced server-side via Supabase's password policy.
- Leaked-password check (HIBP) enabled, so passwords found in known data breaches are rejected.
- Sign-in / reset rate limiting: friendly "too many attempts, wait a minute" message.
- Google and email for the same address: link to one account, with an explanation if someone tries the other method.
- Sign out clears cached data and can't be undone with the Back button.

## 6. Lock books + year-end close
- **Lock-through date** (admin): no transaction can be posted, voided, or dated on/before it. Enforced in the database, so nothing slips around it. Unlocking is admin-only and audit-logged.
- **Year-end close** (admin): pick a fiscal year, see a preview of net income moving into Retained Earnings / Net Assets, confirm. This records one closing transaction and locks the books through year-end. Reports stay correct before and after.
- New "Close the books" page under Organization settings, with history of closes and locks.

## Order
1. Role matrix (other two depend on it for admin checks).
2. Books lock + year-end close.
3. Auth hygiene.

## Verification
- Tests for the role matrix, lock-date rules (post/void/back-date blocked), and closing-entry math.
- Tenant isolation SQL test extended for the lock.
- Browser check: viewer sees read-only UI; locked period rejects a back-dated entry; year-end close preview matches the balance sheet.

## Technical details
- `src/lib/permissions.ts`: `can(role, action)` matrix + unit tests; server fns call `assertCan` after `requireSupabaseAuth`; RLS writes switch to `can_write_org`/`has_org_role` per matrix.
- Migration: `organizations.books_locked_through date`, `period_closes` table (org_id, fiscal_year_end, transaction_id, closed_by) with GRANTs/RLS; trigger on transactions/entries rejecting changes dated on/before lock; new `transaction_source` value `closing`.
- Auth: `supabase--configure_auth` for confirmation, password HIBP; client-side attempt throttling plus server message mapping.
- Sample demo data untouched.
