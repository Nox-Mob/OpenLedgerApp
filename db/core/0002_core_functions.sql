-- OpenAppHub core: functions and triggers (SHARED-SPEC §3.2, §4.3, §4.4).
-- Idempotent. All functions: security definer, search_path = '', fully
-- qualified names. Execute is revoked from public/anon and granted to
-- authenticated unless stated.

-- Access helpers ---------------------------------------------------------------

create or replace function public.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_role(p_org uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
  );
$$;

-- Billing is resolved at run time so core compiles (and self-hosted apps run)
-- without the hub's billing schema. If billing is on but the billing function
-- is missing, access is denied rather than granted.
create or replace function public.has_app_access(p_org uuid, p_app text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_result boolean;
begin
  select s.billing_enabled into v_enabled from public.instance_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return true;
  end if;
  if to_regprocedure('billing.org_has_app_access(uuid,text)') is null then
    return false;
  end if;
  execute 'select billing.org_has_app_access($1, $2)' into v_result using p_org, p_app;
  return coalesce(v_result, false);
end;
$$;

create or replace function public.can_write(p_org uuid, p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(p_org, '{owner,admin,member}'::public.org_role[])
     and public.has_app_access(p_org, p_app);
$$;

-- True when the caller shares an organization with p_user (profiles policy).
create or replace function public.shares_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

-- Internal helpers (not callable by clients) ----------------------------------

create or replace function public._require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

create or replace function public._clean_org_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'Organization names must be 1 to 120 characters.' using errcode = '22023';
  end if;
  return v_name;
end;
$$;

create or replace function public._token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- Organizations ------------------------------------------------------------

create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_name text := public._clean_org_name(p_name);
  v_base text;
  v_org uuid;
begin
  v_base := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 40), '-');
  if v_base = '' then
    v_base := 'org';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (v_name, v_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6), v_uid)
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  return v_org;
end;
$$;

