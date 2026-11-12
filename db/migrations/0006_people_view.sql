-- H-04: people across the apps. OpenLedgerApp's role is the core role plus Ledger's own
-- (treasurer). Read-only, with the caller's own row security. Add columns at the end.
create or replace view ledger.api_people with (security_invoker = true) as
select r.org_id, r.user_id, r.role::text as role
from ledger.member_roles r;
comment on view ledger.api_people is 'Ledger roles per person (H-04). docs/INTEGRATION.md';
grant select on ledger.api_people to authenticated;
