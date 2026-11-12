-- S-28 (0009, core 0012): OpenLedgerApp's month totals for the workflow designer.
begin;
do $$
declare
  owner uuid := tests.create_user('owner@dzl.org');
  org uuid; cash uuid; sales uuid; rent uuid; tx uuid; v jsonb;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Designer Books');
  perform tests.as_super();
  insert into ledger.org_settings (org_id, currency) values (org, 'USD');
  insert into ledger.accounts (org_id, name, type) values (org, 'Cash', 'asset') returning id into cash;
  insert into ledger.accounts (org_id, name, type) values (org, 'Sales', 'revenue') returning id into sales;
  insert into ledger.accounts (org_id, name, type) values (org, 'Rent', 'expense') returning id into rent;
  tx := gen_random_uuid();
  insert into ledger.transactions (id, org_id, transaction_date, description) values (tx, org, '2026-10-03', 'sale');
  insert into ledger.entries (transaction_id, account_id, amount_cents) values (tx, cash, 12550), (tx, sales, -12550);
  tx := gen_random_uuid();
  insert into ledger.transactions (id, org_id, transaction_date, description) values (tx, org, '2026-10-05', 'rent');
  insert into ledger.entries (transaction_id, account_id, amount_cents) values (tx, rent, 4000), (tx, cash, -4000);
  -- October is closed (after its entries were recorded).
  update ledger.org_settings set books_locked_through = '2026-10-31' where org_id = org;

  perform tests.ok((select kind from public.automation_action_types where type = 'ledger.month_totals') = 'query', 'month totals is a lookup');
  v := ledger.wf_month_totals(org, '{"month": "last_closed_month"}');
  perform tests.ok(v->>'month' = '2026-10-01' and (v->>'closed')::boolean, 'the last closed month');
  perform tests.ok((v->>'income')::numeric = 125.50 and (v->>'spending')::numeric = 40 and (v->>'net')::numeric = 85.50, 'in currency units');
  v := ledger.wf_month_totals(org, '{"month": "date", "date": "2026-09-14"}');
  perform tests.ok((v->>'income')::numeric = 0 and (v->>'transactions')::int = 0, 'an empty month is zero');
  perform tests.ok((ledger.wf_month_totals(gen_random_uuid(), '{"month": "date", "date": "2026-10-01"}')->>'income')::numeric = 0,
    'nothing from another organization');

  -- A designer workflow: last month's totals, used in an email only when there was a loss.
  perform tests.as_user(owner);
  v := public.test_workflow(org, '{"version": 2, "trigger": {"type": "core.schedule", "params": {"frequency": "monthly", "day": 1, "hour": 7}},
    "steps": [
      {"id": "totals", "type": "ledger.month_totals", "params": {"month": "last_closed_month"}},
      {"id": "loss", "type": "condition", "params": {"conditions": [{"left": "{{steps.totals.net}}", "op": "lt", "right": 0}]},
       "then": [{"id": "warn", "type": "email", "params": {"to": {"type": "role", "roles": ["owner"]}, "subject": "Loss in {{steps.totals.month_name}}", "message": "m"}}],
       "else": [{"id": "fine", "type": "compose", "params": {"value": "{{steps.totals.month_name}}: net {{steps.totals.net}}"}}]}]}');
  perform tests.ok(v->>'status' = 'succeeded', 'the test run succeeded');
  perform tests.ok(exists (select 1 from jsonb_array_elements(v->'trace') t where t->>'id' = 'fine' and t #>> '{output,value}' = 'October 2026: net 85.50'),
    'a later step used the totals, and the condition took the right branch');
end $$;
rollback;
\echo ok
