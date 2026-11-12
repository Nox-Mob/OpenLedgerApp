-- Performance check setup: one measured organization (person 1 owns it, 2–10 are
-- members, 3 is treasurer) with a chart of 60 accounts, plus 30 other organizations
-- whose books every query must skip. grow.sql then grows the books step by step.
\set ON_ERROR_STOP on
insert into auth.users (id, email, email_confirmed_at)
select ('11111111-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'person' || i || '@perf.test', now()
from generate_series(1, 40) i;
insert into public.organizations (id, name, created_by)
select ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid, 'Perf books ' || o,
  ('11111111-0000-4000-8000-' || lpad(case when o = 1 then 1 else 9 + o end::text, 12, '0'))::uuid
from generate_series(1, 31) o;
insert into public.memberships (org_id, user_id, role)
select '22222222-0000-4000-8000-000000000001', ('11111111-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  (case when i = 1 then 'owner' else 'member' end)::public.org_role
from generate_series(1, 10) i;
insert into public.memberships (org_id, user_id, role)
select ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid, ('11111111-0000-4000-8000-' || lpad((9 + o)::text, 12, '0'))::uuid, 'owner'
from generate_series(2, 31) o;
-- Their roles in this app too (H-09: separate from the OpenAppHub role).
insert into public.app_role_overrides (org_id, user_id, app, role)
select m.org_id, m.user_id, 'ledger', m.role from public.memberships m
where m.role in ('admin', 'member') and m.org_id::text like '22222222-0000-4000-8000-%'
on conflict do nothing;
insert into ledger.member_roles (org_id, user_id, role)
values ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000003', 'treasurer');
insert into ledger.org_settings (org_id, currency)
select ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid, 'USD' from generate_series(1, 31) o;

-- 60 accounts per org: 10 assets, 5 liabilities, 3 equity, 12 revenue, 30 expense.
insert into ledger.accounts (id, org_id, name, type)
select ('44444444-' || lpad(o::text, 4, '0') || '-4000-8000-' || lpad(a::text, 12, '0'))::uuid,
  ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid, 'Account ' || a,
  (case when a <= 10 then 'asset' when a <= 15 then 'liability' when a <= 18 then 'equity'
        when a <= 30 then 'revenue' else 'expense' end)::ledger.account_type
from generate_series(1, 31) o cross join generate_series(1, 60) a;
insert into ledger.funds (org_id, name)
select ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid, 'Fund ' || f
from generate_series(1, 31) o cross join generate_series(1, 5) f;
