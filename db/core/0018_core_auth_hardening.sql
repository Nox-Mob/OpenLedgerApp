-- Security review, round 2 (2026-11-14): authentication, enforced by the database.
--
-- 1. Two-step sign-in means something everywhere. Someone who set up an authenticator app must
--    sign in with its code (Supabase's "aal2") before they can use any organization's data. A
--    password alone (a stolen one, say) opens nothing. Before this, only OpenLedgerApp checked.
-- 2. An organization can require two-step sign-in for its owner and admins. Until they sign in
--    with a code, they can't use that organization.
-- 3. The most dangerous actions (deleting an organization, handing over ownership, deleting an
--    account) need a sign-in from the last 15 minutes, so a computer someone left signed in
--    can't be used for them.
--
-- All of this lives in the central checks every app uses (is_member, has_role, app_role), so it
-- applies in OpenAppHub, OpenCharterApp, OpenBoardApp and OpenLedgerApp at once.

-- The session's claims (what Supabase's auth.jwt() returns), defined here so every database
-- has it, including the apps' test stubs.
create or replace function public._jwt()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- Does the signed-in person have a verified authenticator? (Supabase keeps them in
-- auth.mfa_factors; a database without it, like the test stubs, has none.)
do $$
begin
  if to_regclass('auth.mfa_factors') is not null then
    execute $f$
      create or replace function public._has_verified_factor()
      returns boolean language sql stable security definer set search_path = '' as $b$
        select exists (select 1 from auth.mfa_factors f
                       where f.user_id = auth.uid() and f.status::text = 'verified');
      $b$;
    $f$;
  else
    execute $f$
      create or replace function public._has_verified_factor()
      returns boolean language sql stable security definer set search_path = '' as $b$
        select false;
      $b$;
    $f$;
  end if;
end $$;

-- The organization's security settings: require two-step sign-in for owners and admins.
alter table public.org_role_settings add column if not exists require_mfa_admins boolean not null default false;

-- May this session act in p_org with this role? True for the service role and for anonymous
-- checks (which find nothing anyway); otherwise the session must be "aal2" (signed in with a
-- code) when the person has an authenticator, or when the organization requires it of owners
-- and admins and that's their role.
create or replace function public._mfa_ok_for(p_org uuid, p_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
      or coalesce(public._jwt() ->> 'role', '') = 'service_role'
      or coalesce(public._jwt() ->> 'aal', 'aal1') = 'aal2'
      or (not public._has_verified_factor()
          and not (p_role in ('owner', 'admin')
                   and coalesce((select s.require_mfa_admins from public.org_role_settings s
                                 where s.org_id = p_org), false)));
$$;

-- The central checks, with the two-step rule.
create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and public._mfa_ok_for(p_org, m.role)
  );
$$;

create or replace function public.has_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)
      and public._mfa_ok_for(p_org, m.role)
  );
$$;

create or replace function public.is_member_of_child(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations c
    join public.memberships m on m.org_id = c.id and m.user_id = auth.uid()
    where c.parent_org_id = p_org and public._mfa_ok_for(c.id, m.role)
  );
$$;

create or replace function public.app_role(p_org uuid, p_app text, p_user uuid default auth.uid())
returns public.org_role language sql stable security definer set search_path = '' as $$
  select case
    -- The person asking about themselves must meet the two-step rule (asking about someone
    -- else, as the Members page does, describes their role as it is).
    when p_user = auth.uid() and not public._mfa_ok_for(p_org, m.role) then null
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

-- What the signed-in person needs to know about two-step sign-in, for the apps' screens:
-- whether they have an authenticator, whether this session used it, and which of their
-- organizations are waiting for a code (or for them to set one up).
create or replace function public.my_mfa_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'has_factor', public._has_verified_factor(),
    'aal', coalesce(public._jwt() ->> 'aal', 'aal1'),
    'blocked_orgs', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', o.id, 'name', o.name,
               'reason', case when public._has_verified_factor() then 'code' else 'setup' end) order by o.name)
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid() and not public._mfa_ok_for(m.org_id, m.role)), '[]'::jsonb));
$$;

