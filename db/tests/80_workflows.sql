-- S-25 part 2: OpenLedgerApp in organizations' workflows (0004, core 0009).
begin;
do $$
declare
  owner uuid := tests.create_user('owner@wf.l.org');
  org uuid; r record;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Workflow Ledger');
  perform tests.as_super();
  insert into ledger.org_settings (org_id, currency) values (org, 'USD');
  perform tests.ok(exists (select 1 from public.automation_trigger_types where type = 'ledger.books_locked'), 'the trigger is registered');
  perform tests.ok(exists (select 1 from public.automation_action_types where type = 'ledger.reports_to_meeting' and requires = '{meeting}'),
    'the reports action needs a meeting');

  perform tests.as_user(owner);
  perform tests.throws(format($q$select public.save_workflow(%L, null, 'X', '', true,
    '{"trigger": {"type": "ledger.books_locked"}, "always": [{"type": "ledger.reports_to_meeting", "as_of": "today"}]}')$q$, org),
    'reports need a meeting trigger', 'works only with');
  perform public.save_workflow(org, null, 'Month closed', '', true,
    '{"trigger": {"type": "ledger.books_locked"},
      "always": [{"type": "task", "to": {"type": "role", "roles": ["owner"]}, "title": "{{books.month_name}} is closed: send the reports"}]}');

  perform tests.as_super();
  update ledger.org_settings set books_locked_through = '2026-10-31' where org_id = org;
  update ledger.org_settings set books_locked_through = '2026-09-30' where org_id = org;  -- earlier: not a new close
  perform tests.as_super();
  perform tests.ok(public.run_workflows() = 1, 'one run for locking through a later date');
  perform tests.as_super();
  perform tests.ok(exists (select 1 from public.automation_tasks where title = 'October 2026 is closed: send the reports'), 'the month is named');

  -- The job queue the app works from.
  insert into public.automation_jobs (org_id, app, kind, payload) values (org, 'ledger', 'ledger.reports_to_meeting', '{"as_of": "today"}');
  perform tests.as_super();
  select * into r from public.claim_automation_jobs('ledger', 5);
  perform tests.ok(r.kind = 'ledger.reports_to_meeting' and r.status = 'running', 'the app claims its jobs');
  perform public.finish_automation_job(r.id, false, null, 'no meeting');
  perform tests.as_super();
  perform tests.ok((select status from public.automation_jobs where id = r.id) = 'queued', 'a failure is retried');
end
$$;
rollback;

-- S-19: skipping a recurring transaction from the hub (0005).
begin;
do $$
declare
  owner uuid := tests.create_user('owner@skip.l.org');
  outsider uuid := tests.create_user('out@skip.l.org');
  org uuid; t uuid := gen_random_uuid(); nxt date;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Skip Ledger');
  perform tests.as_super();
  insert into ledger.org_settings (org_id, currency) values (org, 'USD');
  insert into ledger.transaction_templates (id, org_id, name, description, frequency, next_due, active)
  values (t, org, 'Rent', 'Monthly rent', 'monthly', '2026-01-31', true);
  perform tests.as_user(owner);
  perform tests.ok((select completable from ledger.api_tasks where item_id = t), 'the task can be finished from the hub');
  nxt := ledger.skip_recurring_due(t);
  perform tests.ok(nxt = '2026-02-28', format('the next due date keeps the month''s end (got %s)', nxt));
  perform tests.as_super();
  perform tests.ok(exists (select 1 from ledger.recurring_occurrences where template_id = t and due_date = '2026-01-31' and status = 'skipped'),
    'the skipped date is recorded');
  perform tests.ok(exists (select 1 from ledger.audit_log where action = 'template.skipped' and org_id = org), 'and audited');
  perform tests.as_user(outsider);
  perform tests.throws(format('select ledger.skip_recurring_due(%L)', t), 'outsiders cannot', 'not found');
end
$$;
rollback;
