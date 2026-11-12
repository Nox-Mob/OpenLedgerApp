-- OpenAppHub core: child organizations (a chapter's own organization).
-- Idempotent (runs on the shared database and on self-hosted app databases).
--
-- An organization in OpenCharterApp is a whole tree (a national and its chapters). When the
-- national approves, a chapter gets its own organization so it can run its board in
-- OpenBoardApp, which works per organization. That organization:
--   - has parent_org_id: the national's organization (one level only)
--   - remembers where it came from (source_app 'charter', source_ref: the chapter's unit id)
--   - is covered by the parent's plan when billing is on (the hub's billing migration 0004)
-- Child organizations are created only by an app's own security definer function (Charter's
-- approval), never directly by browsers.

alter table public.organizations
  add column if not exists parent_org_id uuid references public.organizations (id) on delete cascade,
  add column if not exists source_app text,
  add column if not exists source_ref uuid;

do $$
begin
  alter table public.organizations
    add constraint organizations_parent_not_self check (parent_org_id is distinct from id);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.organizations
    add constraint organizations_source_app_check check (source_app is null or source_app ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null;
end $$;

create unique index if not exists organizations_source_uidx
  on public.organizations (source_app, source_ref) where source_app is not null;
create index if not exists organizations_parent_idx
  on public.organizations (parent_org_id) where parent_org_id is not null;

-- One level only: a child can't be a parent, and a parent can't be a child.
create or replace function public._check_org_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_org_id is not null then
    if exists (select 1 from public.organizations p where p.id = new.parent_org_id and p.parent_org_id is not null) then
      raise exception 'A chapter''s organization can''t have chapters of its own.' using errcode = '23514';
    end if;
    if exists (select 1 from public.organizations c where c.parent_org_id = new.id) then
      raise exception 'This organization has chapters, so it can''t be one.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_check_parent on public.organizations;
create trigger organizations_check_parent
  before insert or update of parent_org_id on public.organizations
  for each row execute function public._check_org_parent();

-- Create (or find) a child organization. For apps' security definer functions only.
-- The owner is the person who asked for it; p_admins (e.g. the parent's owner) become admins.
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
    end if;
  end loop;
  return v_org;
end;
$$;

revoke all on function public._check_org_parent() from public, anon, authenticated;
revoke all on function public._create_child_organization(uuid, text, uuid, text, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public._create_child_organization(uuid, text, uuid, text, uuid, uuid[]) to service_role;

-- organizations: members already read their organizations (0003). A child's members also
-- see its parent's name, for "Chapter of …" in the apps. A definer helper, so the policy
-- doesn't query organizations under its own row security.
create or replace function public.is_member_of_child(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations c
    join public.memberships m on m.org_id = c.id and m.user_id = auth.uid()
    where c.parent_org_id = p_org
  );
$$;

revoke all on function public.is_member_of_child(uuid) from public, anon;
grant execute on function public.is_member_of_child(uuid) to authenticated, service_role;

drop policy if exists "organizations: read the parent of your chapter" on public.organizations;
create policy "organizations: read the parent of your chapter" on public.organizations
  for select to authenticated
  using (public.is_member_of_child(id));
