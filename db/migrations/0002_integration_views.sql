-- Integration views (SHARED-SPEC §3.6, S-03): the read-only data Ledger publishes for the hub
-- and the other apps. `security_invoker` makes every view run with the caller's own row
-- security, so it shows exactly what the caller could read in Ledger's own tables.
-- Consumers feature-detect: on a database without Ledger these views don't exist.
-- Columns and meanings: docs/INTEGRATION.md. Add columns at the end; never remove or rename one.

-- Budgets: one row per account and period (a year or a month), optionally for a fund or project.
create view ledger.api_budgets with (security_invoker = true) as
select
  b.id,
  b.org_id,
  b.account_id,
  a.name as account_name,
  a.type::text as account_type,
  b.period_type,
  b.period_start,
  (case when b.period_type = 'year' then b.period_start + interval '1 year'
        else b.period_start + interval '1 month' end - interval '1 day')::date as period_end,
  b.amount_cents,
  b.fund_id,
  b.project_id,
  b.updated_at
from ledger.budgets b
join ledger.accounts a on a.id = b.account_id;

-- Money in and out per calendar month, from posted transactions (the same rules as the income
-- statement: revenue and expense accounts, voided and year-end closing entries left out).
create view ledger.api_period_summaries with (security_invoker = true) as
select
  t.org_id,
  date_trunc('month', t.transaction_date)::date as month,
  coalesce(s.currency, 'USD') as currency,
  coalesce(sum(-e.amount_cents) filter (where a.type = 'revenue'), 0)::bigint as revenue_cents,
  coalesce(sum(e.amount_cents) filter (where a.type = 'expense'), 0)::bigint as expense_cents,
  (coalesce(sum(-e.amount_cents) filter (where a.type = 'revenue'), 0)
    - coalesce(sum(e.amount_cents) filter (where a.type = 'expense'), 0))::bigint as net_cents,
  count(distinct t.id)::int as transaction_count
from ledger.transactions t
join ledger.entries e on e.transaction_id = t.id
join ledger.accounts a on a.id = e.account_id
left join ledger.org_settings s on s.org_id = t.org_id
where t.status = 'posted' and t.source <> 'closing'
group by t.org_id, date_trunc('month', t.transaction_date), s.currency;

comment on view ledger.api_budgets is 'Ledger budgets per account and period. docs/INTEGRATION.md';
comment on view ledger.api_period_summaries is 'Ledger revenue, expenses and net per month. docs/INTEGRATION.md';

grant select on ledger.api_budgets, ledger.api_period_summaries to authenticated;
