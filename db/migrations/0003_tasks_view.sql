-- Tasks for the hub's dashboard (S-15, SHARED-SPEC §3.6): what needs doing in Ledger, read-only,
-- with the caller's own row security.
--   recurring_due  a recurring transaction (an active template) due within the next 7 days or overdue
-- `link` is the path in OpenLedgerApp where the task is done.
-- Columns and meanings: docs/INTEGRATION.md. Add columns at the end; never remove or rename one.
create view ledger.api_tasks with (security_invoker = true) as
select
  t.org_id,
  'recurring_due'::text as kind,
  'Record ' || t.name as title,
  t.next_due as due_on,
  t.id as item_id,
  '/templates'::text as link
from ledger.transaction_templates t
where t.active and t.frequency is not null and t.next_due is not null
  and t.next_due <= current_date + 7;

comment on view ledger.api_tasks is 'Ledger tasks: recurring transactions due. docs/INTEGRATION.md';
grant select on ledger.api_tasks to authenticated;
