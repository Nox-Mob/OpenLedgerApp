-- OpenLedgerApp's part of the suite demo, STAGING (and local development) only. Applied by
-- scripts/migrate.mjs --seed (Migrate → staging), recorded under "openledgerapp:seed".
--
-- The suite has one demo organization, "Riverside Community Association", owned by the demo
-- account demo@demo.openapphub.org, and one empty test account test@demo.openapphub.org (both
-- password OpenAppHubDemo2026). OpenAppHub creates them and resets everything every 12 hours
-- (hub.reset_suite_demo, the hub's demo-reset workflow), calling ledger.demo_fill for the books:
-- about three months of a neighbourhood association's money, dated from the day it runs.
--
-- Without the hub (a self-hosted development database) this file creates the same two
-- accounts and the organization itself, once.

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

-- One posted transaction from (account, amount, category, fund, project) lines; amounts are
-- debits positive, credits negative, and must add up to zero.
create or replace function ledger.demo_post(p_org uuid, p_user uuid, p_date date, p_description text,
  p_lines jsonb, p_source ledger.transaction_source default 'manual')
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tx uuid := gen_random_uuid();
begin
  insert into ledger.transactions (id, org_id, transaction_date, posted_date, description, source, created_by)
  values (v_tx, p_org, p_date, p_date, p_description, p_source, p_user);
  insert into ledger.entries (transaction_id, account_id, amount_cents, category_id, fund_id, project_id, memo)
  select v_tx, (l->>'a')::uuid, (l->>'c')::bigint, (l->>'cat')::uuid, (l->>'f')::uuid, (l->>'p')::uuid, l->>'m'
  from jsonb_array_elements(p_lines) l;
  return v_tx;
end;
$$;

create or replace function ledger.demo_fill(p_org uuid, p_owner uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  a_check uuid; a_save uuid; a_net uuid; a_dues uuid; a_don uuid; a_fund uuid; a_grant uuid;
  a_prog uuid; a_fexp uuid; a_ops uuid;
  c_ins uuid; c_web uuid; c_print uuid; c_bank uuid; c_event uuid; c_park uuid; c_food uuid; c_post uuid;
  f_park uuid; p_fest uuid; p_food uuid;
  v_start date := current_date - 92;
  v_d date; v_w int; v_amt int; v_month date;
  v_rec uuid; v_begin bigint; v_end bigint; v_m int;
  v_donors text[] := array['M. Alvarez', 'The Kim family', 'R. Thompson', 'Riverside Hardware', 'J. Patel', 'A. Okafor', 'L. Nguyen', 'Corner Coffee Co.'];
begin
  perform setseed(0.31415);

  insert into ledger.org_settings (org_id, org_type, currency, fiscal_year_start_month, terminology, timezone)
  values (p_org, 'nonprofit', 'USD', 1, 'simple', 'America/Chicago')
  on conflict (org_id) do nothing;

  insert into ledger.accounts (org_id, name, type, subtype) values (p_org, 'Checking', 'asset', 'bank') returning id into a_check;
  insert into ledger.accounts (org_id, name, type, subtype) values (p_org, 'Savings', 'asset', 'bank') returning id into a_save;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Net Assets', 'equity') returning id into a_net;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Membership Dues', 'revenue') returning id into a_dues;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Donations', 'revenue') returning id into a_don;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Fundraising Sales', 'revenue') returning id into a_fund;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Grants', 'revenue') returning id into a_grant;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Program Expenses', 'expense') returning id into a_prog;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Fundraising Expenses', 'expense') returning id into a_fexp;
  insert into ledger.accounts (org_id, name, type) values (p_org, 'Operating Expenses', 'expense') returning id into a_ops;

  insert into ledger.categories (org_id, name, type) values (p_org, 'Insurance', 'expense') returning id into c_ins;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Website & software', 'expense') returning id into c_web;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Printing & newsletter', 'expense') returning id into c_print;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Bank fees', 'expense') returning id into c_bank;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Event supplies', 'expense') returning id into c_event;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Parks & grounds', 'expense') returning id into c_park;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Food drive', 'expense') returning id into c_food;
  insert into ledger.categories (org_id, name, type) values (p_org, 'Postage & P.O. box', 'expense') returning id into c_post;

  insert into ledger.funds (org_id, name, is_restricted) values (p_org, 'Park Improvement Fund', true) returning id into f_park;
  insert into ledger.projects (org_id, name, budget_cents, status) values (p_org, 'Fall Festival', 250000, 'completed') returning id into p_fest;
  insert into ledger.projects (org_id, name, budget_cents, status) values (p_org, 'Holiday Food Drive', 40000, 'active') returning id into p_food;

  -- Opening balances, when the association started keeping its books here.
  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a_check, 'c', 1520000), jsonb_build_object('a', a_net, 'c', -1520000)),
    'opening_balance');
  perform ledger.demo_post(p_org, p_owner, v_start, 'Opening balance',
    jsonb_build_array(jsonb_build_object('a', a_save, 'c', 800000), jsonb_build_object('a', a_net, 'c', -800000)),
    'opening_balance');

  -- Weekly: dues deposited from the membership desk (checks and cash).
  for v_w in 0..12 loop
    v_d := v_start + 3 + v_w * 7;
    exit when v_d > current_date;
    v_amt := (180 + floor(random() * 540))::int * 100;
    perform ledger.demo_post(p_org, p_owner, v_d, 'Membership dues deposit',
      jsonb_build_array(jsonb_build_object('a', a_check, 'c', v_amt), jsonb_build_object('a', a_dues, 'c', -v_amt)));
  end loop;

  -- Monthly: online dues payouts, donations, recurring bills, a transfer to savings.
  for v_m in 0..2 loop
    v_month := (date_trunc('month', v_start) + make_interval(months => v_m + 1))::date;
    if v_month + 1 <= current_date then
      v_amt := (650 + floor(random() * 400))::int * 100 + 37;
      perform ledger.demo_post(p_org, p_owner, v_month + 1, 'Online dues payout (card payments)',
        jsonb_build_array(jsonb_build_object('a', a_check, 'c', v_amt - 2140), jsonb_build_object('a', a_ops, 'c', 2140, 'cat', c_bank, 'm', 'Card processing fees'),
          jsonb_build_object('a', a_dues, 'c', -v_amt)));
    end if;
    if v_month + 4 <= current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 4, 'Website hosting and email',
        jsonb_build_array(jsonb_build_object('a', a_ops, 'c', 2900, 'cat', c_web), jsonb_build_object('a', a_check, 'c', -2900)));
    end if;
    if v_month + 8 <= current_date then
      v_amt := 17500 + floor(random() * 2500)::int;
      perform ledger.demo_post(p_org, p_owner, v_month + 8, 'Newsletter printing — Riverside Print Shop',
        jsonb_build_array(jsonb_build_object('a', a_ops, 'c', v_amt, 'cat', c_print), jsonb_build_object('a', a_check, 'c', -v_amt)));
    end if;
    if v_month + 15 <= current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 15, 'Transfer to savings',
        jsonb_build_array(jsonb_build_object('a', a_save, 'c', 50000), jsonb_build_object('a', a_check, 'c', -50000)), 'transfer');
    end if;
    if v_month + 27 <= current_date then
      perform ledger.demo_post(p_org, p_owner, v_month + 27, 'Monthly service fee',
        jsonb_build_array(jsonb_build_object('a', a_ops, 'c', 1200, 'cat', c_bank), jsonb_build_object('a', a_check, 'c', -1200)));
    end if;
    for v_w in 1..3 loop
      v_d := v_month + 2 + v_w * 7;
      if v_d <= current_date then
        v_amt := (array[5000, 10000, 2500, 25000, 7500, 15000])[1 + floor(random() * 6)::int];
        perform ledger.demo_post(p_org, p_owner, v_d, 'Donation — ' || v_donors[1 + floor(random() * 8)::int],
          jsonb_build_array(jsonb_build_object('a', a_check, 'c', v_amt), jsonb_build_object('a', a_don, 'c', -v_amt)));
      end if;
    end loop;
  end loop;

  -- One-offs over the quarter.
  perform ledger.demo_post(p_org, p_owner, v_start + 6, 'General liability insurance (quarterly)',
    jsonb_build_array(jsonb_build_object('a', a_ops, 'c', 61200, 'cat', c_ins), jsonb_build_object('a', a_check, 'c', -61200)));
  perform ledger.demo_post(p_org, p_owner, v_start + 10, 'P.O. box renewal',
    jsonb_build_array(jsonb_build_object('a', a_ops, 'c', 9400, 'cat', c_post), jsonb_build_object('a', a_check, 'c', -9400)));
  perform ledger.demo_post(p_org, p_owner, v_start + 31, 'Riverside Community Foundation — park grant',
    jsonb_build_array(jsonb_build_object('a', a_check, 'c', 200000), jsonb_build_object('a', a_grant, 'c', -200000, 'f', f_park, 'm', 'Restricted to park improvements')));
  perform ledger.demo_post(p_org, p_owner, v_start + 18, 'Fall Festival — vendor deposits and bounce house',
    jsonb_build_array(jsonb_build_object('a', a_fexp, 'c', 118500, 'cat', c_event, 'p', p_fest), jsonb_build_object('a', a_check, 'c', -118500)));
  perform ledger.demo_post(p_org, p_owner, v_start + 24, 'Fall Festival — supplies, permits and signage',
    jsonb_build_array(jsonb_build_object('a', a_fexp, 'c', 64250, 'cat', c_event, 'p', p_fest), jsonb_build_object('a', a_check, 'c', -64250)));
  perform ledger.demo_post(p_org, p_owner, v_start + 27, 'Fall Festival — ticket and food sales',
    jsonb_build_array(jsonb_build_object('a', a_check, 'c', 346000), jsonb_build_object('a', a_fund, 'c', -346000, 'p', p_fest)));
  if v_start + 58 <= current_date then
    perform ledger.demo_post(p_org, p_owner, v_start + 58, 'Park bench repairs — Oakline Carpentry',
      jsonb_build_array(jsonb_build_object('a', a_prog, 'c', 114000, 'cat', c_park, 'f', f_park), jsonb_build_object('a', a_check, 'c', -114000)));
  end if;
  if v_start + 80 <= current_date then
    perform ledger.demo_post(p_org, p_owner, v_start + 80, 'Food drive boxes and signage',
      jsonb_build_array(jsonb_build_object('a', a_prog, 'c', 38640, 'cat', c_food, 'p', p_food), jsonb_build_object('a', a_check, 'c', -38640)));
  end if;

  -- Statement checks: Checking matched to the bank for the first two full months.
  for v_m in 0..1 loop
    v_month := (date_trunc('month', v_start) + make_interval(months => v_m))::date;
    select coalesce(sum(e.amount_cents), 0) into v_begin
    from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = a_check and t.transaction_date < greatest(v_month, v_start);
    select v_begin + coalesce(sum(e.amount_cents), 0) into v_end
    from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = a_check
      and t.transaction_date between greatest(v_month, v_start) and (v_month + interval '1 month - 1 day')::date;
    insert into ledger.reconciliations (org_id, account_id, period_start, period_end,
        beginning_balance_cents, ending_balance_cents, created_by)
    values (p_org, a_check, greatest(v_month, v_start), (v_month + interval '1 month - 1 day')::date, v_begin, v_end, p_owner)
    returning id into v_rec;
    update ledger.entries e set reconciliation_id = v_rec
    from ledger.transactions t
    where t.id = e.transaction_id and e.account_id = a_check
      and t.transaction_date between greatest(v_month, v_start) and (v_month + interval '1 month - 1 day')::date;
    update ledger.reconciliations set status = 'completed', completed_by = p_owner,
      completed_at = (v_month + interval '1 month' + interval '5 days')
    where id = v_rec;
  end loop;

  -- This year's budget, by account.
  insert into ledger.budgets (id, org_id, account_id, period_type, period_start, amount_cents) values
    (gen_random_uuid(), p_org, a_dues, 'year', date_trunc('year', current_date)::date, 3200000),
    (gen_random_uuid(), p_org, a_don, 'year', date_trunc('year', current_date)::date, 900000),
    (gen_random_uuid(), p_org, a_fund, 'year', date_trunc('year', current_date)::date, 350000),
    (gen_random_uuid(), p_org, a_prog, 'year', date_trunc('year', current_date)::date, 600000),
    (gen_random_uuid(), p_org, a_fexp, 'year', date_trunc('year', current_date)::date, 250000),
    (gen_random_uuid(), p_org, a_ops, 'year', date_trunc('year', current_date)::date, 650000);
