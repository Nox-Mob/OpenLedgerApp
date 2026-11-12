-- OpenAppHub core: named roles, and each app's role decided on its own (owner direction,
-- 2026-11-12, H-09). Idempotent.
--
-- * The OpenAppHub role (public.memberships.role) is for OpenAppHub only: an OpenAppHub admin
--   manages people, invitations, named roles, billing and the organization's settings, and is
--   not an admin in any app because of it.
-- * A person's role in an app (public.app_role) is, in order: the owner is the owner everywhere;
--   a role set for that person in that app (public.app_role_overrides); their named role's role
--   for that app; otherwise viewer. The viewer fallback is shown in OpenAppHub like any role.
-- * A named role (public.org_named_roles), e.g. "Treasurer": a role per app (admin in
--   OpenLedgerApp, member in OpenBoardApp and OpenCharterApp) and extra permissions per app from
--   the permissions each app registers (public.app_permission_types). One named role per person.
-- * Invitations say which named role and/or which role in each app the person gets.
-- * Everyone's current access is copied into roles set per app the first time this runs, so
--   nobody gains or loses anything the day it ships.

-- ── Permissions each app offers (apps register them in their migrations) ──────────────────────
create table if not exists public.app_permission_types (
  app text not null check (app in ('charter', 'board', 'ledger')),
  key text not null check (key ~ '^[a-z][a-z0-9_.]*$'),
  label text not null,
  description text not null default '',
  sort int not null default 100,
  primary key (app, key)
);
alter table public.app_permission_types enable row level security;
drop policy if exists app_permission_types_read on public.app_permission_types;
create policy app_permission_types_read on public.app_permission_types for select to authenticated using (true);
grant select on public.app_permission_types to authenticated;
grant all on public.app_permission_types to service_role;

