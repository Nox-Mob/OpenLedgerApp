-- OpenAppHub core: tables (SHARED-SPEC §3.2).
-- Canonical copy lives in Nox-Mob/OpenAppHub db/core/; apps vendor it read-only.
-- Idempotent: the same file runs on the shared hosted database and on
-- self-hosted single-app databases. Never edit after it has been applied;
-- add a new numbered file and bump shared/VERSION.

-- Roles ---------------------------------------------------------------------

do $$
begin
  create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
exception
  when duplicate_object then null;
end
$$;

-- Instance settings (single row) --------------------------------------------

create table if not exists public.instance_settings (
  id boolean primary key default true check (id),
  billing_enabled boolean not null default false,
  hub_url text
);

insert into public.instance_settings (id) values (true) on conflict (id) do nothing;

-- Organizations: THE shared org ID ------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists organizations_created_by_idx on public.organizations (created_by);

-- Memberships ----------------------------------------------------------------

create table if not exists public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists memberships_user_id_idx on public.memberships (user_id);

-- Exactly one owner per org: at most one here; "at least one" is a deferred
-- constraint trigger in 0002.
create unique index if not exists memberships_one_owner_idx
  on public.memberships (org_id)
  where role = 'owner';

-- Profiles -------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  avatar_url text,
  updated_at timestamptz not null default now()
);

-- Invitations (§4.3) ----------------------------------------------------------
-- role null = app-only invitation (e.g. a Charter portal member): accepting it
-- creates no core membership. Only the SHA-256 hash of the token is stored.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text check (email is null or email = lower(btrim(email))),
  role public.org_role check (role is distinct from 'owner'),
  app text check (app is null or app ~ '^[a-z][a-z0-9_]*$'),
  app_payload jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  expires_at timestamptz not null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint invitations_role_or_app check (role is not null or app is not null)
);

create index if not exists invitations_org_id_idx on public.invitations (org_id);

-- Row level security and grants ---------------------------------------------
-- Writes go through the definer functions in 0002; policies are in 0003.

alter table public.instance_settings enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;

revoke all on table
  public.instance_settings, public.organizations, public.memberships,
  public.profiles, public.invitations
from public, anon, authenticated;

grant select on table public.instance_settings to authenticated;
grant select on table public.organizations to authenticated;
grant select, delete on table public.memberships to authenticated;
grant update (role) on table public.memberships to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on table public.profiles to authenticated;
grant select on table public.invitations to authenticated;

grant all on table
  public.instance_settings, public.organizations, public.memberships,
  public.profiles, public.invitations
to service_role;