end;
$$;

revoke all on function ledger.demo_post(uuid, uuid, date, text, jsonb, ledger.transaction_source) from public, anon, authenticated;
revoke all on function ledger.demo_fill(uuid, uuid) from public, anon, authenticated;

-- Fill now: through the hub's reset when it's there (it recreates the organization and calls
-- every app), otherwise create the two accounts and the organization here, once.
do $fill$
declare
  c_org constant uuid := 'de000000-0000-4000-8000-0000000000a1';
  c_demo constant uuid := 'de000000-0000-4000-8000-000000000001';
  c_test constant uuid := 'de000000-0000-4000-8000-000000000002';
  r record;
begin
  if to_regprocedure('hub.reset_suite_demo()') is not null then
    perform hub.reset_suite_demo();
    return;
  end if;
  if exists (select 1 from public.organizations where id = c_org) then
    if not exists (select 1 from ledger.accounts where org_id = c_org) then
      perform ledger.demo_fill(c_org, c_demo);
    end if;
    return;
  end if;
  for r in select * from (values
      (c_demo, 'demo@demo.openapphub.org', 'Alex Morgan'),
      (c_test, 'test@demo.openapphub.org', 'Test Account')) v(id, email, name) loop
    if not exists (select 1 from auth.users where id = r.id) then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
        recovery_token, email_change_token_new, email_change, email_change_token_current,
        reauthentication_token, phone_change, phone_change_token)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
        extensions.crypt('OpenAppHubDemo2026', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', r.name),
        now(), now(), '', '', '', '', '', '', '', '');
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
        'email', now(), now(), now());
    end if;
  end loop;
  insert into public.organizations (id, name, slug, created_by)
  values (c_org, 'Riverside Community Association', 'riverside-community-association', c_demo);
  insert into public.memberships (org_id, user_id, role) values (c_org, c_demo, 'owner');
  perform ledger.demo_fill(c_org, c_demo);
end
$fill$;
