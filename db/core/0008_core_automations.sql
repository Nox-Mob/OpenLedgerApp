-- OpenAppHub core: the automation engine, first part (S-25). Idempotent; runs hosted and
-- self-hosted.
--
-- Schedules and automations people may want to change live here, instead of being fixed in each
-- app's jobs. Each app registers its kinds of automation in public.automation_kinds (with its
-- defaults and a small schema of what can be changed). An organization's choices are rows in
-- public.automations; no row means the defaults. The app's job reads the effective settings
-- with public.automation_settings() and writes what it did to public.automation_log, which the
-- organization can read. Jobs still run through public.email_jobs (core 0005) for now; later
-- parts add event triggers, conditions and more actions (docs/automation-engine.md).
--
-- params_schema: { "<param>": { "type": "int" | "int_list" | "bool", "label": "…", "help": "…",
--                               "min": n, "max": n, "max_items": n, "unit": "days" } }

create table if not exists public.automation_kinds (
  key text primary key,
  app text not null,
  name text not null,
  description text not null,
  category text not null default 'reminders',
  default_enabled boolean not null default true,
  default_params jsonb not null default '{}'::jsonb,
  params_schema jsonb not null default '{}'::jsonb,
  sort int not null default 100,
  constraint automation_kinds_key_format check (key ~ '^[a-z]+\.[a-z0-9_]+$')
);

create table if not exists public.automations (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null references public.automation_kinds (key) on delete cascade,
  enabled boolean not null,
  params jsonb not null default '{}'::jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (org_id, kind)
);

create table if not exists public.automation_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null references public.automation_kinds (key) on delete cascade,
  at timestamptz not null default now(),
  count int not null default 0,
  summary text not null
);
create index if not exists automation_log_org_kind_at on public.automation_log (org_id, kind, at desc);

alter table public.automation_kinds enable row level security;
alter table public.automations enable row level security;
alter table public.automation_log enable row level security;

-- Everyone signed in can read the catalog; an organization's members read its choices and
-- history. All changes go through the functions below.
drop policy if exists automation_kinds_read on public.automation_kinds;
create policy automation_kinds_read on public.automation_kinds for select to authenticated using (true);
drop policy if exists automations_read on public.automations;
create policy automations_read on public.automations for select to authenticated using (public.is_member(org_id));
drop policy if exists automation_log_read on public.automation_log;
create policy automation_log_read on public.automation_log for select to authenticated using (public.is_member(org_id));

grant select on public.automation_kinds, public.automations, public.automation_log to authenticated;
grant all on public.automation_kinds, public.automations, public.automation_log to service_role;

