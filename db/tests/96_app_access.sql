-- No access in OpenLedgerApp (0010, core 0015): no books, settings or roles; the other apps unchanged.
begin;
do $$
declare
  owner uuid := tests.create_user('owner@noaccess.org');
  bob uuid := tests.create_user('bob@noaccess.org');
  org uuid;
begin
  perform tests.as_user(owner);
  org := public.create_organization('No Access Books');
  perform tests.add_hub_member(org, bob, 'member');
  perform public.set_app_role(org, bob, 'ledger', 'member');
  perform tests.as_super();
  insert into ledger.accounts (org_id, name, type) values (org, 'Cash', 'asset');
  perform tests.as_user(owner);
  perform tests.as_user(bob);
  perform tests.ok(ledger.can_read(org), 'a Ledger member reads the books');
  perform tests.ok(tests.count(format('select 1 from ledger.accounts where org_id = %L', org)) > 0, 'and sees the accounts');
  perform tests.as_user(owner);
  perform public.set_app_access(org, bob, 'ledger', true);
  perform tests.as_user(bob);
  perform tests.ok(not ledger.can_read(org), 'No access: can''t read');
  perform tests.ok(not ledger.can_edit(org), 'or write');
  perform tests.ok(tests.count(format('select 1 from ledger.accounts where org_id = %L', org)) = 0, 'no accounts');
  perform tests.ok(tests.count(format('select 1 from ledger.org_settings where org_id = %L', org)) = 0, 'no settings');
  perform tests.ok(tests.count(format('select 1 from ledger.member_roles where org_id = %L', org)) = 0, 'no Ledger roles');
  perform tests.ok(not exists (select 1 from public.my_app_memberships('ledger') where org_id = org), 'the organization isn''t listed in Ledger');
  perform tests.ok(public.is_member(org), 'still in the organization');
  perform tests.as_user(owner);
  perform tests.ok(ledger.can_read(org), 'the owner always has access');
end $$;
rollback;
