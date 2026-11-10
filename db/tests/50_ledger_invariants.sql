-- Ledger invariant checks. Runs as superuser inside one transaction that always rolls back.
-- Each check records PASS/FAIL; the final RAISE prints 'RESULT ...' and undoes everything.
-- A FAIL line names the rule that was not enforced by the database.
DO $$
DECLARE
  r text := '';
  org uuid := gen_random_uuid();
  usr uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  rev uuid := gen_random_uuid();
  tx uuid;
  ok boolean;
BEGIN
  -- Fresh CI databases: create a throwaway user. Restricted connections: reuse an existing creator.
  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (usr, 'ci-' || usr || '@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', '', '', '', '');
  EXCEPTION WHEN others THEN
    SELECT created_by INTO usr FROM public.organizations WHERE created_by IS NOT NULL LIMIT 1;
  END;
  INSERT INTO public.organizations (id, name, created_by) VALUES (org, 'CI Org', usr); INSERT INTO public.memberships (org_id, user_id, role) VALUES (org, usr, 'owner');
  INSERT INTO ledger.accounts (id, org_id, name, type) VALUES (cash, org, 'Cash', 'asset'), (rev, org, 'Sales', 'revenue');

  -- 1. Balanced transaction is accepted
  BEGIN
    tx := gen_random_uuid();
    INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx, org, '2026-01-05', 'ok', 'manual');
    INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx, cash, 1000), (tx, rev, -1000);
    SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
    r := r || 'balanced_accepted=PASS; ';
  EXCEPTION WHEN others THEN r := r || 'balanced_accepted=FAIL(' || SQLERRM || '); ';
  END;

  -- 2. Unbalanced transaction is rejected
  ok := false;
  BEGIN
    tx := gen_random_uuid();
    INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx, org, '2026-01-06', 'bad', 'manual');
    INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx, cash, 1000), (tx, rev, -900);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN others THEN ok := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  r := r || 'unbalanced_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 3. Single-entry transaction is rejected
  ok := false;
  BEGIN
    tx := gen_random_uuid();
    INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx, org, '2026-01-07', 'one', 'manual');
    INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx, cash, 0);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN others THEN ok := true;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  r := r || 'single_entry_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 4. Entries cannot be edited in place
  ok := false;
  BEGIN
    UPDATE ledger.entries SET amount_cents = 2000 WHERE account_id = cash;
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'entry_edit_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 5. Posted transaction description cannot be edited
  ok := false;
  BEGIN
    UPDATE ledger.transactions SET description = 'changed' WHERE org_id = org AND description = 'ok';
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'tx_edit_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 6. Posted transaction cannot be deleted
  ok := false;
  BEGIN
    DELETE FROM ledger.transactions WHERE org_id = org AND description = 'ok';
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'tx_delete_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 7. Voided transaction cannot be restored
  ok := false;
  BEGIN
    UPDATE ledger.transactions SET status = 'void' WHERE org_id = org AND description = 'ok';
    UPDATE ledger.transactions SET status = 'posted' WHERE org_id = org AND description = 'ok';
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'unvoid_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 8. Books lock blocks back-dated entries
  INSERT INTO ledger.org_settings (org_id, books_locked_through) VALUES (org, '2026-03-31') ON CONFLICT (org_id) DO UPDATE SET books_locked_through = excluded.books_locked_through;
  ok := false;
  BEGIN
    INSERT INTO ledger.transactions (org_id, transaction_date, description, source) VALUES (org, '2026-02-01', 'locked', 'manual');
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'books_lock_enforced=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';
  INSERT INTO ledger.org_settings (org_id, books_locked_through) VALUES (org, NULL) ON CONFLICT (org_id) DO UPDATE SET books_locked_through = excluded.books_locked_through;

  -- 9. Entries cannot reference another org's account
  ok := false;
  DECLARE org2 uuid := gen_random_uuid(); foreign_acct uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.organizations (id, name, created_by) VALUES (org2, 'Other', usr); INSERT INTO public.memberships (org_id, user_id, role) VALUES (org2, usr, 'owner');
    INSERT INTO ledger.accounts (id, org_id, name, type) VALUES (foreign_acct, org2, 'Cash', 'asset');
    BEGIN
      tx := gen_random_uuid();
      INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx, org, '2026-05-01', 'x', 'manual');
      INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx, foreign_acct, 100), (tx, rev, -100);
      SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN others THEN ok := true;
    END;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  r := r || 'cross_org_entry_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 10. The owner cannot be removed (core: transfer ownership first)
  ok := false;
  BEGIN
    DELETE FROM public.memberships WHERE org_id = org AND user_id = usr;
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'last_admin_kept=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  RAISE EXCEPTION 'RESULT %', r;
END $$;
