-- Named roles and each app's role decided on its own (core 0011, H-09).
--
-- * OpenLedgerApp registers what named roles can grant on top of the Ledger role: closing the
--   books (what a treasurer can do) and managing settings and accounts (what an admin can do).
-- * Invitations made in OpenLedgerApp carry the Ledger role (public.invitations.app_roles); an
--   invitation made before H-09 gives its OpenAppHub role in OpenLedgerApp, as it used to.

select public.register_app_permission('ledger', 'ledger.close_books', 'Close the books',
  'Close and reopen months, lock periods, reopen statement checks. What a treasurer can do.', 10);
select public.register_app_permission('ledger', 'ledger.manage', 'Manage the books',
  'Settings, the chart of accounts, archiving accounts. What a Ledger admin can do.', 20);

create or replace function ledger.is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org)
     and (public.has_app_role(p_org, 'ledger', '{owner,admin}'::public.org_role[])
          or public.has_app_permission(p_org, 'ledger', 'ledger.manage'));
$$;

create or replace function ledger.can_close_books(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select ledger.can_edit(p_org)
     and (public.has_app_role(p_org, 'ledger', '{owner,admin}'::public.org_role[])
          or ledger.is_treasurer(p_org)
          or public.has_app_permission(p_org, 'ledger', 'ledger.close_books'));
$$;

create or replace function ledger.on_invitation_accepted(p_invitation_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_inv public.invitations;
  v_role text;
begin
  select * into v_inv from public.invitations where id = p_invitation_id;
  if v_inv.id is null or v_inv.accepted_by is distinct from auth.uid() then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if v_inv.app is distinct from 'ledger' then return; end if;
  v_role := coalesce(v_inv.app_roles ->> 'ledger', v_inv.role::text);
  if not (coalesce(v_inv.app_roles, '{}'::jsonb) ? 'ledger') and v_role in ('admin', 'member') then
    insert into public.app_role_overrides (org_id, user_id, app, role, set_by)
    values (v_inv.org_id, auth.uid(), 'ledger', v_role::public.org_role, v_inv.invited_by)
    on conflict on constraint app_role_overrides_pkey do nothing;
  end if;
  if v_inv.app_payload ->> 'ledger_role' is null then return; end if;
  if v_inv.app_payload ->> 'ledger_role' <> 'treasurer' then
    raise exception 'Unknown Ledger role %', v_inv.app_payload ->> 'ledger_role' using errcode = '22023';
  end if;
  if v_role is null or v_role not in ('admin', 'member') then
    raise exception 'The treasurer role needs a member role' using errcode = '22023';
  end if;
  insert into ledger.member_roles (org_id, user_id, role) values (v_inv.org_id, auth.uid(), 'treasurer')
  on conflict (org_id, user_id) do nothing;
end $$;
