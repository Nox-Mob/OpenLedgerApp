-- S-19: finishing a task from the hub's dashboard. A recurring transaction that's due can be
-- skipped with a click (posting it stays in OpenLedgerApp, where the amounts are confirmed).
-- ledger.skip_recurring_due runs as the caller (security invoker), through ledger.audited_write
-- like the app's own Skip, so row security, the books lock and the audit log all apply.
-- ledger.api_tasks gains `completable` at the end (never remove or rename a column).

create or replace function ledger._next_recurring_date(p_freq text, p_date date, p_anchor int)
returns date
language sql
immutable
set search_path = ''
as $$
  -- Same rule as src/lib/domain/templates.ts nextDate: weekly +7 days; monthly, quarterly and
  -- yearly keep the anchor day, clamped to the month's last day.
  select case p_freq
    when 'weekly' then p_date + 7
    else (
      select least(make_date(extract(year from m)::int, extract(month from m)::int, 1) + (p_anchor - 1),
                   (date_trunc('month', m) + interval '1 month - 1 day')::date)
      from (select date_trunc('month', p_date)::date
                   + make_interval(months => case p_freq when 'monthly' then 1 when 'quarterly' then 3 else 12 end) as m) x)
  end;
$$;

create or replace function ledger.skip_recurring_due(p_template uuid)
returns date
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_t ledger.transaction_templates;
  v_next date;
begin
  select * into v_t from ledger.transaction_templates where id = p_template;
  if not found then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
  if not v_t.active or v_t.frequency is null or v_t.next_due is null then
    raise exception 'Nothing is due for this template.' using errcode = '22023';
  end if;
  v_next := ledger._next_recurring_date(v_t.frequency, v_t.next_due, extract(day from v_t.next_due)::int);
  perform ledger.audited_write(v_t.org_id,
    jsonb_build_array(
      jsonb_build_object('table', 'recurring_occurrences', 'op', 'insert', 'values', jsonb_build_object(
        'id', gen_random_uuid(), 'template_id', v_t.id, 'due_date', v_t.next_due, 'status', 'skipped', 'transaction_id', null)),
      jsonb_build_object('table', 'transaction_templates', 'op', 'update', 'values', jsonb_build_object('next_due', v_next),
        'match', jsonb_build_object('id', v_t.id), 'min_rows', 1)),
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'action', 'template.skipped', 'entity', 'template',
      'entity_id', v_t.id, 'before', null, 'after', jsonb_build_object('dueDate', v_t.next_due, 'from', 'hub'), 'kind', 'change')));
  return v_next;
end;
$$;

revoke all on function ledger.skip_recurring_due(uuid), ledger._next_recurring_date(text, date, int) from public, anon;
grant execute on function ledger.skip_recurring_due(uuid) to authenticated;
grant execute on function ledger._next_recurring_date(text, date, int) to authenticated;

create or replace view ledger.api_tasks with (security_invoker = true) as
select
  t.org_id,
  'recurring_due'::text as kind,
  'Record ' || t.name as title,
  t.next_due as due_on,
  t.id as item_id,
  '/templates'::text as link,
  -- S-19: can be finished from the hub (skipped there; posted in OpenLedgerApp).
  true as completable
from ledger.transaction_templates t
where t.active and t.frequency is not null and t.next_due is not null
  and t.next_due <= current_date + 7;
