-- Performance check (mirrors OpenCharterApp's db/perf/large-roster.sql): grows the
-- measured books to :txns posted transactions (2 entries each, about 8 years of
-- dates), with a bank row per 2 transactions, monthly statement checks and history;
-- every other organization gets a tenth as many. Then times the heavy reports as a
-- member, under row-level security, and fails if one is over :budget_ms. Run after
-- setup.sql, once per size in increasing order; each run adds only what's missing.
\set ON_ERROR_STOP on
\if :{?budget_ms}
\else
  \set budget_ms 1000
\endif
\if :{?txns}
\else
  \set txns 10000
\endif
select set_config('perf.txns', :'txns', false);
\echo
\echo '=== Books with' :txns 'transactions (other orgs:' :txns '/ 10 each)'

-- Seed straight in: the generated data is balanced and in-org by construction, so the
-- per-row guards (balance check, references, audit) are skipped for speed.
set session_replication_role = replica;

insert into ledger.transactions (id, org_id, transaction_date, description, source, status, created_by)
select ('55555555-' || lpad(o::text, 4, '0') || '-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  ('22222222-0000-4000-8000-' || lpad(o::text, 12, '0'))::uuid,
  date '2019-01-01' + (i % 2900), 'Transaction ' || i, 'manual',
  (case when i % 97 = 0 then 'void' else 'posted' end)::ledger.transaction_status, null
from generate_series(1, 31) o
cross join lateral generate_series(1, case when o = 1 then :txns else greatest(1, :txns / 10) end) i
on conflict (id) do nothing;

-- Two entries each: an asset (accounts 1–10) against a revenue or expense account.
insert into ledger.entries (transaction_id, org_id, account_id, amount_cents, fund_id)
select t.id, t.org_id,
  ('44444444-' || substr(t.id::text, 10, 4) || '-4000-8000-' || lpad((1 + n % 10)::text, 12, '0'))::uuid,
  case when n % 3 = 0 then -(1000 + n % 50000) else (1000 + n % 50000) end, null
from (select id, org_id, (substr(id::text, 25))::int n from ledger.transactions t
      where not exists (select 1 from ledger.entries e where e.transaction_id = t.id)) t;
insert into ledger.entries (transaction_id, org_id, account_id, amount_cents)
select e.transaction_id, e.org_id,
  ('44444444-' || substr(e.transaction_id::text, 10, 4) || '-4000-8000-' ||
    lpad((case when e.amount_cents > 0 then 19 + n % 12 else 31 + n % 30 end)::text, 12, '0'))::uuid,
  -e.amount_cents
from (select e.*, (substr(e.transaction_id::text, 25))::int n from ledger.entries e
      where (select count(*) from ledger.entries x where x.transaction_id = e.transaction_id) = 1) e;

insert into ledger.bank_transactions (org_id, account_id, bank_date, description, amount_cents, fingerprint, transaction_id)
select t.org_id, e.account_id, t.transaction_date, t.description, e.amount_cents, 'fp-' || t.id, t.id
from ledger.transactions t join ledger.entries e on e.transaction_id = t.id
where (substr(t.id::text, 25))::int % 2 = 0 and substr(e.account_id::text, 25)::int <= 10
  and not exists (select 1 from ledger.bank_transactions b where b.transaction_id = t.id);

insert into ledger.audit_log (org_id, user_id, action, entity, entity_id, kind)
select t.org_id, null, 'post', 'transaction', t.id, 'ledger'
from ledger.transactions t
where not exists (select 1 from ledger.audit_log a where a.entity_id = t.id);

set session_replication_role = origin;
analyze;

begin;
select tests.as_user('11111111-0000-4000-8000-000000000005');
\timing on
\echo '--- Account balances (every account, posted entries)'
select count(*) from (select e.account_id, sum(e.amount_cents) from ledger.entries e
  join ledger.transactions t on t.id = e.transaction_id
  where e.org_id = '22222222-0000-4000-8000-000000000001' and t.status = 'posted' group by e.account_id) x;
\echo '--- Transactions page (newest 50)'
select count(*) from (select id from ledger.transactions where org_id = '22222222-0000-4000-8000-000000000001'
  order by transaction_date desc, created_at desc limit 50) x;
\echo '--- Income statement for one fiscal year'
select count(*) from (select a.type, sum(e.amount_cents) from ledger.entries e
  join ledger.transactions t on t.id = e.transaction_id join ledger.accounts a on a.id = e.account_id
  where e.org_id = '22222222-0000-4000-8000-000000000001' and t.status = 'posted'
    and t.transaction_date between '2025-01-01' and '2025-12-31' and a.type in ('revenue', 'expense') group by a.type) x;
\echo '--- Account register: one bank account, one year'
select count(*) from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
  where e.account_id = '44444444-0001-4000-8000-000000000001' and t.transaction_date between '2025-01-01' and '2025-12-31';
\echo '--- Unmatched bank rows for one account'
select count(*) from ledger.bank_transactions where org_id = '22222222-0000-4000-8000-000000000001'
  and account_id = '44444444-0001-4000-8000-000000000001' and transaction_id is null;
\timing off

select set_config('perf.budget_ms', :'budget_ms', true);
do $$
declare
  t0 timestamptz; ms numeric; budget numeric := current_setting('perf.budget_ms')::numeric; slow text := '';
  org uuid := '22222222-0000-4000-8000-000000000001';
  bank uuid := '44444444-0001-4000-8000-000000000001';
begin
  t0 := clock_timestamp();
  perform e.account_id, sum(e.amount_cents) from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.org_id = org and t.status = 'posted' group by e.account_id;
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'account balances % ms', round(ms);
  if ms > budget then slow := slow || ' balances'; end if;

  t0 := clock_timestamp();
  perform t.id, (select count(*) from ledger.entries e where e.transaction_id = t.id)
    from ledger.transactions t where t.org_id = org order by t.transaction_date desc, t.created_at desc limit 50;
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'transactions page % ms', round(ms);
  if ms > budget then slow := slow || ' transactions-page'; end if;

  t0 := clock_timestamp();
  perform a.type, sum(e.amount_cents) from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    join ledger.accounts a on a.id = e.account_id
    where e.org_id = org and t.status = 'posted' and t.transaction_date between '2025-01-01' and '2025-12-31'
      and a.type in ('revenue', 'expense') group by a.type;
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'income statement % ms', round(ms);
  if ms > budget then slow := slow || ' income-statement'; end if;

  t0 := clock_timestamp();
  perform e.* from ledger.entries e join ledger.transactions t on t.id = e.transaction_id
    where e.account_id = bank and t.transaction_date between '2025-01-01' and '2025-12-31';
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'account register % ms', round(ms);
  if ms > budget then slow := slow || ' register'; end if;

  t0 := clock_timestamp();
  perform * from ledger.audit_log where org_id = org order by created_at desc limit 50;
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'history page % ms', round(ms);
  if ms > budget then slow := slow || ' history'; end if;

  t0 := clock_timestamp();
  perform e.* from ledger.entries e where e.org_id = org;
  ms := extract(epoch from clock_timestamp() - t0) * 1000; raise notice 'export entries % ms', round(ms);
  if ms > budget then slow := slow || ' export'; end if;

  if slow <> '' then
    raise exception 'with % transactions, over the % ms budget:%', current_setting('perf.txns'), budget, slow;
  end if;
end $$;
rollback;
