-- S-25 part 2: OpenLedgerApp in organizations' workflows (core 0009).
--   Trigger  ledger.books_locked        the books are locked (a month is closed) through a later date
--   Action   ledger.reports_to_meeting  build the financial reports and add them to the meeting the
--                                       workflow is about (needs a meeting trigger, e.g. "a board
--                                       meeting is 5 days away"), as of the last closed month, today,
--                                       or a date the organization picks
-- The action is queued in public.automation_jobs and carried out by the app (src/lib/automation
-- .server.ts): the hub's scheduler asks the app to run its jobs; self-hosted, the app's own cron does.

create or replace function ledger._wf_books_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.books_locked_through is not null
     and (tg_op = 'INSERT' or old.books_locked_through is null or new.books_locked_through > old.books_locked_through) then
    perform public.emit_automation_event(new.org_id, 'ledger.books_locked', jsonb_build_object(
      'books', jsonb_build_object('locked_through', new.books_locked_through,
        'month', to_char(new.books_locked_through, 'YYYY-MM'),
        'month_name', to_char(new.books_locked_through, 'FMMonth YYYY')),
      'link', format('/reports?org=%s', new.org_id), 'link_app', 'ledger',
      'summary', format('Books locked through %s', to_char(new.books_locked_through, 'Mon DD, YYYY'))));
  end if;
  return new;
end;
$$;

drop trigger if exists org_settings_wf_locked on ledger.org_settings;
create trigger org_settings_wf_locked after insert or update of books_locked_through on ledger.org_settings
  for each row execute function ledger._wf_books_locked();
revoke all on function ledger._wf_books_locked() from public, anon, authenticated;

select public.register_automation_trigger(
  'ledger.books_locked', 'ledger', 'The books are closed for a month',
  'When the books are locked through a later date (closing a month locks them through its last day).',
  'event', null, '{}',
  '[{"key": "books.locked_through", "label": "Locked through", "type": "date"},
    {"key": "books.month", "label": "Month (YYYY-MM)", "type": "text"},
    {"key": "books.month_name", "label": "Month name", "type": "text"}]',
  null, '{}', 40);

select public.register_automation_action(
  'ledger.reports_to_meeting', 'ledger', 'Add the financial reports to the meeting',
  'Builds the board package (income, balance, budget against actual and, for nonprofits, fund activity) from OpenLedgerApp and adds it to the meeting''s documents and packet.',
  '{"as_of": {"type": "choice", "label": "As of", "options": ["last_closed_month", "today", "date"],
     "help": "The last closed month: the month the books are locked through. Today: the year so far. A date: the year up to that day."},
    "date": {"type": "date", "label": "Date", "optional": true}}',
  '{meeting}', 40);