create or replace function public.rename_organization(p_org uuid, p_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := public._clean_org_name(p_name);
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner or an admin can rename this organization.' using errcode = '42501';
  end if;
  update public.organizations set name = v_name where id = p_org;
end;
$$;

-- Deletes the org; every app table cascades through its org_id foreign key.
create or replace function public.delete_organization(p_org uuid, p_confirm_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can delete this organization.' using errcode = '42501';
  end if;
  select o.name into v_name from public.organizations o where o.id = p_org for update;
  if p_confirm_name is distinct from v_name then
    raise exception 'Type the organization''s name exactly to confirm.' using errcode = '22023';
  end if;
  delete from public.organizations where id = p_org;
end;
$$;

-- Ownership (§4.4) ---------------------------------------------------------

create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  if p_new_owner is null or p_new_owner = v_uid then
    raise exception 'Choose another member to become the owner.' using errcode = '22023';
  end if;
  perform 1 from public.memberships m
  where m.org_id = p_org and m.user_id = p_new_owner
  for update;
  if not found then
    raise exception 'The new owner must already be a member of this organization.' using errcode = '22023';
  end if;

  perform set_config('app.ownership_transfer', 'on', true);
  update public.memberships set role = 'admin' where org_id = p_org and user_id = v_uid;
  update public.memberships set role = 'owner' where org_id = p_org and user_id = p_new_owner;
  perform set_config('app.ownership_transfer', '', true);
end;
$$;

create or replace function public.ownership_transfer_candidates(p_org uuid)
returns table (user_id uuid, display_name text, email text, role public.org_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, u.email::text, m.role
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org and m.role <> 'owner'
    order by m.role, lower(coalesce(p.display_name, u.email::text));
end;
$$;

-- Owner guard: the owner only changes through transfer_ownership, can't be
-- removed (except when the whole org is deleted), and an org always has
-- exactly one owner.
create or replace function public._guard_owner_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer boolean := coalesce(current_setting('app.ownership_transfer', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.role = 'owner' and exists (
      select 1 from public.memberships m where m.org_id = new.org_id and m.role = 'owner'
    ) then
      raise exception 'This organization already has an owner.' using errcode = '23505';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role = 'owner' and (new.org_id <> old.org_id or new.user_id <> old.user_id) then
      raise exception 'Ownership can only change through a transfer.' using errcode = '42501';
    end if;
    if (old.role = 'owner') <> (new.role = 'owner') and not v_transfer then
      raise exception 'Ownership can only change through a transfer.' using errcode = '42501';
    end if;
    return new;
  else
    if old.role = 'owner' and not v_transfer
       and exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'The owner can''t leave or be removed. Transfer ownership first.' using errcode = '42501';
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists memberships_guard_owner on public.memberships;
create trigger memberships_guard_owner
  before insert or update or delete on public.memberships
  for each row execute function public._guard_owner_changes();

create or replace function public._check_exactly_one_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_owners int;
begin
  foreach v_org in array array_remove(array[
    case when tg_op <> 'INSERT' then old.org_id end,
    case when tg_op <> 'DELETE' then new.org_id end
  ], null)
  loop
    if exists (select 1 from public.organizations o where o.id = v_org) then
      select count(*) into v_owners
      from public.memberships m where m.org_id = v_org and m.role = 'owner';
      if v_owners <> 1 then
        raise exception 'An organization must have exactly one owner.' using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists memberships_exactly_one_owner on public.memberships;
create constraint trigger memberships_exactly_one_owner
  after insert or update or delete on public.memberships
  deferrable initially deferred
  for each row execute function public._check_exactly_one_owner();

-- Invitations (§4.3) ---------------------------------------------------------

create or replace function public.create_invitation(
  p_org uuid,
  p_email text,
  p_role public.org_role,
  p_app text default null,
  p_payload jsonb default '{}'::jsonb,
  p_days int default 14
)
returns table (invitation_id uuid, token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_token text;
  v_id uuid;
begin
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner or an admin can invite people.' using errcode = '42501';
  end if;
  if p_role is null and p_app is null then
    raise exception 'An invitation without a role must name an app.' using errcode = '22023';
  end if;
  if p_role = 'owner' then
    raise exception 'You can''t invite an owner. Invite them, then transfer ownership.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Invitations last between 1 and 90 days.' using errcode = '22023';
  end if;

  -- 244 bits from the server's strong random source; only the hash is stored.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (org_id, email, role, app, app_payload, token_hash, expires_at, invited_by)
  values (
    p_org, v_email, p_role, p_app, coalesce(p_payload, '{}'::jsonb),
    public._token_hash(v_token), now() + make_interval(days => p_days), v_uid
  )
  returning id into v_id;

  invitation_id := v_id;
  token := v_token;
  return next;
end;
$$;

-- Granted to anon: what an invitation page may show before sign-in. Nothing else.
create or replace function public.get_invitation(p_token text)
returns table (org_name text, role public.org_role, app text, email text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    i.role,
    i.app,
    case
      when i.email is null then null
      else left(split_part(i.email, '@', 1), 1) || '***@' || split_part(i.email, '@', 2)
    end,
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'used'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token_hash = public._token_hash(p_token);
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
    -- Existing members keep their current role.
    insert into public.memberships as m (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role)
    on conflict on constraint memberships_pkey do nothing;
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

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
begin
  perform public._require_uid();
  select * into v_inv from public.invitations i where i.id = p_id for update;
  if not found or not public.has_role(v_inv.org_id, '{owner,admin}'::public.org_role[]) then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'This invitation has already been used.' using errcode = '22023';
  end if;
  update public.invitations i set revoked_at = now() where i.id = p_id and i.revoked_at is null;
end;
$$;

create or replace function public.list_invitations(p_org uuid)
returns table (
  id uuid,
  email text,
  role public.org_role,
  app text,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
  invited_by uuid,
  invited_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner or an admin can see invitations.' using errcode = '42501';
  end if;
  return query
    select
      i.id, i.email, i.role, i.app,
      case
        when i.revoked_at is not null then 'revoked'
        when i.accepted_at is not null then 'used'
        when i.expires_at <= now() then 'expired'
        else 'pending'
      end,
      i.expires_at, i.created_at, i.invited_by, p.display_name
    from public.invitations i
    left join public.profiles p on p.id = i.invited_by
    where i.org_id = p_org
    order by i.created_at desc;
end;
$$;

-- Member directory -------------------------------------------------------------

create or replace function public.org_member_directory(p_org uuid)
returns table (user_id uuid, display_name text, email text, role public.org_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.is_member(p_org) then
    raise exception 'You''re not a member of this organization.' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, u.email::text, m.role
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.org_id = p_org
    order by m.role, lower(coalesce(p.display_name, u.email::text));
end;
$$;

-- New users ----------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email::text, ''), '@', 1), '')
    ), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for accounts created before this file ran (for example, sign-ups
-- between a first deploy and the first migration). Idempotent.
insert into public.profiles (id, display_name)
select
  u.id,
  left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email::text, ''), '@', 1), '')
  ), 120)
from auth.users u
on conflict (id) do nothing;

-- Execute privileges -------------------------------------------------------------

revoke all on function
  public.is_member(uuid),
  public.has_role(uuid, public.org_role[]),
  public.has_app_access(uuid, text),
  public.can_write(uuid, text),
  public.shares_org(uuid),
  public.create_organization(text),
  public.rename_organization(uuid, text),
  public.delete_organization(uuid, text),
  public.transfer_ownership(uuid, uuid),
  public.ownership_transfer_candidates(uuid),
  public.create_invitation(uuid, text, public.org_role, text, jsonb, int),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.list_invitations(uuid),
  public.org_member_directory(uuid),
  public._require_uid(),
  public._clean_org_name(text),
  public._token_hash(text),
  public._guard_owner_changes(),
  public._check_exactly_one_owner(),
  public.handle_new_user()
from public, anon, authenticated;

grant execute on function
  public.is_member(uuid),
  public.has_role(uuid, public.org_role[]),
  public.has_app_access(uuid, text),
  public.can_write(uuid, text),
  public.shares_org(uuid),
  public.create_organization(text),
  public.rename_organization(uuid, text),
  public.delete_organization(uuid, text),
  public.transfer_ownership(uuid, uuid),
  public.ownership_transfer_candidates(uuid),
  public.create_invitation(uuid, text, public.org_role, text, jsonb, int),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.revoke_invitation(uuid),
  public.list_invitations(uuid),
  public.org_member_directory(uuid)
to authenticated;

grant execute on function public.get_invitation(text) to anon;
