-- Steps OpenLedgerApp offers the workflow designer (core 0012, S-28). They run as the
-- organization (owner decision 2026-11-12), inside it only.
--
--   ledger.month_totals (lookup) income, spending and net for a month: the last closed month,
--                                this month, or the month of a date
-- The financial reports into a meeting (ledger.reports_to_meeting) stay a job the app does; in the
-- designer, its meeting comes from an earlier step (the step's "context").

create or replace function ledger.wf_month_totals(p_org uuid, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_locked date;
  r record;
begin
  select books_locked_through into v_locked from ledger.org_settings where org_id = p_org;
  v_month := case coalesce(nullif(p_params ->> 'month', ''), 'last_closed_month')
    when 'this_month' then date_trunc('month', current_date)::date
    when 'date' then date_trunc('month', coalesce(nullif(p_params ->> 'date', '')::date, current_date))::date
    else date_trunc('month', coalesce(v_locked, (date_trunc('month', current_date) - interval '1 day')::date))::date end;
  select coalesce(sum(s.revenue_cents), 0) as income, coalesce(sum(s.expense_cents), 0) as spending,
         coalesce(sum(s.net_cents), 0) as net, coalesce(sum(s.transaction_count), 0) as n,
         coalesce(max(s.currency), 'USD') as currency
    into r
  from ledger.api_period_summaries s
  where s.org_id = p_org and s.month = v_month;
  return jsonb_build_object(
    'month', v_month, 'month_name', to_char(v_month, 'FMMonth YYYY'),
    'income', round(r.income / 100.0, 2), 'spending', round(r.spending / 100.0, 2), 'net', round(r.net / 100.0, 2),
    'currency', r.currency, 'transactions', r.n, 'closed', v_locked is not null and v_locked >= (v_month + interval '1 month - 1 day')::date,
    'summary', format('%s: income %s, spending %s', to_char(v_month, 'FMMonth YYYY'), round(r.income / 100.0, 2), round(r.spending / 100.0, 2)));
end;
$$;
revoke all on function ledger.wf_month_totals(uuid, jsonb) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.register_automation_step(text,text,text,text,text,text,jsonb,jsonb,text[],integer)') is not null then
    perform public.register_automation_step('ledger.month_totals', 'ledger', 'Month totals',
      'Income, spending and net for a month (the last closed month, this month, or a date''s month).', 'query', 'ledger.wf_month_totals',
      '{"month": {"type": "choice", "label": "Which month", "options": ["last_closed_month", "this_month", "date"]},
        "date": {"type": "date", "label": "Date (for \"date\")", "optional": true}}',
      '[{"key": "month_name", "label": "Month", "type": "text"}, {"key": "income", "label": "Income", "type": "number"},
        {"key": "spending", "label": "Spending", "type": "number"}, {"key": "net", "label": "Net", "type": "number"},
        {"key": "currency", "label": "Currency", "type": "text"}, {"key": "transactions", "label": "Transactions", "type": "number"},
        {"key": "closed", "label": "Books closed for it", "type": "boolean"}]', '{}', 5);
    -- The existing job, described for the designer: its output.
    update public.automation_action_types set output_schema =
      '[{"key": "summary", "label": "What it did", "type": "text"}, {"key": "document_id", "label": "Document", "type": "text"}]'
    where type = 'ledger.reports_to_meeting';
  end if;
end $$;
