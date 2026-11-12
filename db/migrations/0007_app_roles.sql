-- A different role in each app (core 0010): OpenLedgerApp's rules use the person's Ledger role
-- (public.app_role(org, 'ledger')), which is their OpenAppHub role unless an owner or admin set
-- a different one for Ledger (someone can be an admin here and view-only elsewhere, or the other
-- way round). The treasurer overlay still sits on top of a member role. Same functions as the
-- baseline, with the OpenAppHub role replaced by the Ledger role.

create or replace function ledger.is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org) and public.has_app_role(p_org, 'ledger', '{owner,admin}'::public.org_role[]);
$$;

create or replace function ledger.is_treasurer(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ledger.member_roles r where r.org_id = p_org and r.user_id = auth.uid() and r.role = 'treasurer')
     and public.has_app_role(p_org, 'ledger', '{owner,admin,member}'::public.org_role[]);
$$;

create or replace function ledger.can_close_books(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org)
     and (public.has_app_role(p_org, 'ledger', '{owner,admin}'::public.org_role[]) or ledger.is_treasurer(p_org));
$$;

create or replace function ledger.writable_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.org_id from public.my_app_memberships('ledger') m
  where m.role in ('owner', 'admin', 'member')
    and public.has_app_access(m.org_id, 'ledger') and ledger.mfa_ok(m.org_id);
$$;

-- A treasurer must hold member or higher in Ledger.
create or replace function ledger.check_member_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(public.app_role(new.org_id, 'ledger', new.user_id), 'viewer') not in ('owner', 'admin', 'member') then
    raise exception 'A treasurer must be a member of the organization in OpenLedgerApp (not a viewer)';
  end if;
  return new;
end $$;
