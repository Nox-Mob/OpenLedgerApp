-- Tenant isolation check: acts as a signed-in stranger (member of no org) and tries to
-- read / change / delete every org table. Raises 'RESULT ...'; every count must be 0 and
-- every insert "blocked". The raise rolls everything back.
DO $$
DECLARE r text := ''; n int; t text; victim_org uuid := gen_random_uuid(); owner uuid := gen_random_uuid();
BEGIN
  -- Make sure there is at least one organization to attack, even on an empty CI database.
  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (owner, 'victim-' || owner || '@example.test', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', '', '', '', '');
    INSERT INTO auth.users (id, email, instance_id, aud, role, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES ('11111111-1111-1111-1111-111111111111', 'stranger@example.test', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', '', '', '', '')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.organizations (id, name, created_by) VALUES (victim_org, 'Victim Org', owner); INSERT INTO public.memberships (org_id, user_id, role) VALUES (victim_org, owner, 'owner');
    INSERT INTO ledger.org_settings (org_id) VALUES (victim_org);
    INSERT INTO ledger.accounts (org_id, name, type) VALUES (victim_org, 'Victim cash', 'asset');
  EXCEPTION WHEN others THEN
    SELECT id INTO victim_org FROM public.organizations LIMIT 1;
  END;
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  FOREACH t IN ARRAY ARRAY['public.organizations','public.memberships','ledger.org_settings','ledger.member_roles',
    'ledger.accounts','ledger.transactions','ledger.entries','ledger.bank_transactions','ledger.reconciliations','ledger.audit_log',
    'ledger.import_batches','ledger.import_profiles','ledger.categories','ledger.tags','ledger.projects','ledger.funds',
    'ledger.transaction_tags','ledger.budgets','ledger.pledges','ledger.pledge_payments','ledger.period_closes',
    'ledger.transaction_templates','ledger.recurring_occurrences','ledger.ai_usage'] LOOP
    EXECUTE format('SELECT count(*) FROM %s', t) INTO n; r := r || t || ' read=' || n || '; ';
  END LOOP;
  UPDATE ledger.transactions SET status='void'; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'void=' || n || '; ';
  DELETE FROM ledger.entries; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'del_entries=' || n || '; ';
  BEGIN DELETE FROM ledger.bank_transactions; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'del_bank=' || n || '; ';
    EXCEPTION WHEN others THEN r := r || 'del_bank=blocked; '; END;
  UPDATE ledger.reconciliations SET status='in_progress'; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'upd_rec=' || n || '; ';
  UPDATE public.memberships SET role='admin'; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'upd_roles=' || n || '; ';
  UPDATE ledger.org_settings SET require_mfa = false; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'upd_settings=' || n || '; ';
  -- Stranger tries to make themselves admin of the victim org. Must raise; zero rows counts as a FAIL
  -- only if a target existed, so a missing target is reported as no_target rather than passing silently.
  IF victim_org IS NULL THEN r := r || 'self_join=no_target; ';
  ELSE
    BEGIN
      INSERT INTO ledger.member_roles(user_id, org_id, role) VALUES ('11111111-1111-1111-1111-111111111111', victim_org, 'treasurer');
      r := r || 'self_join=ALLOWED; ';
    EXCEPTION WHEN others THEN r := r || 'self_join=blocked; ';
    END;
  END IF;
  BEGIN DELETE FROM ledger.audit_log; r := r || 'audit_delete=no_error; ';
  EXCEPTION WHEN others THEN r := r || 'audit_delete=blocked; '; END;
  RAISE EXCEPTION 'RESULT %', r;
END $$;
