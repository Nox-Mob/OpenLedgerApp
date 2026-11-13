-- No access in OpenLedgerApp (core 0015, owner decision 2026-11-13). Someone with No access here
-- (set for them, or "none" in their named role) can't read the organization's books, settings or
-- Ledger roles; they stay in the organization and keep their roles in the other apps. The owner
-- always has access. Reads go through ledger.can_read and ledger.readable_org_ids; the two rules
-- that checked membership directly (settings and Ledger roles, read before two-step sign-in is
-- done) check No access too. Writing already needed a Ledger role.

create or replace function ledger.can_read(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member(p_org) and ledger.mfa_ok(p_org)
    and (to_regprocedure('public.can_open_app(uuid,text,uuid)') is null or public.can_open_app(p_org, 'ledger'));
$$;

create or replace function ledger.readable_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
  where m.user_id = auth.uid() and ledger.mfa_ok(m.org_id)
    and (to_regprocedure('public.can_open_app(uuid,text,uuid)') is null or public.can_open_app(m.org_id, 'ledger', m.user_id));
$$;

drop policy if exists "Members read settings" on ledger.org_settings;
create policy "Members read settings" on ledger.org_settings for select to authenticated
  using (public.is_member(org_id) and (to_regprocedure('public.can_open_app(uuid,text,uuid)') is null or public.can_open_app(org_id, 'ledger')));
drop policy if exists "Members read Ledger roles" on ledger.member_roles;
create policy "Members read Ledger roles" on ledger.member_roles for select to authenticated
  using (public.is_member(org_id) and (to_regprocedure('public.can_open_app(uuid,text,uuid)') is null or public.can_open_app(org_id, 'ledger')));
