-- OpenAppHub core: "No access" in an app, and letting app admins change roles in their own app
-- (owner decisions 2026-11-13). Idempotent.
--
-- * No access: someone in the organization can be kept out of one app entirely, for themselves
--   (set_app_access) or through their named role ("none" for that app). public.app_role then
--   returns null for them in that app, can_open_app is false, the app isn't in their list of
--   organizations there (my_app_memberships), and each app's own read rules leave them out. They
--   stay in the organization and keep their roles in the other apps. The owner always has access.
-- * App admins may change roles in their own app: an organization setting, off until the owner or
--   an OpenAppHub admin switches it on. With it on, someone who is admin in an app can change other
--   people's role in that app (including No access), but not the owner's, not anyone's OpenAppHub
--   role, and not in other apps.

alter table public.app_role_overrides add column if not exists no_access boolean not null default false;

create table if not exists public.org_role_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  app_admins_manage_roles boolean not null default false,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now()
);
alter table public.org_role_settings enable row level security;
drop policy if exists org_role_settings_read on public.org_role_settings;
create policy org_role_settings_read on public.org_role_settings for select to authenticated using (public.is_member(org_id));
grant select on public.org_role_settings to authenticated;
grant all on public.org_role_settings to service_role;

create or replace function public.org_role_settings(p_org uuid)
returns table (app_admins_manage_roles boolean, can_change boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_member(p_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  return query select coalesce((select s.app_admins_manage_roles from public.org_role_settings s where s.org_id = p_org), false),
                      public.has_role(p_org, array['owner', 'admin']::public.org_role[]);
end;
$$;

create or replace function public.set_org_role_settings(p_org uuid, p_app_admins_manage_roles boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_people_manager(p_org);
  insert into public.org_role_settings (org_id, app_admins_manage_roles, set_by, set_at)
  values (p_org, coalesce(p_app_admins_manage_roles, false), auth.uid(), now())
  on conflict (org_id) do update set app_admins_manage_roles = excluded.app_admins_manage_roles,
    set_by = excluded.set_by, set_at = now();
end;
$$;
revoke all on function public.org_role_settings(uuid), public.set_org_role_settings(uuid, boolean) from public, anon;
grant execute on function public.org_role_settings(uuid), public.set_org_role_settings(uuid, boolean) to authenticated, service_role;

-- ── The role rule, with No access ──────────────────────────────────────────────────────────────
-- Owner; else No access (for the person, or "none" in their named role) → null; else their role
-- set for that app; else their named role's role there; else viewer.
create or replace function public.app_role(p_org uuid, p_app text, p_user uuid default auth.uid())
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.role = 'owner' then 'owner'::public.org_role
    when coalesce(o.no_access, false) then null
    when o.role is not null then o.role
    when nr.app_roles ->> p_app = 'none' then null
    when nr.app_roles ->> p_app in ('admin', 'member', 'viewer') then (nr.app_roles ->> p_app)::public.org_role
    else 'viewer'::public.org_role end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public.app_role_source(p_org uuid, p_app text, p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.role = 'owner' then 'owner'
    when o.role is not null or coalesce(o.no_access, false) then 'person'
    when nr.app_roles ->> p_app in ('admin', 'member', 'viewer', 'none') then 'named'
    else 'fallback' end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and m.user_id = p_user;
$$;

-- Whether someone may open an app for an organization at all (billing aside: has_app_access).
create or replace function public.can_open_app(p_org uuid, p_app text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_role(p_org, p_app, p_user) is not null;
$$;
revoke all on function public.can_open_app(uuid, text, uuid) from public, anon;
grant execute on function public.can_open_app(uuid, text, uuid) to authenticated, service_role;

-- The organizations the caller can open this app for, with their role there.
create or replace function public.my_app_memberships(p_app text)
returns table (org_id uuid, role public.org_role)
language sql
stable
security definer
set search_path = ''
as $$
  select q.org_id, q.role from (
    select m.org_id, public.app_role(m.org_id, p_app, m.user_id) as role
    from public.memberships m
    where m.user_id = auth.uid()
  ) q
  where q.role is not null;
$$;

-- Everyone's role in every app. role is null for No access (source says where it comes from).
create or replace function public.org_app_roles(p_org uuid)
returns table (user_id uuid, app text, role public.org_role, source text, named_role_id uuid, named_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, a.app,
    public.app_role(p_org, a.app, m.user_id),
    public.app_role_source(p_org, a.app, m.user_id),
    m.named_role_id, nr.name
  from public.memberships m
  cross join (values ('charter'), ('board'), ('ledger')) as a (app)
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and public.is_member(p_org);
$$;

-- Extra permissions never reach someone with No access in that app.
create or replace function public.has_app_permission(p_org uuid, p_app text, p_key text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.app_role(p_org, p_app, p_user) in ('owner', 'admin')
    or (public.app_role(p_org, p_app, p_user) is not null and exists (
      select 1 from public.memberships m
      join public.org_named_roles nr on nr.id = m.named_role_id
      where m.org_id = p_org and m.user_id = p_user
        and coalesce(nr.permissions -> p_app, '[]'::jsonb) ? p_key
    )), false);
$$;

-- ── Who may change roles in an app ─────────────────────────────────────────────────────────────
-- The owner and OpenAppHub admins, always; that app's admins too when the organization allows it.
create or replace function public._require_app_role_manager(p_org uuid, p_app text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    return;
  end if;
  if coalesce((select s.app_admins_manage_roles from public.org_role_settings s where s.org_id = p_org), false)
     and public.app_role(p_org, p_app, auth.uid()) = 'admin' then
    return;
  end if;
  raise exception 'Only the owner and OpenAppHub admins can change roles%.',
    case when coalesce((select s.app_admins_manage_roles from public.org_role_settings s where s.org_id = p_org), false)
      then ' (or an admin in this app)' else '' end using errcode = '42501';
end;
$$;
revoke all on function public._require_app_role_manager(uuid, text) from public, anon, authenticated;

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
  if p_app not in ('charter', 'board', 'ledger') then
    raise exception 'Choose OpenCharterApp, OpenBoardApp or OpenLedgerApp.' using errcode = '22023';
  end if;
  perform public._require_app_role_manager(p_org, p_app);
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
  if p_role is null then
    delete from public.app_role_overrides where org_id = p_org and user_id = p_user and app = p_app;
  else
    insert into public.app_role_overrides (org_id, user_id, app, role, no_access) values (p_org, p_user, p_app, p_role, false)
    on conflict (org_id, user_id, app) do update set role = excluded.role, no_access = false, set_by = auth.uid(), set_at = now();
  end if;
end;
$$;

-- No access in one app for one person (p_no_access false: back to their role from the named role
-- or the fallback).
create or replace function public.set_app_access(p_org uuid, p_user uuid, p_app text, p_no_access boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_core public.org_role;
begin
  if p_app not in ('charter', 'board', 'ledger') then
    raise exception 'Choose OpenCharterApp, OpenBoardApp or OpenLedgerApp.' using errcode = '22023';
  end if;
  perform public._require_app_role_manager(p_org, p_app);
  select role into v_core from public.memberships where org_id = p_org and user_id = p_user;
  if v_core is null then
    raise exception 'Choose someone in this organization.' using errcode = '22023';
  end if;
  if v_core = 'owner' then
    raise exception 'The owner always has access.' using errcode = '22023';
  end if;
  if p_user = auth.uid() and coalesce(p_no_access, false) then
    raise exception 'You can''t take away your own access.' using errcode = '22023';
  end if;
  if coalesce(p_no_access, false) then
    insert into public.app_role_overrides (org_id, user_id, app, role, no_access) values (p_org, p_user, p_app, 'viewer', true)
    on conflict (org_id, user_id, app) do update set no_access = true, set_by = auth.uid(), set_at = now();
  else
    delete from public.app_role_overrides where org_id = p_org and user_id = p_user and app = p_app and no_access;
  end if;
end;
$$;
revoke all on function public.set_app_role(uuid, uuid, text, public.org_role), public.set_app_access(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_app_role(uuid, uuid, text, public.org_role), public.set_app_access(uuid, uuid, text, boolean) to authenticated, service_role;

-- Named roles may say "none" for an app (No access there). Invitations still choose a role only:
-- No access is set after someone joins.
create or replace function public._clean_named_app_roles(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return v_out;
  end if;
  for k, v in select * from jsonb_each_text(p_value) loop
    if k not in ('charter', 'board', 'ledger') then
      raise exception 'Unknown app "%".', k using errcode = '22023';
    end if;
    if v not in ('admin', 'member', 'viewer', 'none') then
      raise exception 'A role in an app is admin, member or viewer (or none, for no access).' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object(k, v);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._clean_named_app_roles(jsonb) from public, anon, authenticated;

create or replace function public.save_named_role(
  p_org uuid, p_id uuid, p_name text, p_description text, p_app_roles jsonb, p_permissions jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public._require_people_manager(p_org);
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the role a name.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.org_named_roles (org_id, name, description, app_roles, permissions)
    values (p_org, btrim(p_name), coalesce(p_description, ''), public._clean_named_app_roles(p_app_roles),
            public._clean_app_permissions(p_permissions))
    returning id into v_id;
  else
    update public.org_named_roles
    set name = btrim(p_name), description = coalesce(p_description, ''),
        app_roles = public._clean_named_app_roles(p_app_roles),
        permissions = public._clean_app_permissions(p_permissions), updated_at = now()
    where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then
      raise exception 'That role isn''t in this organization.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'There''s already a role called "%".', btrim(p_name) using errcode = '23505';
end;
$$;