-- An app registers (or updates) one of its kinds. Called from the app's migrations.
create or replace function public.register_automation_kind(
  p_key text, p_app text, p_name text, p_description text, p_category text,
  p_default_enabled boolean, p_default_params jsonb, p_params_schema jsonb, p_sort int default 100
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_kinds
    (key, app, name, description, category, default_enabled, default_params, params_schema, sort)
  values (p_key, p_app, p_name, p_description, p_category, p_default_enabled,
          coalesce(p_default_params, '{}'), coalesce(p_params_schema, '{}'), coalesce(p_sort, 100))
  on conflict (key) do update set
    app = excluded.app, name = excluded.name, description = excluded.description,
    category = excluded.category, default_enabled = excluded.default_enabled,
    default_params = excluded.default_params, params_schema = excluded.params_schema,
    sort = excluded.sort;
$$;

-- The settings in force for one organization: its choices over the defaults.
create or replace function public.automation_settings(p_org uuid, p_kind text)
returns table (enabled boolean, params jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(a.enabled, k.default_enabled), k.default_params || coalesce(a.params, '{}'::jsonb)
  from public.automation_kinds k
  left join public.automations a on a.kind = k.key and a.org_id = p_org
  where k.key = p_kind;
$$;

-- Checks choices against the kind's schema; returns them cleaned (lists sorted, no repeats).
create or replace function public._clean_automation_params(p_schema jsonb, p_params jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  s jsonb;
  v_out jsonb := '{}'::jsonb;
  v_label text;
  v_min numeric;
  v_max numeric;
  v_list jsonb;
begin
  if p_params is null or jsonb_typeof(p_params) <> 'object' then
    raise exception 'Settings must be an object.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_params) loop
    s := p_schema -> k;
    if s is null then
      raise exception 'Unknown setting "%".', k using errcode = '22023';
    end if;
    v_label := coalesce(s->>'label', k);
    v_min := (s->>'min')::numeric;
    v_max := (s->>'max')::numeric;
    case s->>'type'
      when 'bool' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception '% must be on or off.', v_label using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(k, v);
      when 'int' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
           or (v_min is not null and (v #>> '{}')::numeric < v_min)
           or (v_max is not null and (v #>> '{}')::numeric > v_max) then
          raise exception '% must be a whole number from % to %.', v_label, coalesce(v_min::text, 'any'), coalesce(v_max::text, 'any')
            using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(k, (v #>> '{}')::int);
      when 'int_list' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0
           or jsonb_array_length(v) > coalesce((s->>'max_items')::int, 10)
           or exists (
             select 1 from jsonb_array_elements(v) e
             where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
                or (v_min is not null and (e #>> '{}')::numeric < v_min)
                or (v_max is not null and (e #>> '{}')::numeric > v_max)
           ) then
          raise exception '% must be 1 to % whole numbers from % to %.', v_label,
            coalesce((s->>'max_items')::int, 10), coalesce(v_min::text, 'any'), coalesce(v_max::text, 'any')
            using errcode = '22023';
        end if;
        select jsonb_agg(x order by x desc) into v_list
        from (select distinct (e #>> '{}')::int as x from jsonb_array_elements(v) e) d;
        v_out := v_out || jsonb_build_object(k, v_list);
      else
        raise exception 'Setting "%" has no known type.', k using errcode = '22023';
    end case;
  end loop;
  return v_out;
end;
$$;

-- Every kind on this database, with the organization's settings in force and its latest run.
create or replace function public.list_automations(p_org uuid)
returns table (
  kind text, app text, name text, description text, category text,
  enabled boolean, params jsonb, is_default boolean,
  default_enabled boolean, default_params jsonb, params_schema jsonb,
  updated_at timestamptz, last_run_at timestamptz, last_summary text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_member(p_org) then
    raise exception 'You are not a member of this organization.' using errcode = '42501';
  end if;
  return query
  select k.key, k.app, k.name, k.description, k.category,
         coalesce(a.enabled, k.default_enabled), k.default_params || coalesce(a.params, '{}'::jsonb),
         a.org_id is null, k.default_enabled, k.default_params, k.params_schema,
         a.updated_at, l.at, l.summary
  from public.automation_kinds k
  left join public.automations a on a.kind = k.key and a.org_id = p_org
  left join lateral (
    select x.at, x.summary from public.automation_log x
    where x.org_id = p_org and x.kind = k.key order by x.at desc limit 1
  ) l on true
  order by k.app, k.sort, k.name;
end;
$$;

-- Owners and admins change an automation for their organization.
create or replace function public.set_automation(p_org uuid, p_kind text, p_enabled boolean, p_params jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind public.automation_kinds;
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can change automations.' using errcode = '42501';
  end if;
  select * into v_kind from public.automation_kinds where key = p_kind;
  if not found then
    raise exception 'Unknown automation.' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  insert into public.automations (org_id, kind, enabled, params, updated_by, updated_at)
  values (p_org, p_kind, p_enabled, public._clean_automation_params(v_kind.params_schema, coalesce(p_params, '{}')),
          auth.uid(), now())
  on conflict (org_id, kind) do update set
    enabled = excluded.enabled, params = excluded.params, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- Back to the defaults.
create or replace function public.reset_automation(p_org uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can change automations.' using errcode = '42501';
  end if;
  delete from public.automations where org_id = p_org and kind = p_kind;
end;
$$;

-- An app's job records what an automation did for an organization (only when it did something).
create or replace function public.log_automation(p_org uuid, p_kind text, p_count int, p_summary text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_log (org_id, kind, count, summary)
  select p_org, p_kind, coalesce(p_count, 0), p_summary
  where coalesce(p_count, 0) > 0;
$$;

-- Keep a year of history.
create or replace function public.prune_automation_log()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (delete from public.automation_log where at < now() - interval '1 year' returning 1)
  select count(*)::int from d;
$$;

insert into public.email_jobs (name, fn, every)
values ('core.automation_log_prune', 'public.prune_automation_log', interval '1 day')
on conflict (name) do update set fn = excluded.fn, every = excluded.every;

revoke all on function
  public.register_automation_kind(text, text, text, text, text, boolean, jsonb, jsonb, int),
  public.automation_settings(uuid, text),
  public._clean_automation_params(jsonb, jsonb),
  public.list_automations(uuid),
  public.set_automation(uuid, text, boolean, jsonb),
  public.reset_automation(uuid, text),
  public.log_automation(uuid, text, int, text),
  public.prune_automation_log()
from public, anon, authenticated;
grant execute on function public.list_automations(uuid), public.set_automation(uuid, text, boolean, jsonb),
  public.reset_automation(uuid, text)
to authenticated, service_role;
grant execute on function
  public.register_automation_kind(text, text, text, text, text, boolean, jsonb, jsonb, int),
  public.automation_settings(uuid, text), public._clean_automation_params(jsonb, jsonb),
  public.log_automation(uuid, text, int, text), public.prune_automation_log()
to service_role;
