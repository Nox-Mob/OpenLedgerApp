-- Security review (2026-11-14): one read policy for transaction tags (advisor
-- multiple_permissive_policies). "Writers manage" was one policy for every action, which also made
-- it a second read policy; now writers add, change and remove, and reading stays with members.
drop policy if exists "Writers manage transaction tags" on ledger.transaction_tags;
drop policy if exists "Writers add transaction tags" on ledger.transaction_tags;
drop policy if exists "Writers change transaction tags" on ledger.transaction_tags;
drop policy if exists "Writers remove transaction tags" on ledger.transaction_tags;
create policy "Writers add transaction tags" on ledger.transaction_tags for insert to authenticated
  with check (exists (select 1 from ledger.transactions t
                      where t.id = transaction_tags.transaction_id and ledger.can_edit(t.org_id)));
create policy "Writers change transaction tags" on ledger.transaction_tags for update to authenticated
  using (exists (select 1 from ledger.transactions t
                 where t.id = transaction_tags.transaction_id and ledger.can_edit(t.org_id)))
  with check (exists (select 1 from ledger.transactions t
                      where t.id = transaction_tags.transaction_id and ledger.can_edit(t.org_id)));
create policy "Writers remove transaction tags" on ledger.transaction_tags for delete to authenticated
  using (exists (select 1 from ledger.transactions t
                 where t.id = transaction_tags.transaction_id and ledger.can_edit(t.org_id)));

select public._tune_schema('ledger');
