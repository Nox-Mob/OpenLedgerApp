-- Integration views (S-03, spec §3.6): read-only, the caller's own row security, and the
-- right numbers (revenue positive, voided and closing entries left out).
begin;
do $$
declare
  owner uuid := tests.create_user('owner@views.l.org');
  stranger uuid := tests.create_user('stranger@views.l.org');
  org uuid; cash uuid; sales uuid; rent uuid; tx uuid; voided uuid;
begin
  perform tests.as_super();
  perform tests.ok(
    (select bool_and(c.reloptions @> array['security_invoker=true']) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ledger' and c.relname in ('api_budgets', 'api_period_summaries')),
    'both views run with the caller''s rights (security_invoker)');

  perform tests.as_user(owner);
  org := public.create_organization('Views Ledger');
  perform tests.as_super();
  insert into ledger.org_settings (org_id, currency) values (org, 'CAD');
  insert into ledger.accounts (org_id, name, type) values (org, 'Cash', 'asset') returning id into cash;
  insert into ledger.accounts (org_id, name, type) values (org, 'Sales', 'revenue') returning id into sales;
  insert into ledger.accounts (org_id, name, type) values (org, 'Rent', 'expense') returning id into rent;
  -- November: $100 in, $40 out; a voided $999 sale that must not count.
  tx := gen_random_uuid();
  insert into ledger.transactions (id, org_id, transaction_date, description) values (tx, org, '2026-11-03', 'sale');
  insert into ledger.entries (transaction_id, account_id, amount_cents) values (tx, cash, 10000), (tx, sales, -10000);
  tx := gen_random_uuid();
  insert into ledger.transactions (id, org_id, transaction_date, description) values (tx, org, '2026-11-05', 'rent');
  insert into ledger.entries (transaction_id, account_id, amount_cents) values (tx, rent, 4000), (tx, cash, -4000);
  voided := gen_random_uuid();
  insert into ledger.transactions (id, org_id, transaction_date, description) values (voided, org, '2026-11-06', 'oops');
  insert into ledger.entries (transaction_id, account_id, amount_cents) values (voided, cash, 99900), (voided, sales, -99900);
  set constraints all immediate; set constraints all deferred;
  update ledger.transactions set status = 'void' where id = voided;
  insert into ledger.budgets (id, org_id, account_id, period_type, period_start, amount_cents)
    values (gen_random_uuid(), org, rent, 'year', '2026-01-01', 50000);

  perform tests.as_user(owner);
  perform tests.ok((select revenue_cents || '/' || expense_cents || '/' || net_cents || '/' || transaction_count || '/' || currency
    from ledger.api_period_summaries where org_id = org and month = '2026-11-01') = '10000/4000/6000/2/CAD',
    'November: revenue, expenses, net and count, voided left out, in the org''s currency');
  perform tests.ok((select account_name || ' ' || period_end from ledger.api_budgets where org_id = org) = 'Rent 2026-12-31',
    'a yearly budget ends on Dec 31');
  perform tests.throws(format('update ledger.api_budgets set amount_cents = 1 where org_id = %L', org), 'the views are read-only');

  perform tests.as_user(stranger);
  perform tests.ok(tests.count(format('select * from ledger.api_period_summaries where org_id = %L', org)) = 0, 'another organization sees no summaries');
  perform tests.ok(tests.count(format('select * from ledger.api_budgets where org_id = %L', org)) = 0, 'another organization sees no budgets');
  perform tests.as_anon();
  perform tests.throws('select * from ledger.api_budgets', 'signed-out visitors can''t read the views');
end
$$;
rollback;
