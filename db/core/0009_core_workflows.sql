-- OpenAppHub core: the automation engine, part 2 (S-25): workflows each organization builds.
-- Idempotent; runs hosted and self-hosted. Design: docs/automation-engine.md.
--
-- A workflow is When → If → Then, stored as JSON and checked by public._validate_workflow:
--   { "trigger":  { "type": "board.meeting_upcoming", "params": { "days_before": 5 } },
--     "always":   [ action, … ],                       -- run every time (optional)
--     "branches": [ { "match": "all" | "any",           -- if / else if: the first that matches
--                     "conditions": [ { "field": "member.fields.rank", "op": "lte",
--                                       "value": "PFC", "order": 3 } ],
--                     "actions": [ action, … ] } ],
--     "otherwise": [ action, … ] }                      -- when no branch matched (optional)
--   action    = { "type": "email", "to": recipient, "subject": "…", "message": "…" }
--             | { "type": "task", "to": recipient, "title": "…", "note": "…", "due_in_days": 7 }
--             | { "type": "<app action>", …its params }   (public.automation_action_types)
--   recipient = { "type": "role", "roles": ["owner","admin"] } | { "type": "subject" } | { "type": "user", "user_id": "…" }
--             | { "type": "<app recipient>", …its params }  (public.automation_recipient_types, e.g.
--               Charter's charter.seat { "seat": "president", "level": "unit" }, Board's board.office)
-- Text may use {{placeholders}} from the trigger's data, e.g. {{meeting.title}}.
--
-- Organizations don't touch: a workflow runs only on its own organization's data. A national may
-- share a workflow; a chapter's own organization (core 0006) may use it, and it then runs on the
-- chapter's data. Whether a chapter's organization may build its own is the national's choice.
-- Owners and admins edit workflows, and may let others edit them too (automation_editors).
--
-- Apps register what can start a workflow (automation_trigger_types: events they write with
-- public.emit_automation_event, or a scan function for date-based triggers) and what a workflow
-- can do in them (automation_action_types: queued as automation_jobs the app carries out), and
-- who actions can go to (automation_recipient_types). The engine knows no app: an app adds
-- triggers, actions and recipients from its own migrations, and the builder shows them.

-- ── Catalog ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.automation_trigger_types (
  type text primary key,
  app text not null,
  label text not null,
  description text not null default '',
  kind text not null check (kind in ('event', 'scan', 'schedule')),
  scan_fn text,                                  -- scan: fn(p_org uuid, p_params jsonb) → table(dedupe text, ctx jsonb)
  params_schema jsonb not null default '{}'::jsonb,
  fields jsonb not null default '[]'::jsonb,     -- [{ key, label, type, options? }] the trigger's data offers
  fields_fn text,                                -- optional fn(p_org uuid) → jsonb: extra fields (e.g. member fields)
  provides text[] not null default '{}',         -- context an action may need, e.g. {meeting}
  sort int not null default 100,
  constraint automation_trigger_types_format check (type ~ '^[a-z]+\.[a-z0-9_]+$')
);

create table if not exists public.automation_action_types (
  type text primary key,
  app text not null,
  label text not null,
  description text not null default '',
  params_schema jsonb not null default '{}'::jsonb,
  requires text[] not null default '{}',         -- trigger context it needs, e.g. {meeting}
  sort int not null default 100,
  constraint automation_action_types_format check (type ~ '^[a-z]+\.[a-z0-9_]+$')
);

-- Who an action can go to, beyond the engine's own (a role, a person, the person it's about):
-- apps add theirs (Charter's board seats, Board's offices) with a function that finds the people.
create table if not exists public.automation_recipient_types (
  type text primary key,
  app text not null,
  label text not null,
  description text not null default '',
  params_schema jsonb not null default '{}'::jsonb,
  resolve_fn text not null,                      -- fn(p_org uuid, p_params jsonb, p_ctx jsonb) → table(user_id uuid, email text)
  options_fn text,                               -- optional fn(p_org uuid) → jsonb { param: [choices] } for the builder
  sort int not null default 100,
  constraint automation_recipient_types_format check (type ~ '^[a-z]+\.[a-z0-9_]+$')
);

-- ── Workflows, editors, settings ───────────────────────────────────────────────────────────────
create table if not exists public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  enabled boolean not null default true,
  definition jsonb,                               -- null when adopted_from is set
  adopted_from uuid references public.automation_workflows (id) on delete cascade,
  shared boolean not null default false,          -- a national offers it to its chapters' organizations
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_workflows_def check ((definition is null) = (adopted_from is not null)),
  constraint automation_workflows_adopted_not_shared check (adopted_from is null or not shared)
);
create index if not exists automation_workflows_org on public.automation_workflows (org_id);
create unique index if not exists automation_workflows_adopt_once on public.automation_workflows (org_id, adopted_from)
  where adopted_from is not null;

create table if not exists public.automation_editors (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.automation_org_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  chapters_may_build boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── Events, runs, tasks, jobs ──────────────────────────────────────────────────────────────────
create table if not exists public.automation_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  type text not null,
  ctx jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists automation_events_pending on public.automation_events (id) where processed_at is null;

create table if not exists public.automation_runs (
  id bigint generated always as identity primary key,
  workflow_id uuid not null references public.automation_workflows (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  dedupe_key text not null,
  trigger_type text not null,
  ctx jsonb not null default '{}'::jsonb,
  status text not null default 'done' check (status in ('done', 'failed', 'nothing')),
  branch text,                                    -- 'branch 1', 'otherwise', or null
  log jsonb not null default '[]'::jsonb,         -- [{ action, ok, detail }]
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workflow_id, dedupe_key)
);
create index if not exists automation_runs_org_at on public.automation_runs (org_id, started_at desc);

create table if not exists public.automation_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id bigint references public.automation_runs (id) on delete set null,
  assignee_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  note text not null default '',
  link text,
  due_on date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid
);
create index if not exists automation_tasks_assignee on public.automation_tasks (assignee_id) where status = 'open';

create table if not exists public.automation_jobs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id bigint references public.automation_runs (id) on delete set null,
  app text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_jobs_queued on public.automation_jobs (app, id) where status in ('queued', 'running');

-- ── Row-level security: members read their organization's; changes go through functions ─────────
alter table public.automation_trigger_types enable row level security;
alter table public.automation_action_types enable row level security;
alter table public.automation_recipient_types enable row level security;
alter table public.automation_workflows enable row level security;
alter table public.automation_editors enable row level security;
alter table public.automation_org_settings enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_tasks enable row level security;
alter table public.automation_jobs enable row level security;

