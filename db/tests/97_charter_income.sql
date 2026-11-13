-- S-18 (0011): OpenCharterApp payments offered for the books as drafts, posted or skipped once.
-- Without OpenCharterApp installed, a stand-in charter.api_payments (rolled back with the test).
begin;
do $$
begin
  if to_regclass('charter.api_payments') is null then
    create schema if not exists charter;
    create table charter.api_payments (id uuid primary key, org_id uuid, unit_id uuid, is_national boolean,
      unit_name text, purpose text, amount_minor integer, refunded_amount_minor integer, currency text,
      status text, gateway text, method text, channel text, received_on date, created_at timestamptz default now());
    create temporary table _stand_in (x int);
  end if;
end $$;
do $$
declare
  owner uuid := tests.create_user('owner@dues.org');
  bob uuid := tests.create_user('bob@dues.org');
  viv uuid := tests.create_user('viv@dues.org');
  org uuid;
  a_stripe uuid; a_undep uuid; a_fee uuid; a_join uuid; a_renew uuid; a_cash uuid;
  chap uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid();
  d record;
  v_tx uuid;
  v_imp uuid;
  n int;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Dues Books');
  perform tests.add_hub_member(org, bob, 'member');
  perform public.set_app_role(org, bob, 'ledger', 'member');
  perform tests.add_hub_member(org, viv, 'member');
  perform tests.as_super();
  insert into ledger.accounts (org_id, name, type) values (org, 'Stripe balance', 'asset') returning id into a_stripe;
  insert into ledger.accounts (org_id, name, type) values (org, 'Undeposited funds', 'asset') returning id into a_undep;
  insert into ledger.accounts (org_id, name, type) values (org, 'Card fees', 'expense') returning id into a_fee;
  insert into ledger.accounts (org_id, name, type) values (org, 'New member dues', 'revenue') returning id into a_join;
  insert into ledger.accounts (org_id, name, type) values (org, 'Renewal dues', 'revenue') returning id into a_renew;
  insert into ledger.accounts (org_id, name, type) values (org, 'Cash', 'asset') returning id into a_cash;
  -- Two card payments and a check on one day for the national organization, one in a chapter,
  -- and one from before the import starts.
  if to_regclass('pg_temp._stand_in') is not null then
    insert into charter.api_payments (id, org_id, unit_id, is_national, unit_name, purpose, amount_minor,
      refunded_amount_minor, currency, status, gateway, method, channel, received_on) values
      (p1, org, org, true, 'Dues Books', 'join', 5000, 0, 'USD', 'paid', 'stripe', 'card', 'card', current_date - 1),
      (p2, org, org, true, 'Dues Books', 'renew', 3000, 0, 'USD', 'paid', 'stripe', 'card', 'card', current_date - 1),
      (p3, org, org, true, 'Dues Books', 'renew', 4000, 0, 'USD', 'paid', 'manual', 'check', 'other', current_date - 1),
      (p4, org, chap, false, 'North Chapter', 'renew', 2500, 0, 'USD', 'paid', 'manual', 'cash', 'other', current_date - 1),
      (p5, org, org, true, 'Dues Books', 'renew', 9900, 0, 'USD', 'paid', 'manual', 'check', 'other', current_date - 40);
  else
    -- With OpenCharterApp here, the same through its own tables isn't worth the setup: skip.
    return;
  end if;

  -- Off until switched on; only Ledger admins switch it.
  perform tests.as_user(owner);
  perform tests.ok(not (ledger.charter_import_config(org) ->> 'enabled')::boolean, 'off by default');
  perform tests.ok(tests.count(format('select 1 from ledger.charter_drafts(%L)', org)) = 0, 'nothing offered while off');
  perform tests.as_user(bob);
  perform tests.throws(format($q$select ledger.save_charter_import_config(%L, '{"enabled": false}')$q$, org),
    'only admins change it', 'Only the owner');
  perform tests.as_user(owner);
  perform tests.throws(format($q$select ledger.save_charter_import_config(%L, '{"enabled": true}')$q$, org),
    'every account first', 'Choose every account');
  perform tests.throws(format($q$select ledger.save_charter_import_config(%L, %L)$q$, org,
    jsonb_build_object('card_account_id', a_fee)), 'the right kind of account', 'asset');
  perform ledger.save_charter_import_config(org, jsonb_build_object('enabled', true,
    'starts_on', current_date - 7, 'card_account_id', a_stripe, 'other_account_id', a_undep,
    'fee_account_id', a_fee, 'join_account_id', a_join, 'renew_account_id', a_renew));

  -- National only (the default): a card draft and a check draft for yesterday; nothing older.
  perform tests.as_user(bob);
  select count(*) into n from ledger.charter_drafts(org);
  perform tests.ok(n = 2, 'one draft per day and channel');
  select * into d from ledger.charter_drafts(org) x where x.channel = 'card';
  perform tests.ok(d.gross_cents = 8000 and d.payment_count = 2, 'the card draft adds up');
  perform tests.ok(d.fee_cents = (145 + 30) + (87 + 30), 'estimated fee: 2.9% + 30¢ per card payment');
  perform tests.ok(jsonb_array_length(d.lines) = 2, 'by purpose: new members and renewals');
  perform tests.as_user(viv);
  perform tests.ok(tests.count(format('select 1 from ledger.charter_drafts(%L)', org)) = 2, 'a viewer sees them');
  perform tests.throws(format('select ledger.record_charter_import(%L, current_date, %L, %L, %L, %L::uuid[], null, 0)',
    org, 'other', 'payments', 'skipped', array[p3]), 'a viewer can''t decide', 'can''t change');

  -- Post the card draft (the app posts the transaction, then records it), skip the check one.
  perform tests.as_user(bob);
  perform tests.as_super();
  insert into ledger.transactions (org_id, transaction_date, description, source, created_by)
  values (org, d.day, 'Membership dues: card', 'import', bob) returning id into v_tx;
  perform tests.as_user(bob);
  v_imp := ledger.record_charter_import(org, d.day, 'card', 'payments', 'posted', d.payment_ids, v_tx, d.fee_cents);
  perform tests.ok((select gross_cents from ledger.charter_imports where id = v_imp) = 8000, 'recorded with its amount');
  perform tests.throws(format('select ledger.record_charter_import(%L, current_date, %L, %L, %L, %L::uuid[], %L, 0)',
    org, 'card', 'payments', 'posted', d.payment_ids, v_tx), 'never twice', 'already in the books');
  perform ledger.record_charter_import(org, current_date - 1, 'other', 'payments', 'skipped', array[p3], null, 0);
  perform tests.ok(tests.count(format('select 1 from ledger.charter_drafts(%L)', org)) = 0, 'nothing left');

  -- Every chapter: the chapter's payment comes in, on its own line.
  perform tests.as_user(owner);
  perform ledger.save_charter_import_config(org, (ledger.charter_import_config(org) - 'available' - 'can_change') || '{"scope": "all"}');
  select * into d from ledger.charter_drafts(org);
  perform tests.ok(d.gross_cents = 2500 and d.lines -> 0 ->> 'unit_name' = 'North Chapter', 'chapters, tagged by chapter');

  -- A refund, once the payment is in the books; partial refunds only what's new.
  perform tests.as_super();
  update charter.api_payments set refunded_amount_minor = 1000, status = 'refunded' where id = p1;
  perform tests.as_user(bob);
  select * into d from ledger.charter_drafts(org) x where x.kind = 'refunds';
  perform tests.ok(d.gross_cents = 1000 and d.channel = 'card', 'the refund is offered');
  perform ledger.record_charter_import(org, d.day, 'card', 'refunds', 'skipped', d.payment_ids, null, 0);
  perform tests.as_super();
  update charter.api_payments set refunded_amount_minor = 5000 where id = p1;
  perform tests.as_user(bob);
  select * into d from ledger.charter_drafts(org) x where x.kind = 'refunds';
  perform tests.ok(d.gross_cents = 4000, 'then only the rest of it');

  -- Bring a skipped draft back.
  perform ledger.reopen_charter_import(org, (select id from ledger.charter_imports where org_id = org and channel = 'other' and kind = 'payments'));
  perform tests.ok(exists (select 1 from ledger.charter_drafts(org) x where x.channel = 'other' and x.payment_count = 2 and x.day = current_date - 1),
    'the skipped check is offered again');
  perform tests.throws(format('select ledger.reopen_charter_import(%L, %L)', org, v_imp), 'not a posted one', 'Only a skipped draft');

  -- No access: nothing.
  perform tests.as_user(owner);
  perform public.set_app_access(org, viv, 'ledger', true);
  perform tests.as_user(viv);
  perform tests.throws(format('select ledger.charter_drafts(%L)', org), 'no access, no drafts', 'don''t have access');
end $$;
rollback;
