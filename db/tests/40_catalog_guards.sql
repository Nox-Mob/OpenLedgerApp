-- Account catalog guards: unique names per organization and delete-only-if-unused.
-- Runs inside a DO block that always ends in RAISE, so every change is rolled back.
DO $$
DECLARE
  r text := '';
  usr uuid;
  org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  income uuid := gen_random_uuid();
  spare uuid := gen_random_uuid();
  tx uuid := gen_random_uuid();
  n int;
BEGIN
  BEGIN
    usr := '11111111-1111-1111-1111-111111111111';
    INSERT INTO auth.users (id, email, instance_id, aud, role, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (usr, 'ci-' || usr || '@example.test', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', '', '', '', '');
  EXCEPTION WHEN others THEN
    SELECT id INTO usr FROM auth.users LIMIT 1;
  END;
  INSERT INTO public.organizations (id, name, created_by) VALUES (org, 'CI Catalog', usr); INSERT INTO public.memberships (org_id, user_id, role) VALUES (org, usr, 'owner');
  INSERT INTO public.organizations (id, name, created_by) VALUES (other_org, 'CI Other', usr); INSERT INTO public.memberships (org_id, user_id, role) VALUES (other_org, usr, 'owner');
  INSERT INTO ledger.accounts (id, org_id, name, type) VALUES
    (cash, org, 'Main Checking', 'asset'),
    (income, org, 'Donations', 'revenue'),
    (spare, org, 'Spare Account', 'asset');

  -- 1. Same name, different case and spacing, is refused.
  BEGIN
    INSERT INTO ledger.accounts (id, org_id, name, type)
      VALUES (gen_random_uuid(), org, '  main   CHECKING ', 'asset');
    r := r || 'duplicate_account=FAIL; ';
  EXCEPTION WHEN unique_violation THEN r := r || 'duplicate_account=PASS; ';
  END;

  -- 2. The same name in another organization is fine.
  BEGIN
    INSERT INTO ledger.accounts (id, org_id, name, type)
      VALUES (gen_random_uuid(), other_org, 'Main Checking', 'asset');
    r := r || 'other_org_same_name=PASS; ';
  EXCEPTION WHEN others THEN r := r || 'other_org_same_name=FAIL; ';
  END;

  -- 3. Renaming onto an existing name is refused.
  BEGIN
    UPDATE ledger.accounts SET name = 'donations' WHERE id = spare;
    r := r || 'rename_duplicate=FAIL; ';
  EXCEPTION WHEN unique_violation THEN r := r || 'rename_duplicate=PASS; ';
  END;

  -- 4. Funds follow the same rule.
  INSERT INTO ledger.funds (id, org_id, name) VALUES (gen_random_uuid(), org, 'Building');
  BEGIN
    INSERT INTO ledger.funds (id, org_id, name) VALUES (gen_random_uuid(), org, 'BUILDING');
    r := r || 'duplicate_fund=FAIL; ';
  EXCEPTION WHEN unique_violation THEN r := r || 'duplicate_fund=PASS; ';
  END;

  -- 5. An account with transaction lines can't be deleted.
  INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source, status, created_by)
    VALUES (tx, org, '2026-01-05', 'Gift', 'manual', 'posted', usr);
  INSERT INTO ledger.entries (id, transaction_id, account_id, amount_cents) VALUES
    (gen_random_uuid(), tx, cash, 1000),
    (gen_random_uuid(), tx, income, -1000);
  BEGIN
    DELETE FROM ledger.accounts WHERE id = cash;
    r := r || 'used_account_delete=FAIL; ';
  EXCEPTION WHEN check_violation THEN r := r || 'used_account_delete=PASS; ';
  END;

  -- 6. A never-used account can be deleted.
  DELETE FROM ledger.accounts WHERE id = spare;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || 'unused_account_delete=' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 7. Deleting the whole organization still works (the guard steps aside).
  BEGIN
    DELETE FROM public.organizations WHERE id = org;  -- cascades into ledger.*
    SELECT count(*) INTO n FROM ledger.accounts WHERE org_id = org;
    r := r || 'org_delete_still_works=' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || '; ';
  EXCEPTION WHEN others THEN r := r || 'org_delete_still_works=FAIL; ';
  END;

  RAISE EXCEPTION 'RESULT %', r;
END $$;