create or replace function public.register_app_permission(
  p_app text, p_key text, p_label text, p_description text default '', p_sort int default 100
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.app_permission_types (app, key, label, description, sort)
  values (p_app, p_key, p_label, coalesce(p_description, ''), coalesce(p_sort, 100))
  on conflict (app, key) do update
    set label = excluded.label, description = excluded.description, sort = excluded.sort;
$$;
revoke all on function public.register_app_permission(text, text, text, text, int) from public, anon, authenticated;

-- ── Named roles ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.org_named_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  -- {"charter": "member", "board": "member", "ledger": "admin"}; a missing app means viewer.
  app_roles jsonb not null default '{}'::jsonb,
  -- {"charter": ["awards.approve"], "board": [], "ledger": []}
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists org_named_roles_name on public.org_named_roles (org_id, lower(btrim(name)));
-- For the composite reference from memberships (a person's named role is in their organization).
create unique index if not exists org_named_roles_org_id on public.org_named_roles (org_id, id);

alter table public.org_named_roles enable row level security;
drop policy if exists org_named_roles_read on public.org_named_roles;
create policy org_named_roles_read on public.org_named_roles for select to authenticated using (public.is_member(org_id));
grant select on public.org_named_roles to authenticated;
grant all on public.org_named_roles to service_role;

alter table public.memberships add column if not exists named_role_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_named_role_fk') then
    alter table public.memberships add constraint memberships_named_role_fk
      foreign key (org_id, named_role_id) references public.org_named_roles (org_id, id) on delete set null (named_role_id);
  end if;
end $$;
create index if not exists memberships_named_role on public.memberships (named_role_id) where named_role_id is not null;

alter table public.invitations add column if not exists named_role_id uuid references public.org_named_roles (id) on delete set null;
alter table public.invitations add column if not exists app_roles jsonb not null default '{}'::jsonb;

-- ── Resolving someone's role in an app ─────────────────────────────────────────────────────────
-- 'owner', 'person' (set for them in this app), 'named' (their named role), 'fallback' (viewer:
-- nothing set). Null when they aren't a member.
create or replace function public.app_role_source(p_org uuid, p_app text, p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.role = 'owner' then 'owner'
    when o.role is not null then 'person'
    when nr.app_roles ->> p_app in ('admin', 'member', 'viewer') then 'named'
    else 'fallback' end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public.app_role(p_org uuid, p_app text, p_user uuid default auth.uid())
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.role = 'owner' then 'owner'::public.org_role
    when o.role is not null then o.role
    when nr.app_roles ->> p_app in ('admin', 'member', 'viewer') then (nr.app_roles ->> p_app)::public.org_role
    else 'viewer'::public.org_role end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public.my_app_memberships(p_app text)
returns table (org_id uuid, role public.org_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, case
    when m.role = 'owner' then 'owner'::public.org_role
    when o.role is not null then o.role
    when nr.app_roles ->> p_app in ('admin', 'member', 'viewer') then (nr.app_roles ->> p_app)::public.org_role
    else 'viewer'::public.org_role end
  from public.memberships m
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = p_app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.user_id = auth.uid();
$$;

-- Everyone's role in every app, with where it comes from (the hub's People page, each app's
-- members page). Members of the organization see it.
create or replace function public.org_app_roles(p_org uuid)
returns table (user_id uuid, app text, role public.org_role, source text, named_role_id uuid, named_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, a.app,
    case
      when m.role = 'owner' then 'owner'::public.org_role
      when o.role is not null then o.role
      when nr.app_roles ->> a.app in ('admin', 'member', 'viewer') then (nr.app_roles ->> a.app)::public.org_role
      else 'viewer'::public.org_role end,
    case
      when m.role = 'owner' then 'owner'
      when o.role is not null then 'person'
      when nr.app_roles ->> a.app in ('admin', 'member', 'viewer') then 'named'
      else 'fallback' end,
    m.named_role_id, nr.name
  from public.memberships m
  cross join (values ('charter'), ('board'), ('ledger')) as a (app)
  left join public.app_role_overrides o on o.org_id = m.org_id and o.user_id = m.user_id and o.app = a.app
  left join public.org_named_roles nr on nr.id = m.named_role_id
  where m.org_id = p_org and public.is_member(p_org);
$$;

-- Extra permissions: admins and the owner have every permission in their app; otherwise the
-- named role grants it. (Apps add their own on top, e.g. Charter's roles in a unit.)
create or replace function public.has_app_permission(p_org uuid, p_app text, p_key text, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.app_role(p_org, p_app, p_user) in ('owner', 'admin')
    or exists (
      select 1 from public.memberships m
      join public.org_named_roles nr on nr.id = m.named_role_id
      where m.org_id = p_org and m.user_id = p_user
        and coalesce(nr.permissions -> p_app, '[]'::jsonb) ? p_key
    ), false);
$$;

-- An editor, for plan limits (owner decision 2026-11-12): the owner, OpenAppHub admins, and
-- anyone who is a member or admin in at least one app. Kept here so the rule can change in one
-- place. (Chapters' own organizations never count: billing.check_member_limit skips them.)
create or replace function public.is_org_editor(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_user and m.role in ('owner', 'admin'))
      or exists (
        select 1 from (values ('charter'), ('board'), ('ledger')) as a (app)
        where public.app_role(p_org, a.app, p_user) in ('owner', 'admin', 'member'));
$$;

create or replace function public.org_editor_count(p_org uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.memberships m where m.org_id = p_org and public.is_org_editor(p_org, m.user_id);
$$;

-- ── Changing roles (owners and OpenAppHub admins) ──────────────────────────────────────────────
create or replace function public._require_people_manager(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only the owner and OpenAppHub admins can change roles.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public._require_people_manager(uuid) from public, anon, authenticated;

create or replace function public._clean_app_roles(p_value jsonb)
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
    if v not in ('admin', 'member', 'viewer') then
      raise exception 'A role in an app is admin, member or viewer.' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object(k, v);
  end loop;
  return v_out;
end;
$$;

create or replace function public._clean_app_permissions(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  v_keys jsonb;
  p text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    return v_out;
  end if;
  for k, v in select * from jsonb_each(p_value) loop
    if k not in ('charter', 'board', 'ledger') then
      raise exception 'Unknown app "%".', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Permissions are a list for each app.' using errcode = '22023';
    end if;
    v_keys := '[]'::jsonb;
    for p in select distinct x from jsonb_array_elements_text(v) as t (x) order by 1 loop
      if not exists (select 1 from public.app_permission_types t where t.app = k and t.key = p) then
        raise exception 'Unknown permission "%" for %.', p, k using errcode = '22023';
      end if;
      v_keys := v_keys || to_jsonb(p);
    end loop;
    if jsonb_array_length(v_keys) > 0 then
      v_out := v_out || jsonb_build_object(k, v_keys);
    end if;
  end loop;
  return v_out;
end;
$$;

-- Create (p_id null) or change a named role. Returns its id.
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
    values (p_org, btrim(p_name), coalesce(p_description, ''), public._clean_app_roles(p_app_roles),
            public._clean_app_permissions(p_permissions))
    returning id into v_id;
  else
    update public.org_named_roles
    set name = btrim(p_name), description = coalesce(p_description, ''),
        app_roles = public._clean_app_roles(p_app_roles),
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

-- Deleting a named role: the people who held it keep anything set for them per app, and are
-- viewers elsewhere until someone gives them a role.
create or replace function public.delete_named_role(p_org uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_people_manager(p_org);
  delete from public.org_named_roles where id = p_id and org_id = p_org;
end;
$$;

-- Give someone a named role (null: none).
create or replace function public.set_named_role(p_org uuid, p_user uuid, p_role uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_people_manager(p_org);
  if p_role is not null and not exists (select 1 from public.org_named_roles where id = p_role and org_id = p_org) then
    raise exception 'That role isn''t in this organization.' using errcode = 'P0002';
  end if;
  update public.memberships set named_role_id = p_role where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'Choose someone in this organization.' using errcode = '22023';
  end if;
end;
$$;

-- Set (or, with null, clear) someone's role in one app. Cleared, it comes from their named role
-- (or is viewer).
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
  perform public._require_people_manager(p_org);
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
  if p_role is null then
    delete from public.app_role_overrides where org_id = p_org and user_id = p_user and app = p_app;
  else
    insert into public.app_role_overrides (org_id, user_id, app, role) values (p_org, p_user, p_app, p_role)
    on conflict (org_id, user_id, app) do update set role = excluded.role, set_by = auth.uid(), set_at = now();
  end if;
end;
$$;

-- ── Invitations carry roles ────────────────────────────────────────────────────────────────────
-- Called right after create_invitation (same caller): the named role and/or each app's role the
-- person gets when they accept. Without either they're viewers in every app until someone
-- gives them a role.
create or replace function public.set_invitation_roles(p_invitation uuid, p_named_role uuid, p_app_roles jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invitations where id = p_invitation and accepted_at is null and revoked_at is null;
  if v_org is null then
    raise exception 'That invitation can''t be changed any more.' using errcode = 'P0002';
  end if;
  perform public._require_people_manager(v_org);
  if p_named_role is not null and not exists (select 1 from public.org_named_roles where id = p_named_role and org_id = v_org) then
    raise exception 'That role isn''t in this organization.' using errcode = 'P0002';
  end if;
  update public.invitations
  set named_role_id = p_named_role, app_roles = public._clean_app_roles(p_app_roles)
  where id = p_invitation;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns table (id uuid, org_id uuid, role public.org_role, app text, app_payload jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_inv public.invitations%rowtype;
  v_user_email text;
  v_confirmed timestamptz;
  v_new boolean := false;
  k text;
  v text;
begin
  select * into v_inv from public.invitations i
  where i.token_hash = public._token_hash(p_token)
  for update;

  if not found then
    raise exception 'This invitation link isn''t valid.' using errcode = 'P0002';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'This invitation was cancelled.' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This invitation has already been used.' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = '22023';
  end if;

  if v_inv.email is not null then
    select lower(u.email::text), u.email_confirmed_at into v_user_email, v_confirmed
    from auth.users u where u.id = v_uid;
    if v_user_email is distinct from v_inv.email then
      raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
    end if;
    if v_confirmed is null then
      raise exception 'Confirm your email address before accepting this invitation.' using errcode = '42501';
    end if;
  end if;

  if v_inv.role is not null then
    -- Existing members keep their current roles.
    insert into public.memberships as m (org_id, user_id, role, named_role_id)
    values (v_inv.org_id, v_uid, v_inv.role,
            (select nr.id from public.org_named_roles nr where nr.id = v_inv.named_role_id and nr.org_id = v_inv.org_id))
    on conflict on constraint memberships_pkey do nothing;
    v_new := found;
    if v_new then
      for k, v in select * from jsonb_each_text(coalesce(v_inv.app_roles, '{}'::jsonb)) loop
        if k in ('charter', 'board', 'ledger') and v in ('admin', 'member', 'viewer') then
          insert into public.app_role_overrides (org_id, user_id, app, role, set_by)
          values (v_inv.org_id, v_uid, k, v::public.org_role, v_inv.invited_by)
          on conflict on constraint app_role_overrides_pkey do nothing;
        end if;
      end loop;
    end if;
  end if;

  update public.invitations as i
  set accepted_by = v_uid, accepted_at = now()
  where i.id = v_inv.id;

  id := v_inv.id;
  org_id := v_inv.org_id;
  role := v_inv.role;
  app := v_inv.app;
  app_payload := v_inv.app_payload;
  return next;
end;
$$;

revoke all on function
  public.app_role_source(uuid, text, uuid), public.org_app_roles(uuid),
  public.has_app_permission(uuid, text, text, uuid), public.is_org_editor(uuid, uuid), public.org_editor_count(uuid),
  public.save_named_role(uuid, uuid, text, text, jsonb, jsonb), public.delete_named_role(uuid, uuid),
  public.set_named_role(uuid, uuid, uuid), public.set_invitation_roles(uuid, uuid, jsonb)
from public, anon;
grant execute on function
  public.app_role_source(uuid, text, uuid), public.org_app_roles(uuid),
  public.has_app_permission(uuid, text, text, uuid), public.is_org_editor(uuid, uuid), public.org_editor_count(uuid),
  public.save_named_role(uuid, uuid, text, text, jsonb, jsonb), public.delete_named_role(uuid, uuid),
  public.set_named_role(uuid, uuid, uuid), public.set_invitation_roles(uuid, uuid, jsonb)
to authenticated, service_role;
revoke all on function public._clean_app_roles(jsonb), public._clean_app_permissions(jsonb) from public, anon, authenticated;

-- ── Chapters' organizations: the parent's admins are admins in its apps ──────────────────────────
create or replace function public._create_child_organization(
  p_parent uuid,
  p_name text,
  p_owner uuid,
  p_source_app text,
  p_source_ref uuid,
  p_admins uuid[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text := public._clean_org_name(p_name);
  v_base text;
  v_user uuid;
begin
  if p_parent is null or p_owner is null or p_source_app is null or p_source_ref is null then
    raise exception 'A parent, an owner and a source are required.' using errcode = '22023';
  end if;
  select o.id into v_org from public.organizations o
  where o.source_app = p_source_app and o.source_ref = p_source_ref;
  if v_org is not null then
    return v_org;
  end if;

  v_base := btrim(left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-');
  if v_base = '' then
    v_base := 'org';
  end if;
  insert into public.organizations (name, slug, created_by, parent_org_id, source_app, source_ref, time_zone, currency)
  select v_name, v_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6), p_owner,
         p_parent, p_source_app, p_source_ref, p.time_zone, p.currency
  from public.organizations p where p.id = p_parent
  returning id into v_org;
  if v_org is null then
    raise exception 'The parent organization doesn''t exist.' using errcode = '23503';
  end if;

  insert into public.memberships (org_id, user_id, role) values (v_org, p_owner, 'owner');
  foreach v_user in array coalesce(p_admins, '{}') loop
    if v_user is not null and v_user <> p_owner then
      insert into public.memberships (org_id, user_id, role) values (v_org, v_user, 'admin')
      on conflict (org_id, user_id) do nothing;
      -- H-09: an OpenAppHub admin isn't an app admin by itself; the parent's people who look
      -- after a chapter's organization are admins in its apps, as they were before.
      insert into public.app_role_overrides (org_id, user_id, app, role)
      select v_org, v_user, a.app, 'admin' from (values ('charter'), ('board'), ('ledger')) as a (app)
      on conflict on constraint app_role_overrides_pkey do nothing;
    end if;
  end loop;
  return v_org;
end;
$$;

-- ── Keep everyone's access as it was (once) ───────────────────────────────────────────────────
-- Before H-09, a person's role in each app was their OpenAppHub role unless set for the app.
-- Copy that into roles set per app, so the new fallback (viewer) changes nobody's access.
create table if not exists public._core_migration_marks (mark text primary key, done_at timestamptz not null default now());
alter table public._core_migration_marks enable row level security;
revoke all on public._core_migration_marks from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from public._core_migration_marks where mark = 'h09_copy_app_roles') then
    insert into public.app_role_overrides (org_id, user_id, app, role, set_by)
    select m.org_id, m.user_id, a.app, m.role, null
    from public.memberships m
    cross join (values ('charter'), ('board'), ('ledger')) as a (app)
    where m.role in ('admin', 'member')
    on conflict (org_id, user_id, app) do nothing;
    insert into public._core_migration_marks (mark) values ('h09_copy_app_roles');
  end if;
end $$;
