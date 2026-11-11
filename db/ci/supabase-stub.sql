-- Minimal stand-in for the parts of Supabase that core SQL and Ledger rely on, so the
-- migrations and DB tests run on plain Postgres (CI, scripts/db-test.sh). Every statement
-- is guarded: on a real Supabase database this changes nothing. Never used in production.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255),
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
-- Present on real Supabase; added here for the stub (the staging seed writes them).
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists instance_id uuid;
alter table auth.users add column if not exists aud varchar(255);
alter table auth.users add column if not exists role varchar(255);
alter table auth.users add column if not exists encrypted_password varchar(255);
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists updated_at timestamptz;
alter table auth.users add column if not exists confirmation_token varchar(255);
alter table auth.users add column if not exists recovery_token varchar(255);
alter table auth.users add column if not exists email_change_token_new varchar(255);
alter table auth.users add column if not exists email_change varchar(255);
alter table auth.users add column if not exists email_change_token_current varchar(255);
alter table auth.users add column if not exists reauthentication_token varchar(255);
alter table auth.users add column if not exists phone_change text;
alter table auth.users add column if not exists phone_change_token varchar(255);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unique (provider_id, provider)
);
-- pgcrypto in schema extensions, as on Supabase (the seed hashes the demo password).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid language sql stable as $f$
      select nullif(
        coalesce(
          current_setting('request.jwt.claim.sub', true),
          current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
        ),
        ''
      )::uuid
    $f$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  end if;
end
$$;

-- Supabase Storage, as far as policies need it.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
do $$
begin
  if to_regprocedure('storage.foldername(text)') is null then
    create function storage.foldername(name text) returns text[] language sql immutable as $f$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    $f$;
  end if;
end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- auth.role() and auth.jwt(): Ledger's two-step sign-in check reads them.
do $$
begin
  if to_regprocedure('auth.role()') is null then
    create function auth.role() returns text language sql stable as $f$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user::text)
    $f$;
    grant execute on function auth.role() to anon, authenticated, service_role;
  end if;
  if to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb language sql stable as $f$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $f$;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
  end if;
end
$$;

-- auth.users columns present on real Supabase that Ledger's tests fill in.
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud varchar(255),
  add column if not exists role varchar(255),
  add column if not exists confirmation_token varchar(255),
  add column if not exists recovery_token varchar(255),
  add column if not exists email_change_token_new varchar(255),
  add column if not exists email_change varchar(255);
