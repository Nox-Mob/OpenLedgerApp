-- Hosted OpenLedgerApp keeps no service-role key (0016): undoing an import and recording a
-- backup download are database functions that check the person's permission themselves.
begin;
do $$
declare
  owner uuid := tests.create_user('owner@undo.example.org');
  viewer uuid := tests.create_user('viewer@undo.example.org');
  outsider uuid := tests.create_user('outsider@undo.example.org');
  org uuid := gen_random_uuid();
  acct uuid;
  batch uuid := gen_random_uuid();
  posted_batch uuid := gen_random_uuid();
  tx uuid;
  n int;
begin
  insert into public.organizations (id, name, created_by) values (org, 'Undo Org', owner);
  insert into public.memberships (org_id, user_id, role) values (org, owner, 'owner'), (org, viewer, 'viewer');
  insert into ledger.org_settings (org_id) values (org);
  insert into ledger.accounts (org_id, name, type) values (org, 'Checking', 'asset') returning id into acct;
  insert into ledger.import_batches (id, org_id, account_id, file_name, format) values
    (batch, org, acct, 'march.csv', 'csv'), (posted_batch, org, acct, 'april.csv', 'csv');
  insert into ledger.bank_transactions (org_id, account_id, bank_date, description, amount_cents, fingerprint, batch_id) values
    (org, acct, '2026-03-01', 'Dues', 2500, 'f1', batch), (org, acct, '2026-03-02', 'Rent', -9000, 'f2', batch);
  select t.id into tx from ledger.transactions t where t.org_id = org limit 1;

  -- Not allowed: a viewer, and someone outside the organization.
  perform tests.as_user(viewer);
  perform tests.throws(format('select ledger.undo_import_batch(%L, %L)', org, batch), 'a viewer can''t undo an import', 'can''t change these books');
  perform tests.throws(format('select ledger.record_backup_export(%L, %L)', org, '{}'), 'nor record a backup download', 'Only the owner and admins');
  perform tests.as_user(outsider);
  perform tests.throws(format('select ledger.undo_import_batch(%L, %L)', org, batch), 'an outsider can''t', 'can''t change these books');

  -- The owner undoes it: rows gone, batch undone, one history entry.
  perform tests.as_user(owner);
  n := ledger.undo_import_batch(org, batch);
  perform tests.ok(n = 2, 'two rows removed');
  perform tests.as_super();
  perform tests.ok(not exists (select 1 from ledger.bank_transactions where batch_id = batch), 'the rows are gone');
  perform tests.ok((select status from ledger.import_batches where id = batch) = 'undone', 'the batch is marked undone');
  perform tests.ok((select count(*) from ledger.audit_log where org_id = org and action = 'undo_import' and user_id = owner) = 1,
    'one history entry, by the owner');

  -- A backup download is recorded.
  perform tests.as_user(owner);
  perform ledger.record_backup_export(org, '{"transactions": 3}');
  perform tests.as_super();
  perform tests.ok(exists (select 1 from ledger.audit_log where org_id = org and action = 'backup.exported' and user_id = owner),
    'the download is in history');
end $$;
rollback;
