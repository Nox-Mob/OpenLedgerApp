-- Security review round 3: OpenLedgerApp keeps no service-role key when hosted (SHARED-SPEC
-- §7.2), but two features still used one for their history entry, so hosted they failed:
-- undoing a bank import (people may not delete bank rows themselves) and recording a backup
-- export. Each is now a database function that checks the person's permission itself.

-- Undo an import: only rows not yet in the books, the batch marked undone, and the history
-- entry, all at once. Returns how many rows were removed.
create or replace function ledger.undo_import_batch(p_org uuid, p_batch uuid)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n int;
begin
  if auth.uid() is null or not ledger.can_edit(p_org) then
    raise exception 'You can''t change these books.' using errcode = '42501';
  end if;
  if exists (select 1 from ledger.bank_transactions b
             where b.org_id = p_org and b.batch_id = p_batch and b.transaction_id is not null) then
    raise exception 'Some rows from this file are already in the ledger. Void those transactions first.'
      using errcode = '22023';
  end if;
  select count(*) into v_n from ledger.bank_transactions b
  where b.org_id = p_org and b.batch_id = p_batch and b.transaction_id is null;
  perform ledger.audited_write(p_org,
    jsonb_build_array(
      jsonb_build_object('table', 'bank_transactions', 'op', 'delete',
        'match', jsonb_build_object('batch_id', p_batch, 'transaction_id', null)),
      jsonb_build_object('table', 'import_batches', 'op', 'update',
        'values', jsonb_build_object('status', 'undone'),
        'match', jsonb_build_object('id', p_batch), 'min_rows', 1)),
    jsonb_build_object('id', gen_random_uuid(), 'action', 'undo_import', 'entity', 'import_batch',
      'entity_id', p_batch, 'after', jsonb_build_object('removed', v_n), 'kind', 'system'));
  return v_n;
end;
$$;

-- A backup was downloaded (owner and admins only): one history entry with the row counts.
create or replace function ledger.record_backup_export(p_org uuid, p_counts jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not ledger.is_admin(p_org) then
    raise exception 'Only the owner and admins download backups.' using errcode = '42501';
  end if;
  insert into ledger.audit_log (org_id, user_id, action, entity, entity_id, after, kind)
  values (p_org, auth.uid(), 'backup.exported', 'organization', p_org,
    case when jsonb_typeof(p_counts) = 'object' then p_counts else '{}'::jsonb end, 'system');
end;
$$;

revoke all on function ledger.undo_import_batch(uuid, uuid), ledger.record_backup_export(uuid, jsonb) from public, anon;
grant execute on function ledger.undo_import_batch(uuid, uuid), ledger.record_backup_export(uuid, jsonb) to authenticated, service_role;
select public._tune_schema('ledger');
