-- OpenLedgerApp's part of the suite demo, second version. STAGING (and local development) only,
-- recorded under "openledgerapp:seed" like 0001 (which stays as it was applied).
--
-- What changed from 0001:
--   * Dues come from OpenCharterApp. Every dues payment Charter recorded for the organization is
--     booked the way a treasurer would: card payments into a "Stripe balance" account (net of the
--     2.9% + 30¢ card fee, which is an expense) and paid out to Checking every Friday; checks,
--     cash and transfers into "Undeposited funds" and deposited every Monday. So dues income in
--     Ledger equals Charter's receipts for any period (dashboards and reports agree).
--   * The books start on January 1 (or 92 days back in early January), so "this year" matches.
--   * Recurring transactions (templates) are due in the next few days, so the hub's dashboard
--     shows Ledger tasks.
--   * ledger.demo_fill_national: the books of the veterans national (the second demo).
-- Without OpenCharterApp on the database (Ledger on its own), dues are made up as before.
-- Dates are relative to the day it runs: the hub's demo reset (every 12 hours) keeps them rolling.

do $guard$
begin
  if to_regclass('hub.instance') is not null then
    if coalesce((select environment from hub.instance where id), '') <> 'staging' then
      raise exception 'Refusing to seed: this database is not marked staging.';
    end if;
  elsif exists (select 1 from public.organizations where id <> 'de000000-0000-4000-8000-0000000000a1') then
    raise exception 'Refusing to seed: this database has real organizations.';
  end if;
end
$guard$;