-- The setting, read and changed by the owner and OpenAppHub admins. Turning it on needs the
-- person doing it to be signed in with a code themselves, so nobody locks themselves out.
create or replace function public.org_security_settings(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_member(p_org) then jsonb_build_object(
    'require_mfa_admins', coalesce((select s.require_mfa_admins from public.org_role_settings s where s.org_id = p_org), false),
    'can_change', public.has_role(p_org, '{owner,admin}'::public.org_role[])) end;
$$;

create or replace function public.set_org_require_mfa(p_org uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner and admins change security settings.' using errcode = '42501';
  end if;
  if p_on and coalesce(public._jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Set up two-step sign-in for yourself first (Account → Two-step sign-in), and sign in with your code.'
      using errcode = '42501';
  end if;
  insert into public.org_role_settings as s (org_id, require_mfa_admins) values (p_org, p_on)
  on conflict (org_id) do update set require_mfa_admins = excluded.require_mfa_admins;
end;
$$;

-- A sign-in in the last p_minutes, for dangerous actions. Supabase lists how the person signed
-- in ("amr": password, code, magic link…) with the time of each; the newest counts. A token
-- without amr comes only from tests (Supabase always sets it); the service role is the server.
create or replace function public.assert_recent_sign_in(p_minutes int default 15)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest bigint;
begin
  if coalesce(public._jwt() ->> 'role', '') = 'service_role' or public._jwt() -> 'amr' is null then
    return;
  end if;
  select max((a ->> 'timestamp')::bigint) into v_latest
  from jsonb_array_elements(case when jsonb_typeof(public._jwt() -> 'amr') = 'array' then public._jwt() -> 'amr' else '[]'::jsonb end) a;
  if v_latest is null or v_latest < extract(epoch from now())::bigint - greatest(p_minutes, 1) * 60 then
    raise exception 'For your safety, sign out and sign in again, then try this within % minutes.', greatest(p_minutes, 1)
      using errcode = '42501', hint = 'reauthenticate';
  end if;
end;
$$;

create or replace function public.delete_organization(p_org uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  perform public._require_uid();
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can delete this organization.' using errcode = '42501';
  end if;
  perform public.assert_recent_sign_in(15);
  select o.name into v_name from public.organizations o where o.id = p_org for update;
  if p_confirm_name is distinct from v_name then
    raise exception 'Type the organization''s name exactly to confirm.' using errcode = '22023';
  end if;
  delete from public.organizations where id = p_org;
end;
$$;

-- Handing over ownership: also a recent sign-in (both ways of calling it go through this one).
create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := public._require_uid();
begin
  if not public.has_role(p_org, '{owner}'::public.org_role[]) then
    raise exception 'Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  perform public.assert_recent_sign_in(15);
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
$function$;

revoke all on function public._has_verified_factor(), public._mfa_ok_for(uuid, public.org_role), public._jwt()
  from public, anon, authenticated;
revoke all on function public.my_mfa_status(), public.org_security_settings(uuid),
  public.set_org_require_mfa(uuid, boolean), public.assert_recent_sign_in(int) from public, anon;
grant execute on function public.my_mfa_status(), public.org_security_settings(uuid),
  public.set_org_require_mfa(uuid, boolean), public.assert_recent_sign_in(int) to authenticated;


-- The functions visitors may call before signing in: an invitation by its token (the invitation
-- page), joining the waitlist, and, on a self-hosted install only, OpenCharterApp's public join
-- page (Charter grants those two only when billing is off; hosted, joining starts with signing
-- in). Anything else needs a signed-in person (A01, least privilege).
create or replace function public._anon_allowed_functions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['public.get_invitation(text)', 'public.hub_join_waitlist(text,text)',
               'charter.public_join_info(text)', 'charter.public_home_chapter_info(text)'];
$$;

-- Tuning, step 3 added: functions are for signed-in people unless they're on the allow-list.
create or replace function public._tune_schema(p_schema text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_q text;
  v_w text;
  v_sql text;
  v_name text;
  -- A bare call, not already inside "( SELECT auth.uid() AS uid)".
  c_bare constant text := '(?<!SELECT )auth\.(uid|jwt|role)\(\)';
begin
  -- 1. Policies. pg_policies shows each expression fully qualified (search_path is empty here).
  for r in
    select p.schemaname, p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    from pg_catalog.pg_policies p
    where p.schemaname = p_schema
      and (coalesce(p.qual, '') ~ c_bare or coalesce(p.with_check, '') ~ c_bare)
  loop
    v_q := pg_catalog.regexp_replace(r.qual, c_bare, '(select auth.\1())', 'g');
    v_w := pg_catalog.regexp_replace(r.with_check, c_bare, '(select auth.\1())', 'g');
    v_sql := pg_catalog.format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_q is not null then v_sql := v_sql || pg_catalog.format(' using (%s)', v_q); end if;
    if v_w is not null then v_sql := v_sql || pg_catalog.format(' with check (%s)', v_w); end if;
    execute v_sql;
  end loop;

  -- 2. Foreign keys without an index whose leading columns are the key's columns.
  for r in
    select c.conrelid, cl.relname as tbl, c.conname, c.conkey,
           (select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by k.ord)
            from pg_catalog.unnest(c.conkey) with ordinality k(attnum, ord)
            join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select bool_and(not a.attnotnull) from pg_catalog.pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as nullable
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = p_schema
      and not exists (
        select 1 from pg_catalog.pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] <@ c.conkey)
  loop
    v_name := pg_catalog.left(r.tbl || '_' || pg_catalog.replace(pg_catalog.replace(r.cols, '"', ''), ', ', '_'), 56) || '_fk_idx';
    v_sql := pg_catalog.format('create index if not exists %I on %I.%I (%s)', v_name, p_schema, r.tbl, r.cols);
    if r.nullable and pg_catalog.array_length(r.conkey, 1) = 1 then
      v_sql := v_sql || pg_catalog.format(' where %s is not null', r.cols);
    end if;
    execute v_sql;
  end loop;
  -- 3. Functions: Postgres lets everyone (PUBLIC, so also anonymous visitors) run a new function
  --    unless told otherwise. Only the allow-list below is for visitors who aren't signed in;
  --    every other function keeps exactly the signed-in and server access it had.
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = p_schema and p.prokind = 'f'
      and p.prorettype not in ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.oid::regprocedure::text <> all (public._anon_allowed_functions())
  loop
    if pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      execute pg_catalog.format('grant execute on function %s to authenticated', r.sig);
    end if;
    if pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE') then
      execute pg_catalog.format('grant execute on function %s to service_role', r.sig);
    end if;
    execute pg_catalog.format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end;
$$;

-- And what's left to tune now includes functions anonymous visitors can call.
create or replace function public.tuning_problems(p_schema text)
returns table (kind text, object text)
language sql
stable
set search_path = ''
as $$
  select 'policy calls auth per row', p.tablename || ': ' || p.policyname
  from pg_catalog.pg_policies p
  where p.schemaname = p_schema
    and (coalesce(p.qual, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)'
         or coalesce(p.with_check, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)')
  union all
  select 'foreign key without an index', cl.relname || ': ' || c.conname
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class cl on cl.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
  where c.contype = 'f' and n.nspname = p_schema
    and not exists (
      select 1 from pg_catalog.pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] @> c.conkey
        and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] <@ c.conkey)
  union all
  select 'more than one permissive policy', x.tablename || ': ' || x.role || ' ' || x.action || ' (' || x.names || ')'
  from (
    select p.tablename, r.role, a.action, pg_catalog.string_agg(p.policyname, ', ' order by p.policyname) as names
    from pg_catalog.pg_policies p
    cross join lateral pg_catalog.unnest(p.roles) r(role)
    cross join lateral pg_catalog.unnest(case when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                                              else array[p.cmd] end) a(action)
    where p.schemaname = p_schema and p.permissive = 'PERMISSIVE'
    group by p.tablename, r.role, a.action
    having count(*) > 1
  ) x
  union all
  select 'callable without signing in', p.oid::regprocedure::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = p_schema and p.prokind = 'f'
    and p.prorettype not in ('pg_catalog.trigger'::pg_catalog.regtype, 'pg_catalog.event_trigger'::pg_catalog.regtype)
    and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.oid::regprocedure::text <> all (public._anon_allowed_functions());
$$;

revoke all on function public._tune_schema(text), public.tuning_problems(text), public._anon_allowed_functions()
  from public, anon, authenticated;

select public._tune_schema('public');
