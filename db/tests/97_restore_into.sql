-- Restore into the current organization (0017): owner or admin, empty books only, all at once.
begin;
-- A request's checks run when it commits; this runs them straight away, as a commit would.
create or replace function pg_temp.restore_now(p_org uuid, p_tables jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  v := ledger.restore_into(p_org, p_tables, '{}'::jsonb);
  set constraints all immediate;
  return v;
end $f$;
do $$
declare
  owner uuid := tests.create_user('owner@restore.example.org');
  member uuid := tests.create_user('member@restore.example.org');
  org uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  dues uuid := gen_random_uuid();
  tx uuid := gen_random_uuid();
  good jsonb;
  bad jsonb;
  counts jsonb;
begin
  insert into public.organizations (id, name, created_by) values (org, 'Restore Org', owner);
  insert into public.memberships (org_id, user_id, role) values (org, owner, 'owner'), (org, member, 'member');
  good := jsonb_build_object(
    'organization', jsonb_build_object('currency', 'USD', 'books_locked_through', null),
    'accounts', jsonb_build_array(
      jsonb_build_object('id', cash, 'name', 'Checking', 'type', 'asset', 'is_active', true),
      jsonb_build_object('id', dues, 'name', 'Dues', 'type', 'revenue', 'is_active', false)),
    'transactions', jsonb_build_array(jsonb_build_object('id', tx, 'transaction_date', '2026-01-05',
      'description', 'Dues paid', 'status', 'posted', 'source', 'manual')),
    'entries', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'transaction_id', tx, 'account_id', cash, 'amount_cents', 2500),
      jsonb_build_object('id', gen_random_uuid(), 'transaction_id', tx, 'account_id', dues, 'amount_cents', -2500)),
    'audit_log', jsonb_build_array(jsonb_build_object('action', 'created', 'entity', 'transaction',
      'user_id', gen_random_uuid(), 'after', '{"x":1}'::jsonb, 'created_at', '2026-01-05T10:00:00Z')));

  -- A member can't restore.
  perform tests.as_user(member);
  perform tests.throws(format('select ledger.restore_into(%L, %L, %L)', org, good, '{}'), 'a member can''t restore', 'Only the owner and admins');

  -- A broken backup (unbalanced) keeps nothing: it all happens in one step.
  bad := jsonb_set(good, '{entries,1,amount_cents}', '-2000');
  perform tests.as_user(owner);
  perform tests.throws(format('select pg_temp.restore_now(%L, %L)', org, bad), 'an unbalanced backup is refused', null);
  perform tests.as_super();
  perform tests.ok(not exists (select 1 from ledger.accounts where org_id = org)
    and not exists (select 1 from ledger.transactions where org_id = org)
    and not exists (select 1 from ledger.audit_log where org_id = org), 'and nothing was kept');

  -- The owner restores into the empty books.
  perform tests.as_user(owner);
  counts := ledger.restore_into(org, good, '{"original_name":"Old Org"}');
  perform tests.ok((counts ->> 'transactions')::int = 1 and (counts ->> 'accounts')::int = 2, 'restored');
  perform tests.as_super();
  perform tests.ok((select count(*) from ledger.entries e join ledger.transactions t on t.id = e.transaction_id where t.org_id = org) = 2, 'with its entries');
  perform tests.ok(not (select is_active from ledger.accounts where id = dues), 'archived accounts stay archived');
  perform tests.ok((select created_by from ledger.transactions where id = tx) = owner, 'recorded as the person who restored');
  perform tests.ok(exists (select 1 from ledger.audit_log where org_id = org and action = 'restored.created' and user_id is null),
    'old history is kept, marked restored');
  perform tests.ok(exists (select 1 from ledger.audit_log where org_id = org and action = 'backup.restored' and user_id = owner),
    'and the restore is in history');

  -- Books that aren't empty are never touched.
  perform tests.as_user(owner);
  perform tests.throws(format('select ledger.restore_into(%L, %L, %L)', org, good, '{}'), 'not into books that have entries', 'already has accounts');
end $$;
rollback;
