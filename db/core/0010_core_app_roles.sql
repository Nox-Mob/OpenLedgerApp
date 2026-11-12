-- OpenAppHub core: a different role in each app (owner direction, 2026-11-12). Idempotent.
--
-- Everyone has one OpenAppHub role (public.memberships.role: owner, admin, member, viewer). It is
-- the role in every app unless an owner or admin sets a different one for an app here: someone
-- can be an admin in OpenBoardApp, a member in OpenCharterApp and view-only in OpenLedgerApp.
-- The owner is the owner everywhere. Each app checks public.app_role / public.has_app_role
-- instead of the OpenAppHub role; app overlays still add to it (Board's offices, Ledger's
-- treasurer, Charter's roles per unit).

create table if not exists public.app_role_overrides (
  org_id uuid not null,
  user_id uuid not null,
  app text not null check (app in ('charter', 'board', 'ledger')),
  role public.org_role not null check (role <> 'owner'),
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (org_id, user_id, app),
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);

alter table public.app_role_overrides enable row level security;
drop policy if exists app_role_overrides_read on public.app_role_overrides;
create policy app_role_overrides_read on public.app_role_overrides for select to authenticated using (public.is_member(org_id));
grant select on public.app_role_overrides to authenticated;
grant all on public.app_role_overrides to service_role;

-- The role a person has in one app: the owner is the owner; otherwise the app's own, or the
-- OpenAppHub role. Null when they aren't a member.
create or replace function public.app_role(p_org uuid, p_app text, p_user uuid default auth.uid())
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select case when m.role = 'owner' then 'owner'::public.org_role else coalesce(o.role, m.role) end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public.has_app_role(p_org uuid, p_app text, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role(p_org, p_app) = any (p_roles), false);
$$;

-- The caller's organizations with their role in one app (for set-based row rules).
create or replace function public.my_app_memberships(p_app text)
returns table (org_id uuid, role public.org_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, case when m.role = 'owner' then 'owner'::public.org_role else coalesce(o.role, m.role) end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  where m.user_id = auth.uid();
$$;

-- Owners and admins set (or, with null, clear) someone's role in one app.
create or replace function public.set_app_role(p_org uuid, p_user uuid, p_app text, p_role public.org_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_core public.org_role;
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can change roles.' using errcode = '42501';
  end if;
  if p_app not in ('charter', 'board', 'ledger') then
    raise exception 'Choose OpenCharterApp, OpenBoardApp or OpenLedgerApp.' using errcode = '22023';
  end if;
  select role into v_core from public.memberships where org_id = p_org and user_id = p_user;
  if v_core is null then
    raise exception 'Choose someone in this organization.' using errcode = '22023';
  end if;
  if v_core = 'owner' then
    raise exception 'The owner is the owner in every app.' using errcode = '22023';
  end if;
  if p_role = 'owner' then
    raise exception 'There is one owner; transfer ownership in Settings instead.' using errcode = '22023';
  end if;
  if p_role is null or p_role = v_core then
    delete from public.app_role_overrides where org_id = p_org and user_id = p_user and app = p_app;
  else
    insert into public.app_role_overrides (org_id, user_id, app, role) values (p_org, p_user, p_app, p_role)
    on conflict (org_id, user_id, app) do update set role = excluded.role, set_by = auth.uid(), set_at = now();
  end if;
end;
$$;

revoke all on function public.app_role(uuid, text, uuid), public.has_app_role(uuid, text, public.org_role[]),
  public.my_app_memberships(text), public.set_app_role(uuid, uuid, text, public.org_role)
from public, anon;
grant execute on function public.app_role(uuid, text, uuid), public.has_app_role(uuid, text, public.org_role[]),
  public.my_app_memberships(text), public.set_app_role(uuid, uuid, text, public.org_role)
to authenticated, service_role;

-- Writing in an app follows the person's role in that app (a viewer in OpenAppHub who is an
-- admin in OpenBoardApp can write there), and the plan (has_app_access, unchanged).
create or replace function public.can_write(p_org uuid, p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_app in ('charter', 'board', 'ledger')
              then public.has_app_role(p_org, p_app, '{owner,admin,member}'::public.org_role[])
              else public.has_role(p_org, '{owner,admin,member}'::public.org_role[]) end
     and public.has_app_access(p_org, p_app);
$$;
