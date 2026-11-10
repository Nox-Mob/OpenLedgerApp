-- Ledger on top of core (replaces the old treasurer_role and member_lifecycle
-- files, whose user_roles, org_invites and delete_organization_atomic are now
-- core): core roles + the treasurer overlay, settings, two-step sign-in, the
-- read-only rule, invitations, and organization deletion.
begin;
do $$
declare
  owner uuid := tests.create_user('owner@l.org', '{"full_name":"Olive Owner"}');
  admin uuid := tests.create_user('admin@l.org');
  treas uuid := tests.create_user('treas@l.org');
  mem uuid := tests.create_user('mem@l.org');
  viewer uuid := tests.create_user('viewer@l.org');
  joiner uuid := tests.create_user('joiner@l.org');
  org uuid; acct uuid; rec uuid; rec2 uuid; tok text; inv uuid; n int;
begin
  perform tests.as_user(owner);
  org := public.create_organization('Ledger Org');
  perform tests.add_member(org, admin, 'admin');
  perform tests.add_member(org, treas, 'member');
  perform tests.add_member(org, mem, 'member');
  perform tests.add_member(org, viewer, 'viewer');

  -- Settings: a missing row means defaults; admins create and change them.
  perform tests.as_user(mem);
  perform tests.ok(ledger.can_read(org) and ledger.can_edit(org), 'a member reads and writes the books');
  perform tests.ok(not ledger.is_admin(org) and not ledger.can_close_books(org), 'a member is not admin and cannot close books');
  perform tests.throws(format('insert into ledger.org_settings (org_id, currency) values (%L, %L)', org, 'CAD'),
    'a member cannot create settings', null);
  perform tests.as_user(admin);
  insert into ledger.org_settings (org_id, currency, fiscal_year_start_month) values (org, 'CAD', 7);
  perform tests.ok((select currency from ledger.org_settings where org_id = org) = 'CAD', 'an admin saves settings');
  perform tests.throws(format('update ledger.org_settings set currency = %L where org_id = %L', 'JPY', org),
    'unsupported currencies are refused', 'not supported');

  -- The treasurer overlay: admins grant it; it needs a core member role.
  insert into ledger.member_roles (org_id, user_id, role) values (org, treas, 'treasurer');
  perform tests.throws(format('insert into ledger.member_roles (org_id, user_id, role) values (%L, %L, %L)', org, viewer, 'treasurer'),
    'a viewer cannot be treasurer', 'not a viewer');
  perform tests.as_user(mem);
  perform tests.throws(format('insert into ledger.member_roles (org_id, user_id, role) values (%L, %L, %L)', org, mem, 'treasurer'),
    'a member cannot make themselves treasurer', 'row-level security');

  insert into ledger.accounts (org_id, name, type) values (org, 'Cash', 'asset') returning id into acct;
  perform tests.as_super();
  insert into ledger.reconciliations (id, org_id, account_id, period_start, period_end, mode, status)
  values (gen_random_uuid(), org, acct, '2026-01-01', '2026-01-31', 'simple', 'completed') returning id into rec;
  insert into ledger.reconciliations (id, org_id, account_id, period_start, period_end, mode, status)
  values (gen_random_uuid(), org, acct, '2026-02-01', '2026-02-28', 'simple', 'completed') returning id into rec2;

  -- Treasurer: writes, locks books, closes the year, reopens a statement check;
  -- can't change other settings or roles.
  perform tests.as_user(treas);
  perform tests.ok(ledger.can_edit(org) and ledger.can_close_books(org), 'the treasurer writes and closes books');
  update ledger.org_settings set books_locked_through = '2026-03-31' where org_id = org;
  perform tests.ok((select books_locked_through from ledger.org_settings where org_id = org) = '2026-03-31', 'the treasurer locks the books');
  perform tests.throws(format('update ledger.org_settings set fiscal_year_start_month = 1 where org_id = %L', org),
    'the treasurer cannot change other settings', 'Only organization admins');
  insert into ledger.period_closes (org_id, fiscal_year_end, net_income_cents, closed_by) values (org, '2025-12-31', 0, treas);
  update ledger.reconciliations set status = 'in_progress' where id = rec;
  perform tests.ok((select status from ledger.reconciliations where id = rec) = 'in_progress', 'the treasurer reopens a statement check');
  delete from ledger.member_roles where org_id = org and user_id = treas;
  perform tests.ok(exists (select 1 from ledger.member_roles where org_id = org and user_id = treas), 'the treasurer cannot remove roles');
  update public.memberships set role = 'admin' where org_id = org and user_id = treas;
  perform tests.ok(not public.has_role(org, '{admin}'), 'the treasurer cannot promote themselves');

  -- A plain member: no books lock, no year close, no reopening.
  perform tests.as_user(mem);
  update ledger.org_settings set books_locked_through = '2026-06-30' where org_id = org;
  perform tests.ok((select books_locked_through from ledger.org_settings where org_id = org) = '2026-03-31', 'a member cannot lock the books');
  perform tests.throws(format('insert into ledger.period_closes (org_id, fiscal_year_end, net_income_cents, closed_by) values (%L, %L, 0, %L)', org, '2024-12-31', mem),
    'a member cannot close a year', 'row-level security');
  perform tests.throws(format('update ledger.reconciliations set status = %L where id = %L', 'in_progress', rec2),
    'a member cannot reopen a completed statement check', 'admins and treasurers');

  -- A viewer reads but never writes.
  perform tests.as_user(viewer);
  perform tests.ok(tests.count(format('select * from ledger.accounts where org_id = %L', org)) = 1, 'a viewer reads the books');
  perform tests.throws(format('insert into ledger.accounts (org_id, name, type) values (%L, %L, %L)', org, 'Viewer acct', 'asset'),
    'a viewer cannot write', 'row-level security');

  -- A treasurer demoted to viewer loses the overlay's rights.
  perform tests.as_super();
  update public.memberships set role = 'viewer' where org_id = org and user_id = treas;
  perform tests.as_user(treas);
  perform tests.ok(not ledger.can_close_books(org) and not ledger.is_treasurer(org), 'a demoted treasurer cannot close books');
  perform tests.as_super();
  update public.memberships set role = 'member' where org_id = org and user_id = treas;

  -- Two-step sign-in: with require_mfa, the books hide at aal1 and show at aal2;
  -- the org and its settings stay readable so the app can explain why.
  perform tests.as_user(owner);
  update ledger.org_settings set require_mfa = true where org_id = org;
  perform tests.as_user(mem);
  perform tests.ok(tests.count(format('select * from ledger.accounts where org_id = %L', org)) = 0, 'aal1: books hidden');
  perform tests.ok(tests.count(format('select * from public.organizations where id = %L', org)) = 1, 'aal1: the org is still visible');
  perform tests.ok(tests.count(format('select * from ledger.org_settings where org_id = %L', org)) = 1, 'aal1: settings readable (to explain)');
  perform tests.throws(format('insert into ledger.accounts (org_id, name, type) values (%L, %L, %L)', org, 'X', 'asset'), 'aal1: no writes', 'row-level security');
  perform set_config('request.jwt.claims', json_build_object('sub', mem, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform tests.ok(tests.count(format('select * from ledger.accounts where org_id = %L', org)) = 1, 'aal2: books visible');
  perform tests.as_user(owner);
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update ledger.org_settings set require_mfa = false where org_id = org;

  -- Read-only when the plan lapses: everyone reads, nobody writes or closes.
  perform tests.lapse(org);
  perform tests.as_user(owner);
  perform tests.ok(ledger.can_read(org) and not ledger.can_edit(org) and not ledger.is_admin(org), 'read-only: the owner reads but cannot write');
  perform tests.throws(format('insert into ledger.accounts (org_id, name, type) values (%L, %L, %L)', org, 'Lapsed', 'asset'), 'read-only: no new accounts', 'row-level security');
  perform tests.as_user(treas);
  perform tests.ok(not ledger.can_close_books(org), 'read-only: the treasurer cannot close books');
  perform tests.as_super();
  update public.instance_settings set billing_enabled = false;

  -- Invitations: an invitation carrying the treasurer role applies the overlay.
  perform tests.as_user(owner);
  select invitation_id, token into inv, tok from public.create_invitation(org, 'joiner@l.org', 'member', 'ledger', '{"ledger_role":"treasurer"}'::jsonb, 14);
  perform tests.as_user(joiner);
  perform public.accept_invitation(tok);
  perform ledger.on_invitation_accepted(inv);
  perform tests.ok(ledger.is_treasurer(org), 'the invitation made the joiner treasurer');
  perform tests.as_user(mem);
  perform tests.throws(format('select ledger.on_invitation_accepted(%L)', inv), 'only the person who accepted can apply it', 'not found');

  -- Organization deletion (self-hosted): only the owner logs it; core deletes
  -- everything, posted books included; the log stays.
  perform tests.as_user(admin);
  perform tests.throws(format('select ledger.log_org_deletion(%L)', org), 'only the owner logs a deletion', 'Only the owner');
  perform tests.as_user(owner);
  perform ledger.log_org_deletion(org);
  perform public.delete_organization(org, 'Ledger Org');
  perform tests.as_super();
  perform tests.ok(not exists (select 1 from ledger.accounts where org_id = org)
               and not exists (select 1 from ledger.member_roles where org_id = org)
               and not exists (select 1 from ledger.org_settings where org_id = org), 'deletion removes the books and settings');
  perform tests.ok((select count(*) from ledger.deleted_organizations where org_id = org and name = 'Ledger Org') = 1, 'the deletion log stays');
  perform tests.as_user(owner);
  perform tests.throws('select * from ledger.deleted_organizations', 'nobody reads the deletion log through the API', 'permission denied');
end
$$;
rollback;
