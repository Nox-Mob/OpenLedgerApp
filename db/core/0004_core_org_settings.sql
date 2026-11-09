-- OpenAppHub core: organization preferences and a stricter ownership transfer.
-- Idempotent (runs on the shared database and on self-hosted app databases).

-- Organization time zone and currency -----------------------------------------
-- Every app shows dates in the organization's time zone and money in its
-- currency (shared/format.ts). They live on the organization so all apps agree.

alter table public.organizations
  add column if not exists time_zone text not null default 'UTC',
  add column if not exists currency text not null default 'USD';

do $$
begin
  alter table public.organizations
    add constraint organizations_currency_check check (currency ~ '^[A-Z]{3}$');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.set_organization_preferences(p_org uuid, p_time_zone text, p_currency text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner or an admin can change these settings.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose a time zone from the list.' using errcode = '22023';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a currency from the list.' using errcode = '22023';
  end if;
  update public.organizations set time_zone = p_time_zone, currency = v_currency where id = p_org;
end;
$$;

-- Ownership transfer: active members only, confirmed by typing their name -------
-- "Active" = the account has confirmed its email and isn't banned. The confirm
-- text is the member's display name, or their email when they have no name.

create or replace function public._member_confirm_text(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.display_name), ''), u.email::text)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user;
$$;

create or replace function public._is_active_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until < now())
  );
$$;

-- Same columns as before (re-running older core files must keep working); now
-- only active members. Show them by name, or email when they have none: that
-- is also what the three-argument transfer below expects to be typed.
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
    where m.org_id = p_org and m.role <> 'owner' and public._is_active_user(m.user_id)
    order by m.role, lower(coalesce(p.display_name, u.email::text));
end;
$$;

-- Two-argument form (kept for apps): now also requires an active member.
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
  if not public._is_active_user(p_new_owner) then
    raise exception 'The new owner must have an active account (email confirmed).' using errcode = '22023';
  end if;

  perform set_config('app.ownership_transfer', 'on', true);
  update public.memberships set role = 'admin' where org_id = p_org and user_id = v_uid;
  update public.memberships set role = 'owner' where org_id = p_org and user_id = p_new_owner;
  perform set_config('app.ownership_transfer', '', true);
end;
$$;

-- Three-argument form: the caller must type the new owner's name (or email when
-- they have none), ignoring case and surrounding spaces.
create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid, p_confirm text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expected text := public._member_confirm_text(p_new_owner);
begin
  if v_expected is null
     or lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(v_expected)) then
    raise exception 'Type the new owner''s name exactly as shown to confirm.' using errcode = '22023';
  end if;
  perform public.transfer_ownership(p_org, p_new_owner);
end;
$$;

revoke all on function
  public.set_organization_preferences(uuid, text, text),
  public._member_confirm_text(uuid),
  public._is_active_user(uuid),
  public.ownership_transfer_candidates(uuid),
  public.transfer_ownership(uuid, uuid),
  public.transfer_ownership(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.set_organization_preferences(uuid, text, text),
  public.ownership_transfer_candidates(uuid),
  public.transfer_ownership(uuid, uuid),
  public.transfer_ownership(uuid, uuid, text)
to authenticated;
