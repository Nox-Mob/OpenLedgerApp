-- Restore a backup into the organization you're in, all at once (owner request 2026-11-14).
--
-- Before, a restore made a brand-new organization and needed the service-role key for its
-- history entries and for cleaning up when something failed. Hosted OpenLedgerApp has no such
-- key (SHARED-SPEC §7.2), and a new organization made outside OpenAppHub has no plan. Now the
-- owner or an admin restores into the current organization while its books are still empty
-- (no accounts or transactions yet). Everything is written in one step: if anything fails,
-- nothing is kept. The server still checks the file and gives every row a new id first.

-- Inserts the listed columns of a table from backup rows. Columns not listed take the table's
-- defaults; `p_set` overrides values on every row (the organization, who did it).
create or replace function ledger._restore_insert(p_table text, p_cols text[], p_rows jsonb, p_set jsonb)
returns int language plpgsql volatile set search_path = '' as $$
declare
  v_rows jsonb;
  v_cols text;
  v_n int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  select jsonb_agg(jsonb_build_object('created_at', now()) || jsonb_strip_nulls(r) || coalesce(p_set, '{}'::jsonb))
    into v_rows from jsonb_array_elements(p_rows) r;
  select string_agg(quote_ident(c), ', ') into v_cols
  from unnest(p_cols || array(select jsonb_object_keys(coalesce(p_set, '{}'::jsonb)))) c;
  execute format('insert into ledger.%I (%s) select %s from jsonb_populate_recordset(null::ledger.%I, $1)',
    p_table, v_cols, v_cols, p_table) using v_rows;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function ledger.restore_into(p_org uuid, p_tables jsonb, p_meta jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_org jsonb := coalesce(p_tables -> 'organization', '{}'::jsonb);
  v_set jsonb := jsonb_build_object('org_id', p_org);
  v_by jsonb := jsonb_build_object('org_id', p_org, 'created_by', v_uid);
  r jsonb;
  v_counts jsonb := '{}'::jsonb;
begin
  if v_uid is null or not ledger.is_admin(p_org) then
    raise exception 'Only the owner and admins restore a backup.' using errcode = '42501';
  end if;
  if not ledger.can_edit(p_org) then
    raise exception 'These books are read-only right now, so a backup can''t be restored into them.' using errcode = '42501';
  end if;
  if exists (select 1 from ledger.transactions t where t.org_id = p_org)
     or exists (select 1 from ledger.accounts a where a.org_id = p_org) then
    raise exception 'This organization already has accounts or transactions. Restore into an organization whose books are empty: make a new one in OpenAppHub, open it in OpenLedgerApp and restore before setting anything up.'
      using errcode = '22023';
  end if;
  if exists (select 1 from ledger.audit_log h where h.org_id = p_org and h.action = 'backup.restored') then
    raise exception 'A backup was already restored into this organization.' using errcode = '22023';
  end if;

  -- Settings (the row may already exist).
  insert into ledger.org_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  update ledger.org_settings o set
    org_type = coalesce(s.org_type, o.org_type),
    currency = coalesce(s.currency, o.currency),
    fiscal_year_start_month = coalesce(s.fiscal_year_start_month, o.fiscal_year_start_month),
    terminology = coalesce(s.terminology, o.terminology),
    term_overrides = coalesce(s.term_overrides, o.term_overrides),
    timezone = coalesce(s.timezone, o.timezone),
    ai_pdf_enabled = coalesce(s.ai_pdf_enabled, o.ai_pdf_enabled)
  from jsonb_populate_record(null::ledger.org_settings, v_org) s
  where o.org_id = p_org;

  -- Accounts start active (archived ones are archived at the end).
  v_counts := v_counts || jsonb_build_object('accounts', ledger._restore_insert('accounts',
    array['id', 'name', 'type', 'subtype', 'created_at'], p_tables -> 'accounts',
    v_set || '{"is_active": true}'::jsonb));
  perform ledger._restore_insert('categories', array['id', 'name', 'type', 'created_at'], p_tables -> 'categories', v_set);
  perform ledger._restore_insert('tags', array['id', 'name', 'type', 'created_at'], p_tables -> 'tags', v_set);
  perform ledger._restore_insert('projects', array['id', 'name', 'budget_cents', 'status', 'created_at'], p_tables -> 'projects', v_set);
  perform ledger._restore_insert('funds', array['id', 'name', 'is_restricted', 'created_at'], p_tables -> 'funds', v_set);
  v_counts := v_counts || jsonb_build_object('transactions', ledger._restore_insert('transactions',
    array['id', 'transaction_date', 'posted_date', 'description', 'source', 'status', 'idempotency_key', 'created_at'],
    p_tables -> 'transactions', v_by));
  perform ledger._restore_insert('entries',
    array['id', 'transaction_id', 'account_id', 'amount_cents', 'category_id', 'project_id', 'fund_id', 'memo', 'created_at'],
    p_tables -> 'entries', '{}'::jsonb);
  perform ledger._restore_insert('transaction_tags', array['transaction_id', 'tag_id'], p_tables -> 'transaction_tags', '{}'::jsonb);
  perform ledger._restore_insert('import_batches',
    array['id', 'account_id', 'file_name', 'format', 'statement_start', 'statement_end', 'beginning_balance_cents',
          'ending_balance_cents', 'rows_total', 'rows_imported', 'rows_duplicate', 'rows_error', 'status',
          'balance_mismatch_cents', 'created_at'],
    p_tables -> 'import_batches', v_by);
  perform ledger._restore_insert('import_profiles', array['id', 'account_id', 'name', 'mapping', 'created_at'], p_tables -> 'import_profiles', v_set);
  perform ledger._restore_insert('bank_transactions',
    array['id', 'account_id', 'bank_date', 'description', 'amount_cents', 'external_id', 'fingerprint', 'transaction_id',
          'raw', 'batch_id', 'needs_review', 'row_seq', 'created_at'],
    p_tables -> 'bank_transactions', v_set);

  -- Statement checks, oldest first: open, tick their lines, then finish (the database re-checks
  -- that the difference is zero).
  for r in select value from jsonb_array_elements(coalesce(p_tables -> 'reconciliations', '[]'::jsonb))
           order by value ->> 'created_at' nulls first loop
    perform ledger._restore_insert('reconciliations',
      array['id', 'account_id', 'period_start', 'period_end', 'beginning_balance_cents', 'ending_balance_cents', 'mode',
            'batch_id', 'created_at'],
      jsonb_build_array(r), v_by || '{"status": "in_progress"}'::jsonb);
    update ledger.entries e set reconciliation_id = (r ->> 'id')::uuid
    where e.id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_tables -> 'entries', '[]'::jsonb)) x
                   where x ->> 'reconciliation_id' = r ->> 'id');
    if r ->> 'status' = 'completed' then
      update ledger.reconciliations set status = 'completed', completed_by = v_uid,
        completed_at = coalesce((r ->> 'completed_at')::timestamptz, now())
      where id = (r ->> 'id')::uuid;
    end if;
  end loop;

  perform ledger._restore_insert('period_closes', array['id', 'fiscal_year_end', 'transaction_id', 'net_income_cents', 'created_at'],
    p_tables -> 'period_closes', v_set || jsonb_build_object('closed_by', v_uid));
  perform ledger._restore_insert('pledges',
    array['id', 'donor_name', 'fund_id', 'amount_cents', 'pledge_date', 'expected_date', 'note', 'status', 'transaction_id', 'created_at'],
    p_tables -> 'pledges', v_by);
  perform ledger._restore_insert('pledge_payments',
    array['id', 'pledge_id', 'transaction_id', 'kind', 'amount_cents', 'paid_date', 'created_at'], p_tables -> 'pledge_payments', v_set);
  perform ledger._restore_insert('budgets', array['id', 'account_id', 'period_type', 'period_start', 'amount_cents', 'created_at'],
    p_tables -> 'budgets', v_set);

  -- Archive accounts and lock the books last, so earlier writes weren't blocked.
  update ledger.accounts a set is_active = false
  where a.org_id = p_org and a.id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_tables -> 'accounts', '[]'::jsonb)) x
                                      where (x ->> 'is_active')::boolean is false);
  if nullif(v_org ->> 'books_locked_through', '') is not null then
    update ledger.org_settings set books_locked_through = (v_org ->> 'books_locked_through')::date where org_id = p_org;
  end if;

  -- History: the original entries, read-only and marked "restored", then one restore entry.
  insert into ledger.audit_log (org_id, user_id, action, entity, entity_id, before, after, created_at, kind)
  select p_org, null, 'restored.' || (h ->> 'action'), coalesce(h ->> 'entity', 'unknown'), null,
         nullif(h -> 'before', 'null'::jsonb),
         jsonb_build_object('original', h -> 'after', 'original_user', h -> 'user_id', 'original_entity_id', h -> 'entity_id'),
         coalesce((h ->> 'created_at')::timestamptz, now()), 'system'
  from jsonb_array_elements(coalesce(p_tables -> 'audit_log', '[]'::jsonb)) h;
  insert into ledger.audit_log (org_id, user_id, action, entity, entity_id, after, kind)
  values (p_org, v_uid, 'backup.restored', 'organization', p_org, coalesce(p_meta, '{}'::jsonb), 'system');
  return v_counts;
end;
$$;

revoke all on function ledger._restore_insert(text, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function ledger.restore_into(uuid, jsonb, jsonb) from public, anon;
grant execute on function ledger.restore_into(uuid, jsonb, jsonb) to authenticated, service_role;
select public._tune_schema('ledger');