-- The chart of accounts and categories every demo uses. Returns their ids by name.
create or replace function ledger._demo_chart(p_org uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := '{}';
  r record;
begin
  insert into ledger.org_settings (org_id, org_type, currency, fiscal_year_start_month, terminology, timezone)
  select p_org, 'nonprofit', o.currency, 1, 'simple', o.time_zone from public.organizations o where o.id = p_org
  on conflict (org_id) do nothing;
  for r in select * from (values
      ('check', 'Checking', 'asset', 'bank'), ('save', 'Savings', 'asset', 'bank'),
      ('stripe', 'Stripe balance', 'asset', null), ('undep', 'Undeposited funds', 'asset', null),
      ('net', 'Net Assets', 'equity', null),
      ('dues', 'Membership Dues', 'revenue', null), ('don', 'Donations', 'revenue', null),
      ('fund', 'Fundraising Sales', 'revenue', null), ('grant', 'Grants', 'revenue', null),
      ('prog', 'Program Expenses', 'expense', null), ('fexp', 'Fundraising Expenses', 'expense', null),
      ('ops', 'Operating Expenses', 'expense', null)) a(k, name, type, subtype) loop
    insert into ledger.accounts (org_id, name, type, subtype) values (p_org, r.name, r.type::ledger.account_type, r.subtype)
    returning jsonb_build_object(r.k, id) || v into v;
  end loop;
  for r in select * from (values
      ('c_ins', 'Insurance'), ('c_web', 'Website & software'), ('c_print', 'Printing & newsletter'),
      ('c_bank', 'Bank fees'), ('c_card', 'Card processing fees'), ('c_event', 'Event supplies'),
      ('c_park', 'Parks & grounds'), ('c_food', 'Food drive'), ('c_post', 'Postage & P.O. box'),
      ('c_travel', 'Travel'), ('c_grants', 'Grants to posts'), ('c_mag', 'Magazine'),
      ('c_conf', 'Convention')) c(k, name) loop
    insert into ledger.categories (org_id, name, type) values (p_org, r.name, 'expense')
    returning jsonb_build_object(r.k, id) || v into v;
  end loop;
  return v;
end;
$$;

-- Charter's dues payments for the organization's own unit, booked as above from p_start.
-- Returns the gross dues booked. Payments before p_start are part of the opening balance.
create or replace function ledger._demo_charter_dues(p_org uuid, p_owner uuid, p_start date, a jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_total bigint := 0;
  v_d date;
  v_bal bigint;
begin
  if to_regclass('charter.payments') is null then
    return 0;
  end if;
  -- One entry per day and channel: cards (net of fees) and everything else.
  for r in execute $q$
    select p.received_on as d,
           (p.method = 'card') as card,
           count(*) as n,
           sum(p.amount_minor - p.refunded_amount_minor)::bigint as gross,
           sum(case when p.method = 'card' then round(p.amount_minor * 0.029) + 30 else 0 end)::bigint as fee
    from charter.payments p
    where p.unit_id = $1 and p.status in ('paid', 'refunded')
      and p.received_on between $2 and current_date
    group by 1, 2 order by 1, 2 $q$ using p_org, p_start loop
    if r.gross <= 0 then continue; end if;
    v_total := v_total + r.gross;
    if r.card then
      perform ledger.demo_post(p_org, p_owner, r.d,
        format('Membership dues — card (%s %s)', r.n, case when r.n = 1 then 'payment' else 'payments' end),
        jsonb_build_array(
          jsonb_build_object('a', a->>'stripe', 'c', r.gross - r.fee),
          jsonb_build_object('a', a->>'ops', 'c', r.fee, 'cat', a->>'c_card', 'm', 'Card processing fees'),
          jsonb_build_object('a', a->>'dues', 'c', -r.gross, 'm', 'From OpenCharterApp')));
    else
      perform ledger.demo_post(p_org, p_owner, r.d,
        format('Membership dues — checks and cash (%s)', r.n),
        jsonb_build_array(
          jsonb_build_object('a', a->>'undep', 'c', r.gross),
          jsonb_build_object('a', a->>'dues', 'c', -r.gross, 'm', 'From OpenCharterApp')));
    end if;
  end loop;
  -- Payouts every Friday and bank deposits every Monday: whatever has collected by then.
  v_d := p_start;
  while v_d <= current_date loop
    if extract(dow from v_d) in (1, 5) then
      select coalesce(sum(e.amount_cents), 0) into v_bal
      from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
      where e.account_id = (a->>case when extract(dow from v_d) = 5 then 'stripe' else 'undep' end)::uuid
        and t.transaction_date < v_d;
      if v_bal > 0 then
        perform ledger.demo_post(p_org, p_owner, v_d,
          case when extract(dow from v_d) = 5 then 'Stripe payout' else 'Bank deposit — checks and cash' end,
          jsonb_build_array(
            jsonb_build_object('a', a->>'check', 'c', v_bal),
            jsonb_build_object('a', a->>case when extract(dow from v_d) = 5 then 'stripe' else 'undep' end, 'c', -v_bal)),
          'transfer');
      end if;
    end if;
    v_d := v_d + 1;
  end loop;
  return v_total;
end;
$$;

-- A recurring transaction that the hub shows as a task when it's due within a week.
create or replace function ledger._demo_template(p_org uuid, p_name text, p_description text,
  p_frequency text, p_next date, p_lines jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into ledger.transaction_templates (id, org_id, name, description, lines, frequency, next_due, active)
  values (gen_random_uuid(), p_org, p_name, p_description, p_lines, p_frequency, p_next, true);
$$;

-- Riverside Community Association (the first demo).
create or replace function ledger.demo_fill(p_org uuid, p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  a jsonb;
  f_park uuid; p_fest uuid; p_food uuid;
  v_start date := least(date_trunc('year', current_date)::date, current_date - 92);
  v_recent date := current_date - 92;  -- the season's events are in the last three months
  v_month date; v_d date; v_w int; v_amt int; v_dues bigint;
  v_rec uuid; v_begin bigint; v_end bigint; v_m int;
  v_donors text[] := array['M. Alvarez', 'The Kim family', 'R. Thompson', 'Riverside Hardware', 'J. Patel', 'A. Okafor', 'L. Nguyen', 'Corner Coffee Co.'];
begin
  perform setseed(0.31415);
  a := ledger._demo_chart(p_org);
  insert into ledger.funds (org_id, name, is_restricted) values (p_org, 'Park Improvement Fund', true) returning id into f_park;
  insert into ledger.projects (org_id, name, budget_cents, status) values (p_org, 'Fall Festival', 250000, 'completed') returning id into p_fest;
  insert into ledger.projects (org_id, name, budget_cents, status) values (p_org, 'Holiday Food Drive', 40000, 'active') returning id into p_food;

  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', 1520000), jsonb_build_object('a', a->>'net', 'c', -1520000)), 'opening_balance');
  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a->>'save', 'c', 800000), jsonb_build_object('a', a->>'net', 'c', -800000)), 'opening_balance');

  -- Dues: exactly what OpenCharterApp received (or made up when Ledger runs alone).
  v_dues := ledger._demo_charter_dues(p_org, p_owner, v_start, a);
  if v_dues = 0 and to_regclass('charter.payments') is null then
    for v_w in 0..((current_date - v_start) / 7) loop
      v_d := v_start + 3 + v_w * 7;
      exit when v_d > current_date;
      v_amt := (180 + floor(random() * 540))::int * 100;
      perform ledger.demo_post(p_org, p_owner, v_d, 'Membership dues deposit',
        jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', v_amt), jsonb_build_object('a', a->>'dues', 'c', -v_amt)));
      v_dues := v_dues + v_amt;
    end loop;
  end if;

  -- Every month since the books started: hosting, newsletter, savings, bank fee, a few donations.
  v_month := date_trunc('month', v_start)::date;
  while v_month <= current_date loop
    if v_month + 3 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 3, 'Website hosting and email',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 2900, 'cat', a->>'c_web'), jsonb_build_object('a', a->>'check', 'c', -2900)));
    end if;
    if v_month + 8 between v_start and current_date then
      v_amt := 17500 + floor(random() * 2500)::int;
      perform ledger.demo_post(p_org, p_owner, v_month + 8, 'Newsletter printing — Riverside Print Shop',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', v_amt, 'cat', a->>'c_print'), jsonb_build_object('a', a->>'check', 'c', -v_amt)));
    end if;
    if v_month + 15 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 15, 'Transfer to savings',
        jsonb_build_array(jsonb_build_object('a', a->>'save', 'c', 50000), jsonb_build_object('a', a->>'check', 'c', -50000)), 'transfer');
    end if;
    if v_month + 27 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 27, 'Monthly service fee',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 1200, 'cat', a->>'c_bank'), jsonb_build_object('a', a->>'check', 'c', -1200)));
    end if;
    if extract(month from v_month) in (1, 4, 7, 10) and v_month + 6 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 6, 'General liability insurance (quarterly)',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 61200, 'cat', a->>'c_ins'), jsonb_build_object('a', a->>'check', 'c', -61200)));
    end if;
    for v_w in 1..2 loop
      v_d := v_month + 2 + v_w * 9;
      if v_d between v_start and current_date then
        v_amt := (array[5000, 10000, 2500, 25000, 7500, 15000])[1 + floor(random() * 6)::int];
        perform ledger.demo_post(p_org, p_owner, v_d, 'Donation — ' || v_donors[1 + floor(random() * 8)::int],
          jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', v_amt), jsonb_build_object('a', a->>'don', 'c', -v_amt)));
      end if;
    end loop;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  -- This season's events (the same ones the board discussed in OpenBoardApp).
  perform ledger.demo_post(p_org, p_owner, v_recent + 10, 'P.O. box renewal',
    jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 9400, 'cat', a->>'c_post'), jsonb_build_object('a', a->>'check', 'c', -9400)));
  perform ledger.demo_post(p_org, p_owner, v_recent + 31, 'Riverside Community Foundation — park grant',
    jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', 200000), jsonb_build_object('a', a->>'grant', 'c', -200000, 'f', f_park, 'm', 'Restricted to park improvements')));
  perform ledger.demo_post(p_org, p_owner, v_recent + 18, 'Fall Festival — vendor deposits and bounce house',
    jsonb_build_array(jsonb_build_object('a', a->>'fexp', 'c', 118500, 'cat', a->>'c_event', 'p', p_fest), jsonb_build_object('a', a->>'check', 'c', -118500)));
  perform ledger.demo_post(p_org, p_owner, v_recent + 24, 'Fall Festival — supplies, permits and signage',
    jsonb_build_array(jsonb_build_object('a', a->>'fexp', 'c', 64250, 'cat', a->>'c_event', 'p', p_fest), jsonb_build_object('a', a->>'check', 'c', -64250)));
  perform ledger.demo_post(p_org, p_owner, v_recent + 27, 'Fall Festival — ticket and food sales',
    jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', 346000), jsonb_build_object('a', a->>'fund', 'c', -346000, 'p', p_fest)));
  if v_recent + 58 <= current_date then
    perform ledger.demo_post(p_org, p_owner, v_recent + 58, 'Park bench repairs — Oakline Carpentry',
      jsonb_build_array(jsonb_build_object('a', a->>'prog', 'c', 114000, 'cat', a->>'c_park', 'f', f_park), jsonb_build_object('a', a->>'check', 'c', -114000)));
  end if;
  if v_recent + 80 <= current_date then
    perform ledger.demo_post(p_org, p_owner, v_recent + 80, 'Food drive boxes and signage',
      jsonb_build_array(jsonb_build_object('a', a->>'prog', 'c', 38640, 'cat', a->>'c_food', 'p', p_food), jsonb_build_object('a', a->>'check', 'c', -38640)));
  end if;

  -- Statement checks: Checking matched to the bank for the first two full months.
  for v_m in 0..1 loop
    v_month := (date_trunc('month', v_start) + make_interval(months => v_m))::date;
    exit when (v_month + interval '1 month - 1 day')::date >= current_date;
    select coalesce(sum(e.amount_cents), 0) into v_begin
    from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = (a->>'check')::uuid and t.transaction_date < v_month;
    select v_begin + coalesce(sum(e.amount_cents), 0) into v_end
    from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = (a->>'check')::uuid
      and t.transaction_date between v_month and (v_month + interval '1 month - 1 day')::date;
    insert into ledger.reconciliations (org_id, account_id, period_start, period_end,
        beginning_balance_cents, ending_balance_cents, created_by)
    values (p_org, (a->>'check')::uuid, v_month, (v_month + interval '1 month - 1 day')::date, v_begin, v_end, p_owner)
    returning id into v_rec;
    update ledger.entries e set reconciliation_id = v_rec
    from ledger.transactions t
    where t.id = e.transaction_id and e.account_id = (a->>'check')::uuid
      and t.transaction_date between v_month and (v_month + interval '1 month - 1 day')::date;
    update ledger.reconciliations set status = 'completed', completed_by = p_owner,
      completed_at = (v_month + interval '1 month' + interval '5 days')
    where id = v_rec;
  end loop;

  -- Recurring transactions: two due this week, one next month.
  perform ledger._demo_template(p_org, 'Website hosting and email', 'Monthly hosting', 'monthly', current_date + 3,
    jsonb_build_array(jsonb_build_object('accountId', a->>'ops', 'amountCents', 2900, 'memo', 'Website & software'),
      jsonb_build_object('accountId', a->>'check', 'amountCents', -2900)));
  perform ledger._demo_template(p_org, 'Monthly service fee', 'Bank service fee', 'monthly', current_date + 6,
    jsonb_build_array(jsonb_build_object('accountId', a->>'ops', 'amountCents', 1200, 'memo', 'Bank fees'),
      jsonb_build_object('accountId', a->>'check', 'amountCents', -1200)));
  perform ledger._demo_template(p_org, 'General liability insurance', 'Quarterly premium', 'quarterly',
    (date_trunc('quarter', current_date) + interval '3 months 5 days')::date,
    jsonb_build_array(jsonb_build_object('accountId', a->>'ops', 'amountCents', 61200, 'memo', 'Insurance'),
      jsonb_build_object('accountId', a->>'check', 'amountCents', -61200)));

  -- This year's budget: dues a little above a full year of what Charter collects.
  insert into ledger.budgets (id, org_id, account_id, period_type, period_start, amount_cents) values
    (gen_random_uuid(), p_org, (a->>'dues')::uuid, 'year', date_trunc('year', current_date)::date,
      greatest(100000, round(v_dues * 365.0 / greatest(current_date - v_start, 30) * 1.05 / 50000) * 50000)::bigint),
    (gen_random_uuid(), p_org, (a->>'don')::uuid, 'year', date_trunc('year', current_date)::date, 400000),
    (gen_random_uuid(), p_org, (a->>'fund')::uuid, 'year', date_trunc('year', current_date)::date, 350000),
    (gen_random_uuid(), p_org, (a->>'prog')::uuid, 'year', date_trunc('year', current_date)::date, 600000),
    (gen_random_uuid(), p_org, (a->>'fexp')::uuid, 'year', date_trunc('year', current_date)::date, 250000),
    (gen_random_uuid(), p_org, (a->>'ops')::uuid, 'year', date_trunc('year', current_date)::date, 650000);
end;
$$;

-- Northstar Veterans League, the national (the second demo). The national's own dues (its share
-- of every member's dues, recorded on the national's unit in OpenCharterApp), a quarterly magazine,
-- insurance for the posts, grants to posts, the annual convention.
create or replace function ledger.demo_fill_national(p_org uuid, p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  a jsonb;
  f_relief uuid; p_conv uuid;
  v_start date := least(date_trunc('year', current_date)::date, current_date - 92);
  v_month date; v_d date; v_amt int; v_dues bigint; v_w int;
  v_posts text[] := array['Post 1 Cedar Falls', 'Post 7 Riverbend', 'Post 12 Harbor City', 'Post 23 Millbrook'];
begin
  perform setseed(0.1919);
  a := ledger._demo_chart(p_org);
  insert into ledger.funds (org_id, name, is_restricted) values (p_org, 'Veterans Relief Fund', true) returning id into f_relief;
  insert into ledger.projects (org_id, name, budget_cents, status) values (p_org, 'Annual Convention', 1800000, 'active') returning id into p_conv;

  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', 4185000), jsonb_build_object('a', a->>'net', 'c', -4185000)), 'opening_balance');
  -- Savings holds the general reserve and the restricted Veterans Relief Fund.
  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a->>'save', 'c', 6200000), jsonb_build_object('a', a->>'net', 'c', -6200000),
      jsonb_build_object('a', a->>'save', 'c', 1250000, 'f', f_relief, 'm', 'Veterans Relief Fund'),
      jsonb_build_object('a', a->>'net', 'c', -1250000, 'f', f_relief)), 'opening_balance');

  v_dues := ledger._demo_charter_dues(p_org, p_owner, v_start, a);

  v_month := date_trunc('month', v_start)::date;
  while v_month <= current_date loop
    if v_month + 2 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 2, 'Membership software and website',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 14900, 'cat', a->>'c_web'), jsonb_build_object('a', a->>'check', 'c', -14900)));
    end if;
    if v_month + 27 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 27, 'Monthly service fee',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 1500, 'cat', a->>'c_bank'), jsonb_build_object('a', a->>'check', 'c', -1500)));
    end if;
    if extract(month from v_month) in (2, 5, 8, 11) and v_month + 12 between v_start and current_date then
      v_amt := 380000 + floor(random() * 40000)::int;
      perform ledger.demo_post(p_org, p_owner, v_month + 12, 'Northstar Dispatch — quarterly magazine printing and postage',
        jsonb_build_array(jsonb_build_object('a', a->>'prog', 'c', v_amt, 'cat', a->>'c_mag'), jsonb_build_object('a', a->>'check', 'c', -v_amt)));
    end if;
    if extract(month from v_month) in (1, 4, 7, 10) and v_month + 5 between v_start and current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 5, 'Liability insurance for the national and its posts (quarterly)',
        jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 248000, 'cat', a->>'c_ins'), jsonb_build_object('a', a->>'check', 'c', -248000)));
    end if;
    for v_w in 1..2 loop
      v_d := v_month + 4 + v_w * 10;
      if v_d between v_start and current_date then
        v_amt := (array[10000, 25000, 50000, 5000, 100000])[1 + floor(random() * 5)::int];
        perform ledger.demo_post(p_org, p_owner, v_d, 'Donation to the Veterans Relief Fund',
          jsonb_build_array(jsonb_build_object('a', a->>'save', 'c', v_amt, 'f', f_relief), jsonb_build_object('a', a->>'don', 'c', -v_amt, 'f', f_relief)));
      end if;
    end loop;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  -- Relief grants to posts, and the convention (registrations in, hotel deposit out).
  for v_w in 1..4 loop
    v_d := current_date - 20 * v_w - 5;
    if v_d >= v_start then
      perform ledger.demo_post(p_org, p_owner, v_d, 'Relief grant — ' || v_posts[v_w],
        jsonb_build_array(jsonb_build_object('a', a->>'prog', 'c', 150000, 'cat', a->>'c_grants', 'f', f_relief),
          jsonb_build_object('a', a->>'save', 'c', -150000, 'f', f_relief)));
    end if;
  end loop;
  perform ledger.demo_post(p_org, p_owner, greatest(v_start, current_date - 60), 'Convention hotel deposit — Lakeshore Conference Center',
    jsonb_build_array(jsonb_build_object('a', a->>'fexp', 'c', 600000, 'cat', a->>'c_conf', 'p', p_conv), jsonb_build_object('a', a->>'check', 'c', -600000)));
  perform ledger.demo_post(p_org, p_owner, greatest(v_start, current_date - 30), 'Convention registrations (early bird)',
    jsonb_build_array(jsonb_build_object('a', a->>'check', 'c', 482500), jsonb_build_object('a', a->>'fund', 'c', -482500, 'p', p_conv)));
  perform ledger.demo_post(p_org, p_owner, greatest(v_start, current_date - 14), 'National officers'' travel — regional visits',
    jsonb_build_array(jsonb_build_object('a', a->>'ops', 'c', 86340, 'cat', a->>'c_travel'), jsonb_build_object('a', a->>'check', 'c', -86340)));

  perform ledger._demo_template(p_org, 'Membership software and website', 'Monthly subscription', 'monthly', current_date + 2,
    jsonb_build_array(jsonb_build_object('accountId', a->>'ops', 'amountCents', 14900, 'memo', 'Website & software'),
      jsonb_build_object('accountId', a->>'check', 'amountCents', -14900)));
  perform ledger._demo_template(p_org, 'Post insurance premium', 'Quarterly, for the national and its posts', 'quarterly', current_date + 5,
    jsonb_build_array(jsonb_build_object('accountId', a->>'ops', 'amountCents', 248000, 'memo', 'Insurance'),
      jsonb_build_object('accountId', a->>'check', 'amountCents', -248000)));

  insert into ledger.budgets (id, org_id, account_id, period_type, period_start, amount_cents) values
    (gen_random_uuid(), p_org, (a->>'dues')::uuid, 'year', date_trunc('year', current_date)::date,
      greatest(100000, round(v_dues * 365.0 / greatest(current_date - v_start, 30) * 1.05 / 50000) * 50000)::bigint),
    (gen_random_uuid(), p_org, (a->>'don')::uuid, 'year', date_trunc('year', current_date)::date, 1200000),
    (gen_random_uuid(), p_org, (a->>'fund')::uuid, 'year', date_trunc('year', current_date)::date, 1500000),
    (gen_random_uuid(), p_org, (a->>'prog')::uuid, 'year', date_trunc('year', current_date)::date, 2400000),
    (gen_random_uuid(), p_org, (a->>'fexp')::uuid, 'year', date_trunc('year', current_date)::date, 1800000),
    (gen_random_uuid(), p_org, (a->>'ops')::uuid, 'year', date_trunc('year', current_date)::date, 1400000);
end;
$$;

revoke all on function ledger._demo_chart(uuid), ledger._demo_charter_dues(uuid, uuid, date, jsonb),
  ledger._demo_template(uuid, text, text, text, date, jsonb), ledger.demo_fill(uuid, uuid),
  ledger.demo_fill_national(uuid, uuid)
from public, anon, authenticated;

-- Rebuild the demo with this version: through the hub's reset when it's here.
do $fill$
begin
  if to_regprocedure('hub.reset_suite_demo()') is not null then
    perform hub.reset_suite_demo();
  end if;
end
$fill$;
