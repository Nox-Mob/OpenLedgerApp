-- H-09 (core 0011, Ledger 0008): Ledger decides from the Ledger role; named roles can grant
-- Ledger's permissions; invitations carry the Ledger role.
begin;
do $$
declare
  owner uuid := tests.create_user('owner@nrl.org');
  hubadmin uuid := tests.create_user('hubadmin@nrl.org');
  closer uuid := tests.create_user('closer@nrl.org');
  newbie uuid := tests.create_user('newbie@nrl.org');
  org uuid; r uuid; inv record;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Named Roles Books');
  perform tests.add_hub_member(org, hubadmin, 'admin');
  perform tests.add_hub_member(org, closer, 'member');
  perform tests.ok((select count(*) from public.app_permission_types where app = 'ledger') = 2, 'Ledger offers two permissions');

  perform tests.as_user(hubadmin);
  perform tests.ok(not ledger.is_admin(org), 'an OpenAppHub admin alone is not a Ledger admin');
  perform tests.ok(not ledger.can_edit(org), 'and can''t write in Ledger');

  perform tests.as_user(owner);
  r := public.save_named_role(org, null, 'Bookkeeper', '', '{"ledger":"member"}', '{"ledger":["ledger.close_books"]}');
  perform public.set_named_role(org, closer, r);
  perform tests.as_user(closer);
  perform tests.ok(ledger.can_edit(org), 'a member in Ledger by the named role writes');
  perform tests.ok(ledger.can_close_books(org), 'and closes books through the permission');
  perform tests.ok(not ledger.is_admin(org), 'but is not a Ledger admin');

  -- An invitation from Ledger: an OpenAppHub member who is a treasurer in Ledger.
  perform tests.as_user(owner);
  select * into inv from public.create_invitation(org, 'newbie@nrl.org', 'member', 'ledger', '{"ledger_role":"treasurer"}');
  perform public.set_invitation_roles(inv.invitation_id, null, '{"ledger":"member"}');
  perform tests.as_user(newbie);
  perform public.accept_invitation(inv.token);
  perform ledger.on_invitation_accepted(inv.invitation_id);
  perform tests.ok(public.app_role(org, 'ledger') = 'member', 'member in Ledger');
  perform tests.ok(ledger.is_treasurer(org), 'and the treasurer');
  perform tests.ok(public.app_role(org, 'board') = 'viewer', 'viewer elsewhere');
end $$;
rollback;
\echo ok
