-- Bank-evidence and opening-balance guard checks. Runs as superuser inside one transaction
-- that always rolls back. Each check records PASS/FAIL; the final RAISE prints 'RESULT ...'.
DO $$
DECLARE
  r text := '';
  org uuid := gen_random_uuid();
  usr uuid := gen_random_uuid();
  cash uuid := gen_random_uuid();
  rev uuid := gen_random_uuid();
  equity uuid := gen_random_uuid();
  tx uuid;
  tx2 uuid;
  brow uuid := gen_random_uuid();
  ok boolean;
  n int;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (usr, 'ci-' || usr || '@example.test', '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', '', '', '', '');
  EXCEPTION WHEN others THEN
    SELECT created_by INTO usr FROM public.organizations WHERE created_by IS NOT NULL LIMIT 1;
  END;
  INSERT INTO public.organizations (id, name, created_by) VALUES (org, 'CI Org', usr); INSERT INTO public.memberships (org_id, user_id, role) VALUES (org, usr, 'owner');
  INSERT INTO ledger.accounts (id, org_id, name, type) VALUES
    (cash, org, 'Cash', 'asset'), (rev, org, 'Sales', 'revenue'), (equity, org, 'Net Assets', 'equity');

  -- A posted transaction the bank row can link to ($10.00 into Cash)
  tx := gen_random_uuid();
  INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx, org, '2026-01-05', 'sale', 'manual');
  INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx, cash, 1000), (tx, rev, -1000);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO ledger.bank_transactions (id, org_id, account_id, bank_date, description, amount_cents, fingerprint)
  VALUES (brow, org, cash, '2026-01-05', 'STRIPE PAYOUT', 1000, 'fp-1');

  -- 1. Imported bank rows cannot be edited
  ok := false;
  BEGIN
    UPDATE ledger.bank_transactions SET description = 'changed' WHERE id = brow;
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'bank_edit_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 2. A bank row can only link to a posted transaction with a matching amount on the same account
  ok := false;
  BEGIN
    UPDATE ledger.bank_transactions SET transaction_id = tx, amount_cents = 1000 WHERE id = brow; -- amount matches, should succeed
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'bank_link_matching_allowed=' || CASE WHEN ok THEN 'FAIL' ELSE 'PASS' END || '; ';

  tx2 := gen_random_uuid();
  INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (tx2, org, '2026-01-06', 'other', 'manual');
  INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (tx2, cash, 2000), (tx2, rev, -2000);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;

  ok := false;
  DECLARE brow2 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO ledger.bank_transactions (id, org_id, account_id, bank_date, description, amount_cents, fingerprint)
    VALUES (brow2, org, cash, '2026-01-06', 'MISMATCH', 1000, 'fp-2');
    BEGIN
      UPDATE ledger.bank_transactions SET transaction_id = tx2 WHERE id = brow2; -- $10 row linking to $20 tx
    EXCEPTION WHEN others THEN ok := true;
    END;
  END;
  r := r || 'bank_link_mismatch_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 3. A bank row linked to a posted transaction cannot be deleted
  ok := false;
  BEGIN
    DELETE FROM ledger.bank_transactions WHERE id = brow;
  EXCEPTION WHEN others THEN ok := true;
  END;
  r := r || 'posted_bank_delete_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 4. An unlinked bank row CAN be deleted (the undo-import path)
  ok := false;
  BEGIN
    DELETE FROM ledger.bank_transactions WHERE org_id = org AND transaction_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    ok := n > 0;
  EXCEPTION WHEN others THEN ok := false;
  END;
  r := r || 'unposted_bank_delete_allowed=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 5. One opening balance per account: first succeeds, second is rejected
  ok := false;
  DECLARE ob1 uuid := gen_random_uuid(); ob2 uuid := gen_random_uuid();
  BEGIN
    INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (ob1, org, '2026-01-01', 'Opening', 'opening_balance');
    INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (ob1, cash, 5000), (ob1, equity, -5000);
    SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
    BEGIN
      INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (ob2, org, '2026-01-02', 'Opening 2', 'opening_balance');
      INSERT INTO ledger.entries (transaction_id, account_id, amount_cents) VALUES (ob2, cash, 7000), (ob2, equity, -7000);
      SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN others THEN ok := true;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END;
  r := r || 'second_opening_rejected=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  -- 6. After voiding the first opening balance, a new one is allowed
  ok := false;
  BEGIN
    UPDATE ledger.transactions SET status = 'void' WHERE org_id = org AND source = 'opening_balance' AND description = 'Opening';
    INSERT INTO ledger.transactions (id, org_id, transaction_date, description, source) VALUES (gen_random_uuid(), org, '2026-01-03', 'Opening 3', 'opening_balance');
    INSERT INTO ledger.entries (transaction_id, account_id, amount_cents)
      SELECT t.id, cash, 8000 FROM ledger.transactions t WHERE t.description = 'Opening 3'
      UNION ALL SELECT t.id, equity, -8000 FROM ledger.transactions t WHERE t.description = 'Opening 3';
    SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
    ok := true;
  EXCEPTION WHEN others THEN ok := false; SET CONSTRAINTS ALL DEFERRED;
  END;
  r := r || 'opening_after_void_allowed=' || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || '; ';

  RAISE EXCEPTION 'RESULT %', r;
END $$;