drop policy if exists automation_trigger_types_read on public.automation_trigger_types;
create policy automation_trigger_types_read on public.automation_trigger_types for select to authenticated using (true);
drop policy if exists automation_action_types_read on public.automation_action_types;
create policy automation_action_types_read on public.automation_action_types for select to authenticated using (true);
drop policy if exists automation_recipient_types_read on public.automation_recipient_types;
create policy automation_recipient_types_read on public.automation_recipient_types for select to authenticated using (true);
drop policy if exists automation_workflows_read on public.automation_workflows;
create policy automation_workflows_read on public.automation_workflows for select to authenticated using (public.is_member(org_id));
drop policy if exists automation_editors_read on public.automation_editors;
create policy automation_editors_read on public.automation_editors for select to authenticated using (public.is_member(org_id));
drop policy if exists automation_org_settings_read on public.automation_org_settings;
create policy automation_org_settings_read on public.automation_org_settings for select to authenticated using (public.is_member(org_id));
drop policy if exists automation_runs_read on public.automation_runs;
create policy automation_runs_read on public.automation_runs for select to authenticated using (public.is_member(org_id));
drop policy if exists automation_tasks_read on public.automation_tasks;
create policy automation_tasks_read on public.automation_tasks for select to authenticated
  using (assignee_id = auth.uid() or public.has_role(org_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists automation_jobs_read on public.automation_jobs;
create policy automation_jobs_read on public.automation_jobs for select to authenticated using (public.is_member(org_id));

grant select on public.automation_trigger_types, public.automation_action_types, public.automation_recipient_types, public.automation_workflows,
  public.automation_editors, public.automation_org_settings, public.automation_runs, public.automation_tasks,
  public.automation_jobs to authenticated;
grant all on public.automation_trigger_types, public.automation_action_types, public.automation_recipient_types, public.automation_workflows,
  public.automation_editors, public.automation_org_settings, public.automation_events, public.automation_runs,
  public.automation_tasks, public.automation_jobs to service_role;

-- ── Registering what apps offer (called from app migrations) ───────────────────────────────────
create or replace function public.register_automation_trigger(
  p_type text, p_app text, p_label text, p_description text, p_kind text, p_scan_fn text,
  p_params_schema jsonb, p_fields jsonb, p_fields_fn text, p_provides text[], p_sort int default 100
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_trigger_types
    (type, app, label, description, kind, scan_fn, params_schema, fields, fields_fn, provides, sort)
  values (p_type, p_app, p_label, coalesce(p_description, ''), p_kind, p_scan_fn, coalesce(p_params_schema, '{}'),
          coalesce(p_fields, '[]'), p_fields_fn, coalesce(p_provides, '{}'), coalesce(p_sort, 100))
  on conflict (type) do update set app = excluded.app, label = excluded.label, description = excluded.description,
    kind = excluded.kind, scan_fn = excluded.scan_fn, params_schema = excluded.params_schema, fields = excluded.fields,
    fields_fn = excluded.fields_fn, provides = excluded.provides, sort = excluded.sort;
$$;

create or replace function public.register_automation_action(
  p_type text, p_app text, p_label text, p_description text, p_params_schema jsonb, p_requires text[],
  p_sort int default 100
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_action_types (type, app, label, description, params_schema, requires, sort)
  values (p_type, p_app, p_label, coalesce(p_description, ''), coalesce(p_params_schema, '{}'),
          coalesce(p_requires, '{}'), coalesce(p_sort, 100))
  on conflict (type) do update set app = excluded.app, label = excluded.label, description = excluded.description,
    params_schema = excluded.params_schema, requires = excluded.requires, sort = excluded.sort;
$$;

create or replace function public.register_automation_recipient(
  p_type text, p_app text, p_label text, p_description text, p_params_schema jsonb, p_resolve_fn text, p_sort int default 100,
  p_options_fn text default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_recipient_types (type, app, label, description, params_schema, resolve_fn, sort, options_fn)
  values (p_type, p_app, p_label, coalesce(p_description, ''), coalesce(p_params_schema, '{}'), p_resolve_fn, coalesce(p_sort, 100), p_options_fn)
  on conflict (type) do update set app = excluded.app, label = excluded.label, description = excluded.description,
    params_schema = excluded.params_schema, resolve_fn = excluded.resolve_fn, sort = excluded.sort, options_fn = excluded.options_fn;
$$;

-- The time-based trigger every database has.
select public.register_automation_trigger(
  'core.schedule', 'hub', 'On a schedule', 'Every day, every week on a day, or every month on a date, at an hour.',
  'schedule', null,
  '{"frequency": {"type": "choice", "label": "How often", "options": ["daily", "weekly", "monthly"]},
    "day": {"type": "int", "label": "Day (weekly: 0 Sunday … 6 Saturday; monthly: 1–28)", "min": 0, "max": 28},
    "hour": {"type": "int", "label": "Hour (0–23)", "min": 0, "max": 23}}',
  '[{"key": "today", "label": "Today''s date", "type": "date"}]', null, '{}', 1);

-- Choices are a new settings type for these schemas (automation_kinds' cleaner learns it too).
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
      when 'text' then
        if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > coalesce((s->>'max_length')::int, 2000) then
          raise exception '% must be text.', v_label using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(k, v);
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception '% must be a date (YYYY-MM-DD).', v_label using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(k, v);
      when 'choice' then
        if jsonb_typeof(v) <> 'string' or not ((s->'options') ? (v #>> '{}')) then
          raise exception '% must be one of: %.', v_label,
            (select string_agg(x, ', ') from jsonb_array_elements_text(s->'options') x) using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_object(k, v);
      when 'choices' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0
           or exists (select 1 from jsonb_array_elements(v) e where not ((s->'options') ? (e #>> '{}'))) then
          raise exception '% must be one or more of: %.', v_label,
            (select string_agg(x, ', ') from jsonb_array_elements_text(s->'options') x) using errcode = '22023';
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

-- ── Who may edit ───────────────────────────────────────────────────────────────────────────────
create or replace function public.can_edit_automations(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(p_org, array['owner', 'admin']::public.org_role[])
      or exists (select 1 from public.automation_editors e join public.memberships m
                   on m.org_id = e.org_id and m.user_id = e.user_id
                 where e.org_id = p_org and e.user_id = auth.uid());
$$;

-- A chapter's organization may build its own unless its national said no.
create or replace function public._may_build_workflows(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.chapters_may_build from public.organizations o
                   join public.automation_org_settings s on s.org_id = o.parent_org_id
                   where o.id = p_org), true);
$$;

-- ── Validation ─────────────────────────────────────────────────────────────────────────────────
create or replace function public._validate_recipient(p jsonb, p_where text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception '%: choose who.', p_where using errcode = '22023';
  end if;
  case p->>'type'
    when 'role' then
      if jsonb_typeof(p->'roles') <> 'array' or jsonb_array_length(p->'roles') = 0
         or exists (select 1 from jsonb_array_elements_text(p->'roles') r where r not in ('owner', 'admin', 'member', 'viewer')) then
        raise exception '%: choose one or more roles (owner, admin, member, viewer).', p_where using errcode = '22023';
      end if;
      return jsonb_build_object('type', 'role', 'roles', p->'roles');
    when 'subject' then
      return jsonb_build_object('type', 'subject');
    when 'user' then
      if coalesce(p->>'user_id', '') !~ '^[0-9a-f-]{36}$' then
        raise exception '%: choose a person.', p_where using errcode = '22023';
      end if;
      return jsonb_build_object('type', 'user', 'user_id', p->>'user_id');
    else
      -- An app's kind of recipient (a board seat, an office…), checked against its settings.
      if exists (select 1 from public.automation_recipient_types t where t.type = p->>'type') then
        return jsonb_build_object('type', p->>'type') || public._clean_automation_params(
          (select t.params_schema from public.automation_recipient_types t where t.type = p->>'type'), p - 'type');
      end if;
      raise exception '%: choose who (a role, a person, the person it''s about, or one the apps offer).', p_where
        using errcode = '22023';
  end case;
end;
$$;

-- Checks a workflow and returns it cleaned. Raises a plain-language error on the first problem.
create or replace function public._validate_workflow(p_def jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_trig public.automation_trigger_types;
  v_params jsonb;
  v_out_branches jsonb := '[]';
  v_b jsonb;
  v_bi int := 0;
  v_conds jsonb;
  v_c jsonb;
  v_ci int;
  v_field text;
  v_fields text[];
  v_count int := 0;

  -- validated lists
  v_always jsonb;
  v_otherwise jsonb;
begin
  if p_def is null or jsonb_typeof(p_def) <> 'object' then
    raise exception 'The workflow is empty.' using errcode = '22023';
  end if;
  select * into v_trig from public.automation_trigger_types where type = p_def #>> '{trigger,type}';
  if not found then
    raise exception 'Choose what starts this workflow (When).' using errcode = '22023';
  end if;
  v_params := public._clean_automation_params(v_trig.params_schema, coalesce(p_def #> '{trigger,params}', '{}'));
  -- Required trigger settings: every key in the schema except those marked optional.
  if exists (select 1 from jsonb_each(v_trig.params_schema) s
             where not coalesce((s.value->>'optional')::boolean, false) and not (v_params ? s.key)
               and not (v_trig.type = 'core.schedule' and s.key = 'day' and v_params->>'frequency' = 'daily')) then
    raise exception 'Fill in every setting for "%".', v_trig.label using errcode = '22023';
  end if;
  v_fields := array(select x->>'key' from jsonb_array_elements(v_trig.fields) x);

  if jsonb_typeof(coalesce(p_def->'branches', '[]')) <> 'array' or jsonb_array_length(coalesce(p_def->'branches', '[]')) > 20 then
    raise exception 'Up to 20 "If" branches.' using errcode = '22023';
  end if;
  for v_b in select * from jsonb_array_elements(coalesce(p_def->'branches', '[]')) loop
    v_bi := v_bi + 1;
    v_conds := coalesce(v_b->'conditions', '[]');
    if jsonb_typeof(v_conds) <> 'array' or jsonb_array_length(v_conds) = 0 or jsonb_array_length(v_conds) > 30 then
      raise exception 'If #%: add 1 to 30 conditions.', v_bi using errcode = '22023';
    end if;
    v_ci := 0;
    for v_c in select * from jsonb_array_elements(v_conds) loop
      v_ci := v_ci + 1;
      v_field := v_c->>'field';
      if coalesce(v_field, '') = '' or v_field !~ '^[a-z_]+(\.[a-z0-9_]+)*$' then
        raise exception 'If #%, condition %: choose a field.', v_bi, v_ci using errcode = '22023';
      end if;
      if not (v_field = any (v_fields) or (v_trig.fields_fn is not null and v_field like 'member.fields.%')) then
        raise exception 'If #%, condition %: "%" isn''t something "%" knows.', v_bi, v_ci, v_field, v_trig.label using errcode = '22023';
      end if;
      if coalesce(v_c->>'op', '') not in ('eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'between', 'in', 'contains', 'is_empty', 'is_not_empty') then
        raise exception 'If #%, condition %: choose how to compare.', v_bi, v_ci using errcode = '22023';
      end if;
      if v_c->>'op' not in ('is_empty', 'is_not_empty') and v_c->'value' is null then
        raise exception 'If #%, condition %: fill in the value.', v_bi, v_ci using errcode = '22023';
      end if;
      if v_c->>'op' = 'between' and v_c->'value2' is null then
        raise exception 'If #%, condition %: fill in both ends of the range.', v_bi, v_ci using errcode = '22023';
      end if;
      if v_c->>'op' = 'in' and jsonb_typeof(v_c->'value') <> 'array' then
        raise exception 'If #%, condition %: choose one or more values.', v_bi, v_ci using errcode = '22023';
      end if;
    end loop;
    v_out_branches := v_out_branches || jsonb_build_array(jsonb_build_object(
      'match', case when v_b->>'match' = 'any' then 'any' else 'all' end,
      'conditions', v_conds,
      'actions', public._validate_actions(coalesce(v_b->'actions', '[]'), format('If #%s', v_bi), v_trig)));
  end loop;
  select coalesce(sum(jsonb_array_length(b->'actions')), 0) into v_count from jsonb_array_elements(v_out_branches) b;
  v_always := public._validate_actions(coalesce(p_def->'always', '[]'), 'Always', v_trig);
  v_otherwise := public._validate_actions(coalesce(p_def->'otherwise', '[]'), 'Otherwise', v_trig);
  if jsonb_array_length(v_always) + jsonb_array_length(v_otherwise) + v_count = 0 then
    raise exception 'Add at least one thing to do (Then).' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'trigger', jsonb_build_object('type', v_trig.type, 'params', v_params),
    'always', v_always, 'branches', v_out_branches, 'otherwise', v_otherwise);
end;
$$;

create or replace function public._validate_actions(p_actions jsonb, p_where text, p_trig public.automation_trigger_types)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_a jsonb;
  v_i int := 0;
  v_out jsonb := '[]';
  v_type public.automation_action_types;
  v_where text;
  v_rest jsonb;
begin
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 20 then
    raise exception '%: up to 20 things to do.', p_where using errcode = '22023';
  end if;
  for v_a in select * from jsonb_array_elements(p_actions) loop
    v_i := v_i + 1;
    v_where := format('%s, step %s', p_where, v_i);
    case v_a->>'type'
      when 'email' then
        if coalesce(btrim(v_a->>'subject'), '') = '' or coalesce(btrim(v_a->>'message'), '') = ''
           or length(v_a->>'subject') > 200 or length(v_a->>'message') > 5000 then
          raise exception '%: an email needs a subject (up to 200 characters) and a message.', v_where using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'email',
          'to', public._validate_recipient(v_a->'to', v_where),
          'subject', btrim(v_a->>'subject'), 'message', btrim(v_a->>'message')));
      when 'task' then
        if coalesce(btrim(v_a->>'title'), '') = '' or length(v_a->>'title') > 200
           or (v_a ? 'due_in_days' and (jsonb_typeof(v_a->'due_in_days') <> 'number'
                or (v_a->>'due_in_days')::numeric not between 0 and 365)) then
          raise exception '%: a task needs a title, and a due date 0 to 365 days out if any.', v_where using errcode = '22023';
        end if;
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'task',
          'to', public._validate_recipient(v_a->'to', v_where),
          'title', btrim(v_a->>'title'), 'note', coalesce(btrim(v_a->>'note'), ''),
          'due_in_days', case when v_a ? 'due_in_days' then (v_a->>'due_in_days')::int end));
      else
        select * into v_type from public.automation_action_types where type = v_a->>'type';
        if not found then
          raise exception '%: choose what to do.', v_where using errcode = '22023';
        end if;
        if not (v_type.requires <@ p_trig.provides) then
          raise exception '%: "%" works only with a When that has a %.', v_where, v_type.label, array_to_string(v_type.requires, ', ')
            using errcode = '22023';
        end if;
        v_rest := v_a - 'type';
        v_out := v_out || jsonb_build_array(jsonb_build_object('type', v_type.type)
          || public._clean_automation_params(v_type.params_schema, v_rest));
    end case;
  end loop;
  return v_out;
end;
$$;

-- ── Editing ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.save_workflow(
  p_org uuid, p_id uuid, p_name text, p_description text, p_enabled boolean, p_definition jsonb, p_shared boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_def jsonb;
  v_is_child boolean;
begin
  perform public._require_uid();
  if not public.can_edit_automations(p_org) then
    raise exception 'Only owners, admins and people they choose can change workflows.' using errcode = '42501';
  end if;
  if not public._may_build_workflows(p_org) then
    raise exception 'Your national doesn''t let chapters build their own workflows. You can use the ones it shares.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the workflow a name.' using errcode = '22023';
  end if;
  v_is_child := exists (select 1 from public.organizations where id = p_org and parent_org_id is not null);
  if coalesce(p_shared, false) and v_is_child then
    raise exception 'Only a national can share workflows with its chapters.' using errcode = '22023';
  end if;
  v_def := public._validate_workflow(p_definition);
  if v_id is null then
    insert into public.automation_workflows (org_id, name, description, enabled, definition, shared)
    values (p_org, btrim(p_name), coalesce(btrim(p_description), ''), coalesce(p_enabled, true), v_def, coalesce(p_shared, false))
    returning id into v_id;
  else
    update public.automation_workflows set name = btrim(p_name), description = coalesce(btrim(p_description), ''),
      enabled = coalesce(p_enabled, enabled), definition = v_def, shared = coalesce(p_shared, false),
      updated_by = auth.uid(), updated_at = now()
    where id = v_id and org_id = p_org and adopted_from is null;
    if not found then
      raise exception 'Workflow not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_workflow_enabled(p_id uuid, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.automation_workflows where id = p_id;
  if v_org is null or not public.can_edit_automations(v_org) then
    raise exception 'Only owners, admins and people they choose can change workflows.' using errcode = '42501';
  end if;
  update public.automation_workflows set enabled = coalesce(p_enabled, false), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
end;
$$;

create or replace function public.delete_workflow(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.automation_workflows where id = p_id;
  if v_org is null or not public.can_edit_automations(v_org) then
    raise exception 'Only owners, admins and people they choose can change workflows.' using errcode = '42501';
  end if;
  delete from public.automation_workflows where id = p_id;  -- its runs go with it; its tasks stay
end;
$$;

-- A chapter's organization uses one of its national's shared workflows (on the chapter's own data).
create or replace function public.adopt_workflow(p_org uuid, p_source uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_src public.automation_workflows;
  v_id uuid;
begin
  perform public._require_uid();
  if not public.can_edit_automations(p_org) then
    raise exception 'Only owners, admins and people they choose can change workflows.' using errcode = '42501';
  end if;
  select w.* into v_src from public.automation_workflows w
  join public.organizations o on o.parent_org_id = w.org_id
  where w.id = p_source and o.id = p_org and w.shared and w.adopted_from is null;
  if not found then
    raise exception 'That workflow isn''t shared with you.' using errcode = '42501';
  end if;
  insert into public.automation_workflows (org_id, name, description, enabled, adopted_from)
  values (p_org, v_src.name, v_src.description, true, v_src.id)
  on conflict (org_id, adopted_from) where adopted_from is not null do update set enabled = true, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.grant_automation_editor(p_org uuid, p_user uuid, p_grant boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can choose who edits workflows.' using errcode = '42501';
  end if;
  if p_grant then
    if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user) then
      raise exception 'Choose someone in this organization.' using errcode = '22023';
    end if;
    insert into public.automation_editors (org_id, user_id) values (p_org, p_user) on conflict do nothing;
  else
    delete from public.automation_editors where org_id = p_org and user_id = p_user;
  end if;
end;
$$;

create or replace function public.set_chapters_may_build(p_org uuid, p_allowed boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not public.has_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can change this.' using errcode = '42501';
  end if;
  insert into public.automation_org_settings (org_id, chapters_may_build) values (p_org, coalesce(p_allowed, true))
  on conflict (org_id) do update set chapters_may_build = excluded.chapters_may_build, updated_at = now();
end;
$$;

-- Everything the builder needs for one organization, in one call.
create or replace function public.workflow_overview(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
begin
  if not public.is_member(p_org) then
    raise exception 'You are not a member of this organization.' using errcode = '42501';
  end if;
  select parent_org_id into v_parent from public.organizations where id = p_org;
  return jsonb_build_object(
    'can_edit', public.can_edit_automations(p_org),
    'can_manage_editors', public.has_role(p_org, array['owner', 'admin']::public.org_role[]),
    'may_build', public._may_build_workflows(p_org),
    'is_chapter', v_parent is not null,
    'has_chapters', exists (select 1 from public.organizations c where c.parent_org_id = p_org),
    'chapters_may_build', coalesce((select chapters_may_build from public.automation_org_settings where org_id = p_org), true),
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'description', w.description, 'enabled', w.enabled, 'shared', w.shared,
        'adopted_from', w.adopted_from, 'definition', coalesce(w.definition, s.definition),
        'source_name', s.name, 'source_active', s.id is null or (s.shared),
        'updated_at', w.updated_at,
        'last_run', (select jsonb_build_object('at', r.started_at, 'status', r.status, 'branch', r.branch)
                     from public.automation_runs r where r.workflow_id = w.id order by r.started_at desc limit 1))
        order by w.name)
      from public.automation_workflows w
      left join public.automation_workflows s on s.id = w.adopted_from
      where w.org_id = p_org), '[]'),
    'shared_by_parent', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'description', w.description,
        'definition', w.definition,
        'in_use', exists (select 1 from public.automation_workflows a where a.org_id = p_org and a.adopted_from = w.id))
        order by w.name)
      from public.automation_workflows w where w.org_id = v_parent and w.shared and w.adopted_from is null), '[]'),
    'editors', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'name', coalesce(p.display_name, ''),
        'email', coalesce(u.email, '')) order by p.display_name)
      from public.automation_editors e left join public.profiles p on p.id = e.user_id
      left join auth.users u on u.id = e.user_id where e.org_id = p_org), '[]'),
    'triggers', coalesce((select jsonb_agg(to_jsonb(t) - 'scan_fn' - 'fields_fn' || jsonb_build_object('extra_fields',
        case when t.fields_fn is not null then public._automation_extra_fields(t.fields_fn, p_org) else '[]'::jsonb end)
        order by t.sort, t.label) from public.automation_trigger_types t), '[]'),
    'actions', coalesce((select jsonb_agg(to_jsonb(a) order by a.sort, a.label) from public.automation_action_types a), '[]'),
    'recipients', coalesce((select jsonb_agg(to_jsonb(t) - 'resolve_fn' - 'options_fn' || jsonb_build_object('param_options',
        case when t.options_fn is not null then public._automation_extra_fields(t.options_fn, p_org) else '{}'::jsonb end)
        order by t.sort, t.label) from public.automation_recipient_types t), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(nullif(p.display_name, ''), u.email), 'role', m.role)
        order by coalesce(nullif(p.display_name, ''), u.email))
      from public.memberships m left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
      where m.org_id = p_org), '[]'));
end;
$$;

create or replace function public._automation_extra_fields(p_fn text, p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_fn !~ '^[a-z_]+\.[a-z0-9_]+$' or to_regprocedure(p_fn || '(uuid)') is null then
    return '[]';
  end if;
  execute format('select %s($1)', p_fn) into v using p_org;
  return coalesce(v, '[]');
exception when others then
  return '[]';
end;
$$;

create or replace function public.workflow_runs(p_org uuid, p_workflow uuid default null, p_limit int default 50)
returns table (id bigint, workflow_id uuid, workflow_name text, trigger_type text, status text, branch text,
               log jsonb, error text, started_at timestamptz, summary text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.workflow_id, w.name, r.trigger_type, r.status, r.branch, r.log, r.error, r.started_at,
         coalesce(r.ctx->>'summary', '')
  from public.automation_runs r join public.automation_workflows w on w.id = r.workflow_id
  where r.org_id = p_org and public.is_member(p_org) and (p_workflow is null or r.workflow_id = p_workflow)
  order by r.started_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.complete_automation_task(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.automation_tasks set status = 'done', done_at = now(), done_by = auth.uid()
  where id = p_id and status = 'open'
    and (assignee_id = auth.uid() or public.has_role(org_id, array['owner', 'admin']::public.org_role[]));
  if not found then
    raise exception 'Task not found, or not yours to finish.' using errcode = '42501';
  end if;
end;
$$;

-- ── Apps write events ──────────────────────────────────────────────────────────────────────────
-- Only when some enabled workflow could use it (cheap no-op otherwise).
create or replace function public.emit_automation_event(p_org uuid, p_type text, p_ctx jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_events (org_id, type, ctx)
  select p_org, p_type, coalesce(p_ctx, '{}')
  where p_org is not null and exists (
    select 1 from public.automation_workflows w
    left join public.automation_workflows s on s.id = w.adopted_from
    where w.org_id = p_org and w.enabled and coalesce(w.definition, s.definition) #>> '{trigger,type}' = p_type);
$$;

-- ── Running ────────────────────────────────────────────────────────────────────────────────────
-- {{a.b}} → the text at that path in the context.
create or replace function public._automation_fill(p_text text, p_ctx jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_text, '');
  m text[];
  v_val jsonb;
begin
  for m in select regexp_matches(v, '\{\{\s*([a-z_]+(?:\.[a-z0-9_]+)*)\s*\}\}', 'g') loop
    v_val := p_ctx #> string_to_array(m[1], '.');
    if jsonb_typeof(v_val) = 'object' and v_val ? 'value' then v_val := v_val->'value'; end if;
    v := replace(v, '{{' || m[1] || '}}', coalesce(v_val #>> '{}', ''));
  end loop;
  return regexp_replace(v, '\{\{\s*[^}]*\}\}', '', 'g');
end;
$$;

create or replace function public._automation_condition(p_c jsonb, p_ctx jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_ctx #> string_to_array(p_c->>'field', '.');
  v_op text := p_c->>'op';
  v_ordered boolean := jsonb_typeof(v) = 'object' and v ? 'order';
  v_text text;
  v_num numeric;
  a numeric;
  b numeric;
begin
  if jsonb_typeof(v) = 'object' and v ? 'value' then
    v_text := v->>'value';
  else
    v_text := v #>> '{}';
  end if;
  if v_op = 'is_empty' then return coalesce(v_text, '') = ''; end if;
  if v_op = 'is_not_empty' then return coalesce(v_text, '') <> ''; end if;
  if v_text is null then return false; end if;
  if v_op = 'in' then
    return exists (select 1 from jsonb_array_elements_text(p_c->'value') x where lower(x) = lower(v_text));
  end if;
  if v_op = 'contains' then return position(lower(p_c->>'value') in lower(v_text)) > 0; end if;
  if v_ordered then
    -- Ordered lists (like rank) compare by their place in the list.
    v_num := (v->>'order')::numeric;
    a := (p_c->>'order')::numeric;
    b := (p_c->>'order2')::numeric;
    if v_op in ('eq', 'ne') and a is null then
      return case v_op when 'eq' then lower(v_text) = lower(p_c->>'value') else lower(v_text) <> lower(p_c->>'value') end;
    end if;
  else
    begin
      v_num := v_text::numeric;
      a := (p_c->>'value')::numeric;
      b := (p_c->>'value2')::numeric;
    exception when others then
      v_num := null;
    end;
  end if;
  if v_num is null or a is null then
    -- Text and dates compare as text (ISO dates sort correctly).
    return case v_op
      when 'eq' then lower(v_text) = lower(p_c->>'value')
      when 'ne' then lower(v_text) <> lower(p_c->>'value')
      when 'lt' then v_text < p_c->>'value'
      when 'lte' then v_text <= p_c->>'value'
      when 'gt' then v_text > p_c->>'value'
      when 'gte' then v_text >= p_c->>'value'
      when 'between' then v_text between p_c->>'value' and p_c->>'value2'
      else false end;
  end if;
  return case v_op
    when 'eq' then v_num = a when 'ne' then v_num <> a
    when 'lt' then v_num < a when 'lte' then v_num <= a
    when 'gt' then v_num > a when 'gte' then v_num >= a
    when 'between' then v_num between least(a, b) and greatest(a, b)
    else false end;
end;
$$;

-- People for a recipient, in this organization. Seats and offices come from the apps when installed.
create or replace function public._automation_recipients(p_org uuid, p_to jsonb, p_ctx jsonb)
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fn text;
begin
  case p_to->>'type'
    when 'role' then
      return query select m.user_id, null::text from public.memberships m
        where m.org_id = p_org and m.role::text in (select jsonb_array_elements_text(p_to->'roles'));
    when 'user' then
      return query select m.user_id, null::text from public.memberships m
        where m.org_id = p_org and m.user_id = (p_to->>'user_id')::uuid;
    when 'subject' then
      if p_ctx->>'subject_user_id' is not null then
        return query select (p_ctx->>'subject_user_id')::uuid, null::text;
      elsif coalesce(p_ctx->>'subject_email', '') <> '' then
        return query select null::uuid, p_ctx->>'subject_email';
      end if;
    else
      -- An app's kind of recipient: its own function finds the people.
      select t.resolve_fn into v_fn from public.automation_recipient_types t where t.type = p_to->>'type';
      if v_fn ~ '^[a-z_]+\.[a-z0-9_]+$' and to_regprocedure(v_fn || '(uuid,jsonb,jsonb)') is not null then
        return query execute format('select r.user_id, r.email from %s($1, $2, $3) r', v_fn)
          using p_org, p_to - 'type', p_ctx;
      end if;
      return;
  end case;
end;
$$;

-- Runs one workflow for one occurrence; nothing happens twice for the same dedupe key.
create or replace function public._automation_execute(
  p_wf public.automation_workflows, p_def jsonb, p_org uuid, p_dedupe text, p_ctx jsonb
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_branch text;
  v_actions jsonb := '[]';
  v_b jsonb;
  v_i int := 0;
  v_ok boolean;
  v_a jsonb;
  v_log jsonb := '[]';
  v_n int;
  v_detail text;
  v_k int := 0;
  r record;
  v_app text := case
    when to_regclass('hub.instance') is not null then 'hub'
    when to_regclass('charter.units') is not null then 'charter'
    when to_regclass('board.meetings') is not null then 'board'
    when to_regclass('ledger.transactions') is not null then 'ledger'
    else 'hub' end;
begin
  insert into public.automation_runs (workflow_id, org_id, dedupe_key, trigger_type, ctx)
  values (p_wf.id, p_org, p_dedupe, p_def #>> '{trigger,type}', p_ctx)
  on conflict (workflow_id, dedupe_key) do nothing
  returning id into v_run;
  if v_run is null then return null; end if;

  -- Which branch: the first whose conditions match; otherwise the "otherwise" list.
  for v_b in select * from jsonb_array_elements(coalesce(p_def->'branches', '[]')) loop
    v_i := v_i + 1;
    if (v_b->>'match' = 'any' and exists (select 1 from jsonb_array_elements(v_b->'conditions') c where public._automation_condition(c, p_ctx)))
       or (coalesce(v_b->>'match', 'all') = 'all' and not exists (select 1 from jsonb_array_elements(v_b->'conditions') c where not public._automation_condition(c, p_ctx))) then
      v_branch := format('If #%s', v_i);
      v_actions := v_b->'actions';
      exit;
    end if;
  end loop;
  if v_branch is null and jsonb_array_length(coalesce(p_def->'otherwise', '[]')) > 0 then
    v_branch := 'Otherwise';
    v_actions := p_def->'otherwise';
  end if;
  v_actions := coalesce(p_def->'always', '[]') || v_actions;

  for v_a in select * from jsonb_array_elements(v_actions) loop
    v_k := v_k + 1;
    v_ok := true;
    v_detail := '';
    begin
      case v_a->>'type'
        when 'email' then
          v_n := 0;
          for r in select distinct * from public._automation_recipients(p_org, v_a->'to', p_ctx) loop
            perform public.enqueue_email(v_app, 'automation.message', p_org, r.user_id, r.email,
              jsonb_build_object('subject', public._automation_fill(v_a->>'subject', p_ctx),
                'message', public._automation_fill(v_a->>'message', p_ctx), 'workflow', p_wf.name,
                'link', p_ctx->>'link', 'link_app', p_ctx->>'link_app'),
              'essential', format('wf:%s:%s:%s', v_run, v_k, coalesce(r.user_id::text, r.email)));
            v_n := v_n + 1;
          end loop;
          v_detail := format('%s %s emailed', v_n, case when v_n = 1 then 'person' else 'people' end);
          v_ok := v_n > 0;
          if not v_ok then v_detail := 'nobody to email (is that seat or office filled?)'; end if;
        when 'task' then
          v_n := 0;
          for r in select distinct x.user_id from public._automation_recipients(p_org, v_a->'to', p_ctx) x where x.user_id is not null loop
            insert into public.automation_tasks (org_id, run_id, assignee_id, title, note, link, due_on)
            values (p_org, v_run, r.user_id, public._automation_fill(v_a->>'title', p_ctx),
                    public._automation_fill(v_a->>'note', p_ctx), p_ctx->>'link',
                    case when v_a->>'due_in_days' is not null then current_date + (v_a->>'due_in_days')::int end);
            v_n := v_n + 1;
          end loop;
          v_detail := format('%s %s created', v_n, case when v_n = 1 then 'task' else 'tasks' end);
          v_ok := v_n > 0;
          if not v_ok then v_detail := 'nobody to give it to (is that seat or office filled?)'; end if;
        else
          -- An app's action: queued for the app to carry out.
          insert into public.automation_jobs (org_id, run_id, app, kind, payload)
          select p_org, v_run, t.app, t.type, (v_a - 'type') || jsonb_build_object('ctx', p_ctx)
          from public.automation_action_types t where t.type = v_a->>'type';
          v_detail := 'queued';
      end case;
    exception when others then
      v_ok := false;
      v_detail := sqlerrm;
    end;
    v_log := v_log || jsonb_build_array(jsonb_build_object('action', v_a->>'type', 'ok', v_ok, 'detail', v_detail));
  end loop;

  update public.automation_runs set
    status = case when jsonb_array_length(v_actions) = 0 then 'nothing'
                  when exists (select 1 from jsonb_array_elements(v_log) l where not (l->>'ok')::boolean) then 'failed'
                  else 'done' end,
    branch = v_branch, log = v_log, finished_at = now()
  where id = v_run;
  return v_run;
end;
$$;

-- The engine's job: events first, then schedules and date-based triggers. Returns runs made.
create or replace function public.run_workflows()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e record;
  w record;
  s record;
  v_n int := 0;
  v_local timestamp;
  v_p jsonb;
begin
  -- Events.
  for e in
    select * from public.automation_events where processed_at is null order by id limit 500 for update skip locked
  loop
    for w in
      select wf as row, coalesce(wf.definition, src.definition) as def
      from public.automation_workflows wf
      left join public.automation_workflows src on src.id = wf.adopted_from
      where wf.org_id = e.org_id and wf.enabled and (wf.adopted_from is null or src.shared)
        and coalesce(wf.definition, src.definition) #>> '{trigger,type}' = e.type
    loop
      if public._automation_execute(w.row, w.def, e.org_id, format('ev:%s', e.id), e.ctx) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
    update public.automation_events set processed_at = now() where id = e.id;
  end loop;

  -- Schedules and scans.
  for w in
    select wf as row, wf.id, wf.org_id, coalesce(wf.definition, src.definition) as def, t.kind, t.scan_fn,
           coalesce(o.time_zone, 'UTC') as tz
    from public.automation_workflows wf
    left join public.automation_workflows src on src.id = wf.adopted_from
    join public.automation_trigger_types t on t.type = coalesce(wf.definition, src.definition) #>> '{trigger,type}'
    join public.organizations o on o.id = wf.org_id
    where wf.enabled and (wf.adopted_from is null or src.shared) and t.kind in ('schedule', 'scan')
  loop
    v_p := w.def #> '{trigger,params}';
    begin
      if w.kind = 'schedule' then
        v_local := now() at time zone w.tz;
        continue when extract(hour from v_local) < coalesce((v_p->>'hour')::int, 7);
        continue when v_p->>'frequency' = 'weekly' and extract(dow from v_local) <> coalesce((v_p->>'day')::int, 1);
        continue when v_p->>'frequency' = 'monthly' and extract(day from v_local) <> coalesce((v_p->>'day')::int, 1);
        if public._automation_execute(w.row, w.def, w.org_id, format('sched:%s', v_local::date),
             jsonb_build_object('today', v_local::date, 'summary', format('Scheduled, %s', v_local::date))) is not null then
          v_n := v_n + 1;
        end if;
      elsif w.scan_fn ~ '^[a-z_]+\.[a-z0-9_]+$' and to_regprocedure(w.scan_fn || '(uuid,jsonb)') is not null then
        for s in execute format('select * from %s($1, $2)', w.scan_fn) using w.org_id, v_p loop
          if public._automation_execute(w.row, w.def, w.org_id, s.dedupe, s.ctx) is not null then
            v_n := v_n + 1;
          end if;
        end loop;
      end if;
    exception when others then
      raise warning 'workflow %: %', w.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

-- Apps carry out their queued actions.
create or replace function public.claim_automation_jobs(p_app text, p_limit int default 10)
returns setof public.automation_jobs
language sql
volatile
security definer
set search_path = ''
as $$
  update public.automation_jobs j set status = 'running', attempts = attempts + 1, updated_at = now()
  where j.id in (
    select id from public.automation_jobs
    where app = p_app and (status = 'queued' or (status = 'running' and updated_at < now() - interval '10 minutes'))
      and attempts < 5
    order by id limit greatest(coalesce(p_limit, 10), 1) for update skip locked)
  returning j.*;
$$;

create or replace function public.finish_automation_job(p_id bigint, p_ok boolean, p_result jsonb, p_error text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.automation_jobs;
begin
  update public.automation_jobs set
    status = case when p_ok then 'done' when attempts >= 5 then 'failed' else 'queued' end,
    result = p_result, error = p_error, updated_at = now()
  where id = p_id returning * into v;
  -- The run's log says how it went.
  if v.run_id is not null and (p_ok or v.status = 'failed') then
    update public.automation_runs set
      log = log || jsonb_build_array(jsonb_build_object('action', v.kind, 'ok', p_ok,
        'detail', coalesce(case when p_ok then p_result->>'summary' end, p_error, 'done'))),
      status = case when not p_ok then 'failed' else status end
    where id = v.run_id;
  end if;
end;
$$;

-- Keep a year of runs and processed events.
create or replace function public.prune_workflow_history()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with a as (delete from public.automation_events where processed_at < now() - interval '30 days' returning 1),
       b as (delete from public.automation_runs where started_at < now() - interval '1 year' returning 1),
       c as (delete from public.automation_jobs where status in ('done', 'failed') and updated_at < now() - interval '90 days' returning 1)
  select ((select count(*) from a) + (select count(*) from b) + (select count(*) from c))::int;
$$;

insert into public.email_jobs (name, fn, every)
values ('core.workflows', 'public.run_workflows', interval '5 minutes'),
       ('core.workflow_history_prune', 'public.prune_workflow_history', interval '1 day')
on conflict (name) do update set fn = excluded.fn, every = excluded.every;

-- The task summary (0007) also lists tasks workflows give people.
create or replace function public.digest_automation_tasks(p_user uuid, p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('app', 'hub', 'title', t.title, 'due_on', t.due_on,
           'overdue', t.due_on < current_date, 'link', coalesce(t.link, '/')) order by t.due_on nulls last), '[]')
  from public.automation_tasks t where t.assignee_id = p_user and t.org_id = p_org and t.status = 'open';
$$;

-- The task summary's builder (0007), now also with tasks from workflows.
create or replace function public.digest_for(p_user uuid, p_period text default 'weekly')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefs public.email_preferences;
  v_include text[];
  v_orgs jsonb := '[]';
  r record;
  v_tasks jsonb;
  v_meetings jsonb;
  v_t jsonb;
  v_horizon int := case when p_period = 'daily' then 2 else 7 end;
begin
  select * into v_prefs from public.email_preferences where user_id = p_user;
  v_include := coalesce(v_prefs.digest_include, '{tasks,meetings}');
  for r in
    select o.id, o.name, m.role from public.memberships m join public.organizations o on o.id = m.org_id
    where m.user_id = p_user and (v_prefs.digest_org_ids is null or o.id = any (v_prefs.digest_org_ids))
    order by o.name
  loop
    v_tasks := '[]';
    v_meetings := '[]';
    if 'tasks' = any (v_include) then
      if to_regclass('board.api_action_items') is not null then
        execute $q$
          select coalesce(jsonb_agg(jsonb_build_object('app', 'board', 'title', a.title, 'due_on', a.due_date,
                   'overdue', a.due_date < current_date,
                   'link', a.link || case when position('?' in a.link) > 0 then '&' else '?' end || 'org=' || a.org_id)
                 order by a.due_date nulls last), '[]')
          from board.api_action_items a
          where a.org_id = $1 and a.assignee_id = $2 and a.status in ('open', 'in_progress')$q$
          into v_t using r.id, p_user;
        v_tasks := v_tasks || v_t;
      end if;
      if to_regclass('charter.api_tasks') is not null then
        execute $q$
          select coalesce(jsonb_agg(jsonb_build_object('app', 'charter', 'title', t.title, 'due_on', t.due_on,
                   'overdue', t.due_on < current_date, 'link', t.link) order by t.due_on nulls last), '[]')
          from charter.api_tasks t
          where t.org_id = $1
            and ($3 in ('owner', 'admin') or charter.has_permission($2, 'org.manage', t.unit_id))$q$
          into v_t using r.id, p_user, r.role::text;
        v_tasks := v_tasks || v_t;
      end if;
      if to_regclass('ledger.api_tasks') is not null then
        execute $q$
          select coalesce(jsonb_agg(jsonb_build_object('app', 'ledger', 'title', t.title, 'due_on', t.due_on,
                   'overdue', t.due_on < current_date, 'link', t.link || '?org=' || t.org_id) order by t.due_on), '[]')
          from ledger.api_tasks t
          where t.org_id = $1
            and ($3 in ('owner', 'admin')
                 or exists (select 1 from ledger.member_roles mr where mr.org_id = $1 and mr.user_id = $2 and mr.role = 'treasurer'))$q$
          into v_t using r.id, p_user, r.role::text;
        v_tasks := v_tasks || v_t;
      end if;
      -- Tasks workflows gave this person (core 0009).
      v_tasks := v_tasks || public.digest_automation_tasks(p_user, r.id);
    end if;
    if 'meetings' = any (v_include) and to_regclass('board.api_meetings') is not null then
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object('title', m.title, 'meeting_date', m.meeting_date,
                 'start_time', m.start_time, 'link', '/board/meetings/' || m.id || '?org=' || m.org_id)
               order by m.meeting_date), '[]')
        from board.api_meetings m
        where m.org_id = $1 and m.status = 'scheduled' and m.meeting_date between current_date and current_date + $2$q$
        into v_meetings using r.id, v_horizon;
    end if;
    if jsonb_array_length(v_tasks) > 0 or jsonb_array_length(v_meetings) > 0 then
      v_orgs := v_orgs || jsonb_build_array(jsonb_build_object('org_id', r.id, 'org_name', r.name,
        'tasks', v_tasks, 'meetings', v_meetings));
    end if;
  end loop;
  return jsonb_build_object('period', p_period, 'orgs', v_orgs);
end;
$$;


-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────
revoke all on function
  public.register_automation_trigger(text, text, text, text, text, text, jsonb, jsonb, text, text[], int),
  public.register_automation_action(text, text, text, text, jsonb, text[], int),
  public.register_automation_recipient(text, text, text, text, jsonb, text, int, text),
  public.can_edit_automations(uuid), public._may_build_workflows(uuid),
  public._validate_recipient(jsonb, text), public._validate_workflow(jsonb),
  public._validate_actions(jsonb, text, public.automation_trigger_types),
  public.save_workflow(uuid, uuid, text, text, boolean, jsonb, boolean), public.set_workflow_enabled(uuid, boolean),
  public.delete_workflow(uuid), public.adopt_workflow(uuid, uuid), public.grant_automation_editor(uuid, uuid, boolean),
  public.set_chapters_may_build(uuid, boolean), public.workflow_overview(uuid), public._automation_extra_fields(text, uuid),
  public.workflow_runs(uuid, uuid, int), public.complete_automation_task(uuid),
  public.emit_automation_event(uuid, text, jsonb), public._automation_fill(text, jsonb),
  public._automation_condition(jsonb, jsonb), public._automation_recipients(uuid, jsonb, jsonb),
  public._automation_execute(public.automation_workflows, jsonb, uuid, text, jsonb), public.run_workflows(),
  public.claim_automation_jobs(text, int), public.finish_automation_job(bigint, boolean, jsonb, text),
  public.prune_workflow_history(), public.digest_automation_tasks(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.can_edit_automations(uuid), public._validate_workflow(jsonb),
  public.save_workflow(uuid, uuid, text, text, boolean, jsonb, boolean), public.set_workflow_enabled(uuid, boolean),
  public.delete_workflow(uuid), public.adopt_workflow(uuid, uuid), public.grant_automation_editor(uuid, uuid, boolean),
  public.set_chapters_may_build(uuid, boolean), public.workflow_overview(uuid), public.workflow_runs(uuid, uuid, int),
  public.complete_automation_task(uuid)
to authenticated, service_role;
grant execute on function
  public.register_automation_trigger(text, text, text, text, text, text, jsonb, jsonb, text, text[], int),
  public.register_automation_action(text, text, text, text, jsonb, text[], int),
  public.register_automation_recipient(text, text, text, text, jsonb, text, int, text),
  public.emit_automation_event(uuid, text, jsonb), public.run_workflows(), public.claim_automation_jobs(text, int),
  public.finish_automation_job(bigint, boolean, jsonb, text), public.prune_workflow_history(),
  public.digest_automation_tasks(uuid, uuid), public._automation_fill(text, jsonb), public._automation_condition(jsonb, jsonb),
  public._automation_recipients(uuid, jsonb, jsonb)
to service_role;
