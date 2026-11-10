-- Test helpers. Tests run as the database superuser and switch to the
-- `authenticated` / `anon` roles with tests.as_user() / tests.as_anon().
-- Each test file wraps its work in begin … rollback.

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.create_user(p_email text, p_meta jsonb default '{}'::jsonb, p_confirmed boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (v_id, p_email, p_meta, case when p_confirmed then now() end);
  return v_id;
end $$;

create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.as_super() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAILED: %', p_msg;
  end if;
end $$;

-- Asserts that p_sql raises an error (optionally matching p_like, case-insensitive).
create or replace function tests.throws(p_sql text, p_msg text, p_like text default null)
returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_err = message_text;
    if p_like is not null and v_err not ilike '%' || p_like || '%' then
      raise exception 'FAILED: % (wrong error: %)', p_msg, v_err;
    end if;
    return;
  end;
  raise exception 'FAILED: % (no error raised)', p_msg;
end $$;

-- Number of rows p_sql returns, as the current role.
create or replace function tests.count(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from (%s) q', p_sql) into v;
  return v;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Simulates the hub's billing for one test (inside its transaction): billing on,
-- and the listed organizations have lapsed (read-only). Core's has_app_access()
-- resolves billing.org_has_app_access at run time (spec §3.2, §5).
create or replace function tests.lapse(p_org uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  create schema if not exists billing;
  create table if not exists billing.test_lapsed (org_id uuid primary key);
  insert into billing.test_lapsed values (p_org) on conflict do nothing;
  create or replace function billing.org_has_app_access(p_org uuid, p_app text) returns boolean
    language sql stable security definer set search_path = '' as
    $f$ select not exists (select 1 from billing.test_lapsed l where l.org_id = p_org) $f$;
  update public.instance_settings set billing_enabled = true;
end $$;

-- A member with a core role (superuser insert, as invitations would).
create or replace function tests.add_member(p_org uuid, p_user uuid, p_role public.org_role) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  insert into public.memberships (org_id, user_id, role) values (p_org, p_user, p_role);
end $$;

grant execute on all functions in schema tests to anon, authenticated;
