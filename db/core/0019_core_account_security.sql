-- Security review, round 3 (2026-11-14): account security.
--
-- 1. Confirm it's you, right before the most dangerous actions. Deleting an organization,
--    handing over ownership and deleting an account each need a one-time pass made seconds
--    earlier by typing your password (or a code we email you) and, if you use two-step sign-in,
--    your authenticator code. The pass works once, for that one action, and expires after five
--    minutes if it isn't used. This replaces 0018's "signed in within 15 minutes" rule.
-- 2. Two-step sign-in for everyone in an organization. The organization setting is now a level:
--    off, the owner and admins, or everyone. The owner and admins are always included when it's
--    on.
-- 3. A way back in when you lose your phone: ten one-time backup codes, and a recovery email
--    address that can receive a link. Either one removes two-step sign-in from your account (an
--    OpenAppHub server function does the removal) so you can set it up again. Every step is
--    emailed to you and recorded in your account's security activity.
--
-- Codes, links and passes are stored only as SHA-256 fingerprints. Everything stays in core so
-- self-hosted apps get it too; the parts that need the service role (removing an authenticator,
-- sending email straight away) are OpenAppHub server functions (SHARED-SPEC §7.2).

-- Does a given person have a verified authenticator? (Like 0018's _has_verified_factor, for
-- someone else: the organization panel counts who still needs to set one up.)
do $$
begin
  if to_regclass('auth.mfa_factors') is not null then
    execute $f$
      create or replace function public._user_has_verified_factor(p_user uuid)
      returns boolean language sql stable security definer set search_path = '' as $b$
        select exists (select 1 from auth.mfa_factors f
                       where f.user_id = p_user and f.status::text = 'verified');
      $b$;
    $f$;
    -- When the current authenticator was set up. Backup codes made before it don't count (they
    -- belonged to an authenticator that was removed).
    execute $f$
      create or replace function public._factor_since(p_user uuid)
      returns timestamptz language sql stable security definer set search_path = '' as $b$
        select max(f.created_at) from auth.mfa_factors f
        where f.user_id = p_user and f.status::text = 'verified';
      $b$;
    $f$;
    -- Re-defined here too, so a database whose stub gained auth.mfa_factors after 0018 ran
    -- (the hub's tests) checks the real table.
    execute $f$
      create or replace function public._has_verified_factor()
      returns boolean language sql stable security definer set search_path = '' as $b$
        select exists (select 1 from auth.mfa_factors f
                       where f.user_id = auth.uid() and f.status::text = 'verified');
      $b$;
    $f$;
  else
    execute $f$
      create or replace function public._user_has_verified_factor(p_user uuid)
      returns boolean language sql stable security definer set search_path = '' as $b$
        select false;
      $b$;
    $f$;
    execute $f$
      create or replace function public._factor_since(p_user uuid)
      returns timestamptz language sql stable security definer set search_path = '' as $b$
        select null::timestamptz;
      $b$;
    $f$;
  end if;
end $$;

-- A fingerprint of a secret, for storing.
create or replace function public._fingerprint(p_secret text)
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');
$$;

-- 32 random bytes, as hex (64 characters): for one-time passes and links.
create or replace function public._random_token()
returns text language sql volatile set search_path = '' as $$
  select encode(pg_catalog.sha256(pg_catalog.convert_to(
    gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
$$;

-- Was this session signed in with one of these methods in the last p_seconds? Supabase lists
-- each way the person proved who they are ("amr"), with its time. A session without the list
-- doesn't pass: this check fails closed.
create or replace function public._amr_fresh(p_methods text[], p_seconds int)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(public._jwt() -> 'amr') = 'array'
                                   then public._jwt() -> 'amr' else '[]'::jsonb end) a
    where a ->> 'method' = any (p_methods)
      and (a ->> 'timestamp') ~ '^[0-9]+$'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - greatest(p_seconds, 1)
  );
$$;

-- The account's security activity: what changed and when. Each person reads their own.
create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{3,40}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_user_idx
  on public.account_security_events (user_id, created_at desc);
alter table public.account_security_events enable row level security;
drop policy if exists account_security_events_own on public.account_security_events;
create policy account_security_events_own on public.account_security_events
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.account_security_events from public, anon, authenticated;
grant select on table public.account_security_events to authenticated;
grant all on table public.account_security_events to service_role;

create or replace function public._log_security_event(p_user uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.account_security_events (user_id, kind, detail)
  values (p_user, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

-- An essential email to the person (or to another address), from OpenAppHub.
-- Which app sends the security email: the one the person is using (its server passes it, so a
-- self-hosted app's own sender sends it and its links open that app), or OpenAppHub.
create or replace function public._security_app()
returns text language sql stable set search_path = '' as $$
  select case
    when nullif(pg_catalog.current_setting('app.security_app', true), '') in ('hub', 'charter', 'board', 'ledger')
      then pg_catalog.current_setting('app.security_app', true)
    when to_regnamespace('hub') is not null then 'hub'
    when to_regnamespace('charter') is not null then 'charter'
    when to_regnamespace('board') is not null then 'board'
    when to_regnamespace('ledger') is not null then 'ledger'
    else 'hub' end;
$$;

create or replace function public._use_security_app(p_app text)
returns void language sql volatile set search_path = '' as $$
  select pg_catalog.set_config('app.security_app', coalesce(p_app, ''), true);
$$;

create or replace function public._security_email(p_template text, p_user uuid, p_to_email text, p_data jsonb)
returns uuid language sql volatile security definer set search_path = '' as $$
  select public.enqueue_email(public._security_app(), p_template, null, p_user, p_to_email, p_data, 'essential', null, now());
$$;

-- Secrets in a security email are removed once it has been sent (or given up on).
create or replace function public._strip_email_secrets()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.template like 'account.%' and new.status in ('sent', 'failed', 'suppressed') then
    new.data := new.data - 'code' - 'token';
  end if;
  return new;
end;
$$;
drop trigger if exists email_outbox_strip_secrets on public.email_outbox;
create trigger email_outbox_strip_secrets before update of status on public.email_outbox
  for each row execute function public._strip_email_secrets();

-- 1. Confirm it's you ---------------------------------------------------------------------

create table if not exists public.reauth_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  action text not null,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists public.reauth_grants (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists reauth_grants_user_idx on public.reauth_grants (user_id);
alter table public.reauth_codes enable row level security;
alter table public.reauth_grants enable row level security;
revoke all on table public.reauth_codes, public.reauth_grants from public, anon, authenticated;
grant all on table public.reauth_codes, public.reauth_grants to service_role;

create or replace function public._reauth_action_ok(p_action text)
returns boolean language sql immutable set search_path = '' as $$
  select p_action in ('delete_organization', 'transfer_ownership', 'delete_account', 'recovery_settings');
$$;

-- Email a 6-digit code, for people who sign in with Google and have no password. At most five
-- an hour. The code works for ten minutes, for this action, with five tries.
create or replace function public.send_reauth_code(p_action text, p_app text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_code text;
begin
  perform public._use_security_app(p_app);
  if not public._reauth_action_ok(p_action) then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  if (select count(*) from public.account_security_events e
      where e.user_id = v_uid and e.kind = 'reauth_code_sent' and e.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes in the last hour. Wait a while, or use your password.' using errcode = '54000';
  end if;
  v_code := lpad(((('x' || substr(public._random_token(), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.reauth_codes as c (user_id, action, code_hash, attempts, created_at, expires_at)
  values (v_uid, p_action, public._fingerprint(v_uid::text || ':' || v_code), 0, now(), now() + interval '10 minutes')
  on conflict (user_id) do update set action = excluded.action, code_hash = excluded.code_hash,
    attempts = 0, created_at = now(), expires_at = excluded.expires_at;
  perform public._security_email('account.reauth_code', v_uid, null,
    jsonb_build_object('code', v_code, 'action', p_action));
  perform public._log_security_event(v_uid, 'reauth_code_sent', jsonb_build_object('action', p_action));
end;
$$;

-- Make the one-time pass. The session must have just proved who it is: a password typed in the
-- last two minutes (the confirm box signs in again in the background to check it), or the
-- emailed code passed here. With an authenticator, its code too, in the last five minutes.
-- Returns null when the emailed code is wrong (five tries per code).
create or replace function public.begin_reauth(p_action text, p_code text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_row public.reauth_codes;
  v_token text;
  v_proved boolean := false;
begin
  if not public._reauth_action_ok(p_action) then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    select * into v_row from public.reauth_codes c where c.user_id = v_uid for update;
    if not found or v_row.action <> p_action or v_row.expires_at < now() or v_row.attempts >= 5 then
      raise exception 'That code has expired. Send a new one.' using errcode = '42501', hint = 'reauthenticate';
    end if;
    if v_row.code_hash <> public._fingerprint(v_uid::text || ':' || btrim(p_code)) then
      -- No error here: an error would undo the count, and the five tries would never run out.
      -- The caller shows "That code isn't right" for null.
      update public.reauth_codes set attempts = attempts + 1 where user_id = v_uid;
      return null;
    end if;
    delete from public.reauth_codes where user_id = v_uid;
    v_proved := true;
  else
    v_proved := public._amr_fresh('{password}', 120);
  end if;
  if not v_proved then
    raise exception 'Type your password (or an emailed code) to confirm it''s you.' using errcode = '42501', hint = 'reauthenticate';
  end if;
  if public._has_verified_factor() and not (
       coalesce(public._jwt() ->> 'aal', 'aal1') = 'aal2'
       and public._amr_fresh('{totp,mfa/totp,mfa/phone,mfa/webauthn}', 300)) then
    raise exception 'Type the code from your authenticator app too.' using errcode = '42501', hint = 'mfa';
  end if;
  delete from public.reauth_grants g where g.user_id = v_uid and (g.expires_at < now() or g.action = p_action);
  v_token := public._random_token();
  insert into public.reauth_grants (token_hash, user_id, action, expires_at)
  values (public._fingerprint(v_token), v_uid, p_action, now() + interval '5 minutes');
  perform public._log_security_event(v_uid, 'reauthenticated', jsonb_build_object('action', p_action));
  return v_token;
end;
$$;

-- Use the pass: once, for its action, by the same person. The service role (the server's own
-- jobs) doesn't need one.
create or replace function public._use_reauth(p_action text, p_token text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(public._jwt() ->> 'role', '') = 'service_role' then
    return;
  end if;
  delete from public.reauth_grants g
  where g.token_hash = public._fingerprint(coalesce(p_token, ''))
    and g.user_id = auth.uid() and g.action = p_action and g.expires_at >= now();
  if not found then
    raise exception 'For your safety, confirm it''s you first.' using errcode = '42501', hint = 'reauthenticate';
  end if;
end;
$$;

-- Deleting an account happens on the server (the service role removes the sign-in), which first
-- uses the pass as the signed-in person through this.
create or replace function public.use_reauth(p_action text, p_token text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public._require_uid();
  if p_action <> 'delete_account' then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  perform public._use_reauth(p_action, p_token);
end;
$$;

-- Deleting an organization and handing over ownership now take the pass. The old versions
-- (without it) are removed, so nothing can call around the check.
drop function if exists public.delete_organization(uuid, text);
create or replace function public.delete_organization(p_org uuid, p_confirm_name text, p_reauth text default null)
returns void language plpgsql security definer set search_path = '' as $$
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
  perform public._use_reauth('delete_organization', p_reauth);
  delete from public.organizations where id = p_org;
end;
$$;

drop function if exists public.transfer_ownership(uuid, uuid, text);
drop function if exists public.transfer_ownership(uuid, uuid);
create or replace function public.transfer_ownership(
  p_org uuid, p_new_owner uuid, p_confirm text default null, p_reauth text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_expected text;
begin
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  if p_new_owner is null or p_new_owner = v_uid then
    raise exception 'Choose another member to become the owner.' using errcode = '22023';
  end if;
  -- OpenAppHub asks for the new owner's name to be typed; the apps' screens confirm in their own way.
  if p_confirm is not null then
    v_expected := public._member_confirm_text(p_new_owner);
    if v_expected is null or lower(btrim(p_confirm)) <> lower(btrim(v_expected)) then
      raise exception 'Type the new owner''s name exactly as shown to confirm.' using errcode = '22023';
    end if;
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
  perform public._use_reauth('transfer_ownership', p_reauth);

  perform set_config('app.ownership_transfer', 'on', true);
  update public.memberships set role = 'admin' where org_id = p_org and user_id = v_uid;
  update public.memberships set role = 'owner' where org_id = p_org and user_id = p_new_owner;
  perform set_config('app.ownership_transfer', '', true);
end;
$$;

-- 0018's time-based check isn't used any more.
drop function if exists public.assert_recent_sign_in(int);

-- 2. Two-step sign-in for everyone ----------------------------------------------------------

alter table public.org_role_settings add column if not exists mfa_required text not null default 'off';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_role_settings_mfa_required_check') then
    alter table public.org_role_settings add constraint org_role_settings_mfa_required_check
      check (mfa_required in ('off', 'admins', 'everyone'));
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'org_role_settings' and column_name = 'require_mfa_admins') then
    execute 'update public.org_role_settings set mfa_required = ''admins'' where require_mfa_admins and mfa_required = ''off''';
  end if;
end $$;

create or replace function public._org_mfa_level(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select s.mfa_required from public.org_role_settings s where s.org_id = p_org), 'off');
$$;

-- May this session act in p_org with this role? With an authenticator, only once signed in with
-- it. Without one, unless the organization requires it of everyone, or of owners and admins and
-- that's their role.
create or replace function public._mfa_ok_for(p_org uuid, p_role public.org_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is null
      or coalesce(public._jwt() ->> 'role', '') = 'service_role'
      or coalesce(public._jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not public._has_verified_factor()
          and case public._org_mfa_level(p_org)
                when 'everyone' then false
                when 'admins' then p_role not in ('owner', 'admin')
                else true end);
$$;

create or replace function public.my_mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_factor', public._has_verified_factor(),
    'aal', coalesce(public._jwt() ->> 'aal', 'aal1'),
    'blocked_orgs', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', o.id, 'name', o.name,
               'level', public._org_mfa_level(o.id),
               'reason', case when public._has_verified_factor() then 'code' else 'setup' end) order by o.name)
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and not public._mfa_ok_for(m.org_id, m.role)), '[]'::jsonb));
$$;

-- The setting, with how many people would still need to set it up.
create or replace function public.org_security_settings(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_member(p_org) then jsonb_build_object(
    'mfa_required', public._org_mfa_level(p_org),
    'can_change', public.has_role(p_org, '{owner,admin}'::public.org_role[]),
    'admins_without', (select count(*) from public.memberships m
                       where m.org_id = p_org and m.role in ('owner', 'admin')
                         and not public._user_has_verified_factor(m.user_id)),
    'members_without', (select count(*) from public.memberships m
                        where m.org_id = p_org and not public._user_has_verified_factor(m.user_id))) end;
$$;

drop function if exists public.set_org_require_mfa(uuid, boolean);
create or replace function public.set_org_mfa_level(p_org uuid, p_level text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_uid();
  if p_level not in ('off', 'admins', 'everyone') then
    raise exception 'Choose off, owner and admins, or everyone.' using errcode = '22023';
  end if;
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner and admins change security settings.' using errcode = '42501';
  end if;
  if p_level <> 'off' and coalesce(public._jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Set up two-step sign-in for yourself first (Account → Two-step sign-in), and sign in with your code.'
      using errcode = '42501';
  end if;
  insert into public.org_role_settings as s (org_id, mfa_required) values (p_org, p_level)
  on conflict (org_id) do update set mfa_required = excluded.mfa_required;
end;
$$;

alter table public.org_role_settings drop column if exists require_mfa_admins;

-- 3. Backup codes and a recovery email ------------------------------------------------------

create table if not exists public.mfa_recovery_codes (
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (user_id, code_hash)
);
create table if not exists public.account_recovery (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (email ~ '^[^\s<>()",;:@]+@[^\s<>()",;:@]+\.[^\s<>()",;:@]+$' and length(email) <= 254),
  verified_at timestamptz,
  verify_hash text,
  verify_expires timestamptz,
  link_hash text,
  link_expires timestamptz,
  updated_at timestamptz not null default now()
);
-- A recovery that passed (a backup code or a link), waiting for the server to remove the
-- authenticator. It lasts ten minutes.
create table if not exists public.mfa_recovery_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  method text not null check (method in ('backup_code', 'recovery_email')),
  expires_at timestamptz not null
);
alter table public.mfa_recovery_codes enable row level security;
alter table public.account_recovery enable row level security;
alter table public.mfa_recovery_grants enable row level security;
revoke all on table public.mfa_recovery_codes, public.account_recovery, public.mfa_recovery_grants
  from public, anon, authenticated;
grant all on table public.mfa_recovery_codes, public.account_recovery, public.mfa_recovery_grants to service_role;

create or replace function public._normalize_backup_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- What the account page shows: codes left, the recovery email and whether it's confirmed, and
-- the recent security activity.
create or replace function public.account_security_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'has_factor', public._has_verified_factor(),
    'codes_total', (select count(*) from public.mfa_recovery_codes c where c.user_id = auth.uid()
                      and c.created_at >= coalesce(public._factor_since(auth.uid()), '-infinity')),
    'codes_left', (select count(*) from public.mfa_recovery_codes c where c.user_id = auth.uid() and c.used_at is null
                     and c.created_at >= coalesce(public._factor_since(auth.uid()), '-infinity')),
    'codes_created_at', (select max(c.created_at) from public.mfa_recovery_codes c where c.user_id = auth.uid()
                           and c.created_at >= coalesce(public._factor_since(auth.uid()), '-infinity')),
    'recovery_email', (select r.email from public.account_recovery r where r.user_id = auth.uid()),
    'recovery_email_verified', coalesce((select r.verified_at is not null from public.account_recovery r where r.user_id = auth.uid()), false),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'at', e.created_at) order by e.created_at desc)
                        from (select * from public.account_security_events e
                              where e.user_id = auth.uid() order by e.created_at desc limit 20) e), '[]'::jsonb))
  where auth.uid() is not null;
$$;

-- Ten new backup codes (the old ones stop working). Needs a session signed in with the
-- authenticator, with a code typed in the last five minutes. The codes are shown once; only
-- fingerprints are kept.
create or replace function public.create_recovery_codes()
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_codes text[] := '{}';
  v_raw bytea;
  v_code text;
begin
  if not public._has_verified_factor() or coalesce(public._jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Set up two-step sign-in and sign in with your code first.' using errcode = '42501';
  end if;
  -- A code typed in the last five minutes, so a session left signed in can't make new codes.
  if not public._amr_fresh('{totp,mfa/totp,mfa/phone,mfa/webauthn}', 300) then
    raise exception 'Type a code from your authenticator app first.' using errcode = '42501', hint = 'mfa';
  end if;
  delete from public.mfa_recovery_codes where user_id = v_uid;
  for i in 1..10 loop
    v_raw := pg_catalog.sha256(pg_catalog.convert_to(public._random_token(), 'UTF8'));
    v_code := '';
    for j in 0..9 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_raw, j) % 32) + 1, 1);
    end loop;
    v_code := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
    v_codes := v_codes || v_code;
    insert into public.mfa_recovery_codes (user_id, code_hash)
    values (v_uid, public._fingerprint(v_uid::text || ':' || public._normalize_backup_code(v_code)));
  end loop;
  perform public._log_security_event(v_uid, 'backup_codes_created');
  return v_codes;
end;
$$;

-- Too many wrong recovery tries in the last hour?
create or replace function public._recovery_locked(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.account_security_events e
          where e.user_id = p_uid and e.kind = 'recovery_failed'
            and e.created_at > now() - interval '1 hour') >= 10;
$$;

-- Use a backup code (signed in with a password, without the authenticator). True when it
-- worked: the server then removes the authenticator and calls finish_two_step_recovery.
create or replace function public.use_recovery_code(p_code text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not public._has_verified_factor() then
    raise exception 'This account doesn''t use two-step sign-in.' using errcode = '22023';
  end if;
  if public._recovery_locked(v_uid) then
    raise exception 'Too many tries. Wait an hour, then try again.' using errcode = '54000';
  end if;
  update public.mfa_recovery_codes c set used_at = now()
  where c.user_id = v_uid and c.used_at is null
    and c.created_at >= coalesce(public._factor_since(v_uid), '-infinity')
    and c.code_hash = public._fingerprint(v_uid::text || ':' || public._normalize_backup_code(p_code));
  if not found then
    perform public._log_security_event(v_uid, 'recovery_failed', jsonb_build_object('method', 'backup_code'));
    return false;
  end if;
  insert into public.mfa_recovery_grants as g (user_id, method, expires_at)
  values (v_uid, 'backup_code', now() + interval '10 minutes')
  on conflict (user_id) do update set method = excluded.method, expires_at = excluded.expires_at;
  perform public._log_security_event(v_uid, 'backup_code_used');
  return true;
end;
$$;

-- Add, change or remove (null) the recovery email. It needs the one-time pass, and the new
-- address gets a link to confirm it before it can be used. The account's own email is told.
create or replace function public.set_recovery_email(p_email text, p_reauth text, p_app text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_primary text;
  v_token text;
begin
  perform public._use_security_app(p_app);
  perform public._use_reauth('recovery_settings', p_reauth);
  select lower(u.email::text) into v_primary from auth.users u where u.id = v_uid;
  if v_email is null then
    delete from public.account_recovery where user_id = v_uid;
    perform public._log_security_event(v_uid, 'recovery_email_removed');
    perform public._security_email('account.security_notice', v_uid, null,
      jsonb_build_object('event', 'recovery_email_removed'));
    return;
  end if;
  if v_email !~ '^[^\s<>()",;:@]+@[^\s<>()",;:@]+\.[^\s<>()",;:@]+$' or length(v_email) > 254 then
    raise exception 'Enter one email address, like name@example.org.' using errcode = '22023';
  end if;
  if v_email = v_primary then
    raise exception 'Use a different address from the one you sign in with.' using errcode = '22023';
  end if;
  v_token := public._random_token();
  insert into public.account_recovery as r (user_id, email, verified_at, verify_hash, verify_expires, link_hash, link_expires, updated_at)
  values (v_uid, v_email, null, public._fingerprint(v_token), now() + interval '24 hours', null, null, now())
  on conflict (user_id) do update set email = excluded.email, verified_at = null,
    verify_hash = excluded.verify_hash, verify_expires = excluded.verify_expires,
    link_hash = null, link_expires = null, updated_at = now();
  perform public._security_email('account.recovery_verify', v_uid, v_email, jsonb_build_object('token', v_token));
  perform public._security_email('account.security_notice', v_uid, null,
    jsonb_build_object('event', 'recovery_email_set', 'email', v_email));
  perform public._log_security_event(v_uid, 'recovery_email_set', jsonb_build_object('email', v_email));
end;
$$;

create or replace function public.verify_recovery_email(p_token text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.account_recovery r set verified_at = now(), verify_hash = null, verify_expires = null, updated_at = now()
  where r.user_id = v_uid and r.verify_hash = public._fingerprint(coalesce(p_token, ''))
    and r.verify_expires >= now();
  if not found then
    return false;
  end if;
  perform public._log_security_event(v_uid, 'recovery_email_verified');
  return true;
end;
$$;

-- Send a recovery link to the confirmed recovery email (signed in with a password, without the
-- authenticator). At most three an hour; the link works once, for 30 minutes. The account's own
-- email is told too, so a stranger can't do this quietly.
create or replace function public.send_recovery_link(p_app text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_rec public.account_recovery;
  v_token text;
begin
  perform public._use_security_app(p_app);
  if not public._has_verified_factor() then
    raise exception 'This account doesn''t use two-step sign-in.' using errcode = '22023';
  end if;
  select * into v_rec from public.account_recovery r where r.user_id = v_uid and r.verified_at is not null;
  if not found then
    raise exception 'There''s no confirmed recovery email on this account. Use a backup code instead.' using errcode = '22023';
  end if;
  if (select count(*) from public.account_security_events e
      where e.user_id = v_uid and e.kind = 'recovery_link_sent' and e.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many links in the last hour. Check your recovery email, or wait a while.' using errcode = '54000';
  end if;
  v_token := public._random_token();
  update public.account_recovery set link_hash = public._fingerprint(v_token),
    link_expires = now() + interval '30 minutes', updated_at = now() where user_id = v_uid;
  perform public._security_email('account.recovery_link', v_uid, v_rec.email, jsonb_build_object('token', v_token));
  perform public._security_email('account.security_notice', v_uid, null, jsonb_build_object('event', 'recovery_link_sent'));
  perform public._log_security_event(v_uid, 'recovery_link_sent');
end;
$$;

create or replace function public.use_recovery_link(p_token text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
begin
  if public._recovery_locked(v_uid) then
    raise exception 'Too many tries. Wait an hour, then try again.' using errcode = '54000';
  end if;
  update public.account_recovery r set link_hash = null, link_expires = null, updated_at = now()
  where r.user_id = v_uid and r.verified_at is not null
    and r.link_hash = public._fingerprint(coalesce(p_token, '')) and r.link_expires >= now();
  if not found then
    perform public._log_security_event(v_uid, 'recovery_failed', jsonb_build_object('method', 'recovery_email'));
    return false;
  end if;
  insert into public.mfa_recovery_grants as g (user_id, method, expires_at)
  values (v_uid, 'recovery_email', now() + interval '10 minutes')
  on conflict (user_id) do update set method = excluded.method, expires_at = excluded.expires_at;
  return true;
end;
$$;

-- After the server removed the authenticator: clear the backup codes (they went with it),
-- record it, and tell the person at both addresses.
create or replace function public.finish_two_step_recovery(p_app text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public._require_uid();
  v_method text;
  v_recovery text;
begin
  perform public._use_security_app(p_app);
  delete from public.mfa_recovery_grants g where g.user_id = v_uid and g.expires_at >= now()
  returning g.method into v_method;
  if v_method is null then
    raise exception 'Start again from "Can''t use your authenticator app?".' using errcode = '42501';
  end if;
  if public._has_verified_factor() then
    raise exception 'Two-step sign-in is still on for this account.' using errcode = '55000';
  end if;
  delete from public.mfa_recovery_codes where user_id = v_uid;
  select r.email into v_recovery from public.account_recovery r where r.user_id = v_uid and r.verified_at is not null;
  perform public._log_security_event(v_uid, 'two_step_removed', jsonb_build_object('method', v_method));
  perform public._security_email('account.security_notice', v_uid, null,
    jsonb_build_object('event', 'two_step_removed', 'method', v_method));
  if v_recovery is not null then
    perform public._security_email('account.security_notice', v_uid, v_recovery,
      jsonb_build_object('event', 'two_step_removed', 'method', v_method));
  end if;
  return v_method;
end;
$$;

-- Access -----------------------------------------------------------------------------------

revoke all on function
  public._user_has_verified_factor(uuid), public._factor_since(uuid), public._fingerprint(text), public._random_token(),
  public._amr_fresh(text[], int), public._log_security_event(uuid, text, jsonb),
  public._security_email(text, uuid, text, jsonb), public._strip_email_secrets(),
  public._security_app(), public._use_security_app(text),
  public._reauth_action_ok(text), public._use_reauth(text, text), public._org_mfa_level(uuid),
  public._normalize_backup_code(text), public._recovery_locked(uuid)
from public, anon, authenticated;

revoke all on function
  public.send_reauth_code(text, text), public.begin_reauth(text, text), public.use_reauth(text, text),
  public.delete_organization(uuid, text, text), public.transfer_ownership(uuid, uuid, text, text),
  public.set_org_mfa_level(uuid, text), public.account_security_status(),
  public.create_recovery_codes(), public.use_recovery_code(text), public.set_recovery_email(text, text, text),
  public.verify_recovery_email(text), public.send_recovery_link(text), public.use_recovery_link(text),
  public.finish_two_step_recovery(text)
from public, anon;
grant execute on function
  public.send_reauth_code(text, text), public.begin_reauth(text, text), public.use_reauth(text, text),
  public.delete_organization(uuid, text, text), public.transfer_ownership(uuid, uuid, text, text),
  public.set_org_mfa_level(uuid, text), public.account_security_status(),
  public.create_recovery_codes(), public.use_recovery_code(text), public.set_recovery_email(text, text, text),
  public.verify_recovery_email(text), public.send_recovery_link(text), public.use_recovery_link(text),
  public.finish_two_step_recovery(text)
to authenticated, service_role;

select public._tune_schema('public');
