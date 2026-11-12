-- OpenAppHub core: the low-code workflow designer's engine (S-28, owner approval 2026-11-12).
-- Idempotent.
--
-- A designer workflow is version 2 of the definition: the trigger, then a list of steps that can
-- nest (conditions, switches, "for each", scopes). Like Power Automate, **every step's output
-- can be used by any later step**: a parameter is a value, or a reference written
-- {{steps.<id>.<field>}}, {{trigger.<field>}}, {{item.<field>}} (the current "for each" item),
-- {{items.<loop id>.<field>}}, {{vars.<name>}}. A parameter that is only a reference keeps its type,
-- so a lookup's list of members ({{steps.find.rows}}) feeds a later "for each".
--
--   { "version": 2,
--     "trigger": { "type": "...", "params": {} },
--     "steps": [ { "id": "find", "type": "charter.find_members", "name": "Find lapsed members",
--                  "params": { "standing": "lapsed" } },
--                { "id": "each", "type": "foreach", "params": { "items": "{{steps.find.rows}}" },
--                  "steps": [ { "id": "mail", "type": "email",
--                               "params": { "to": { "type": "address", "email": "{{item.email}}" },
--                                           "subject": "Renew, {{item.name}}", "message": "..." } } ] } ] }
--
-- Step types: email, task; condition (then/else), switch (cases/default), foreach, scope;
-- init_variable, set_variable, increment_variable, append_variable; compose, filter, select,
-- join, aggregate; wait; terminate; and every step the apps register (lookups run at once,
-- "call" steps run at once, "job" steps are done by the app and the run waits for them).
-- Each step may set "run_after" ({ "<earlier sibling id>": ["succeeded", "failed", "skipped"] };
-- default: the previous step succeeded) and "retry" ({ "count": 0-10, "interval_minutes":
-- 1-1440, "backoff": "fixed" | "exponential" }).
--
-- The runner records every step's status and output in the run's state, so a run can pause
-- (waits, retries, app jobs) and carry on later without doing anything twice. Workflows run as
-- the organization (owner decision 2026-11-12).

-- ── Steps the apps offer: lookups, immediate actions, jobs ────────────────────────────────────
alter table public.automation_action_types add column if not exists kind text not null default 'job';
alter table public.automation_action_types add column if not exists run_fn text;
alter table public.automation_action_types add column if not exists output_schema jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_action_types_kind') then
    alter table public.automation_action_types add constraint automation_action_types_kind check (kind in ('job', 'query', 'call'));
  end if;
end $$;

-- kind: 'query' (looks something up: fn(p_org uuid, p_params jsonb) → jsonb, read-only), 'call'
-- (does something at once: same signature), 'job' (queued for the app's /automation/run).
-- output_schema: [{ key, label, type: text|number|date|boolean|list|object, fields?: [...] }].
create or replace function public.register_automation_step(
  p_type text, p_app text, p_label text, p_description text, p_kind text, p_run_fn text,
  p_params_schema jsonb, p_output_schema jsonb, p_requires text[] default '{}', p_sort int default 100
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.automation_action_types (type, app, label, description, params_schema, requires, sort, kind, run_fn, output_schema)
  values (p_type, p_app, p_label, coalesce(p_description, ''), coalesce(p_params_schema, '{}'), coalesce(p_requires, '{}'),
          coalesce(p_sort, 100), coalesce(p_kind, 'job'), p_run_fn, coalesce(p_output_schema, '[]'))
  on conflict (type) do update set app = excluded.app, label = excluded.label, description = excluded.description,
    params_schema = excluded.params_schema, requires = excluded.requires, sort = excluded.sort,
    kind = excluded.kind, run_fn = excluded.run_fn, output_schema = excluded.output_schema;
$$;
revoke all on function public.register_automation_step(text, text, text, text, text, text, jsonb, jsonb, text[], int) from public, anon, authenticated;

-- ── Runs that can pause ────────────────────────────────────────────────────────────────────────
alter table public.automation_runs add column if not exists version int not null default 1;
alter table public.automation_runs add column if not exists state jsonb not null default '{}'::jsonb;
alter table public.automation_runs add column if not exists trace jsonb not null default '[]'::jsonb;
alter table public.automation_runs add column if not exists resume_at timestamptz;
alter table public.automation_runs add column if not exists wait_job bigint;
alter table public.automation_runs drop constraint if exists automation_runs_status_check;
alter table public.automation_runs add constraint automation_runs_status_check
  check (status in ('done', 'failed', 'nothing', 'running', 'waiting', 'cancelled'));
create index if not exists automation_runs_waiting on public.automation_runs (resume_at) where status = 'waiting';

-- ── References ─────────────────────────────────────────────────────────────────────────────────
-- A value at a dotted path: steps.find.rows.0.email
create or replace function public._wf2_get(p_ctx jsonb, p_path text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_ctx;
  k text;
begin
  foreach k in array string_to_array(btrim(p_path), '.') loop
    if v is null then return null; end if;
    if jsonb_typeof(v) = 'array' and k ~ '^[0-9]+$' then
      v := v -> k::int;
    elsif jsonb_typeof(v) = 'object' then
      v := v -> k;
    else
      return null;
    end if;
  end loop;
  return v;
end;
$$;

-- As text, for messages: ordered fields show their value, lists their items.
create or replace function public._wf2_text(p_v jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_v is null or jsonb_typeof(p_v) = 'null' then ''
    when jsonb_typeof(p_v) = 'string' then p_v #>> '{}'
    when jsonb_typeof(p_v) in ('number', 'boolean') then p_v::text
    when jsonb_typeof(p_v) = 'object' and p_v ? 'value' then coalesce(p_v ->> 'value', '')
    when jsonb_typeof(p_v) = 'array' then coalesce((
      select string_agg(case when jsonb_typeof(x) = 'object' and x ? 'name' then x ->> 'name'
                             when jsonb_typeof(x) = 'object' and x ? 'value' then x ->> 'value'
                             when jsonb_typeof(x) in ('object', 'array') then x::text
                             else x #>> '{}' end, ', ')
      from jsonb_array_elements(p_v) x), '')
    else p_v::text end;
$$;

-- Fills references in a value. A string that is only one reference keeps the referenced type.
create or replace function public._wf2_resolve(p_val jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_s text;
  m text[];
  v_out jsonb;
  k text;
  x jsonb;
begin
  if p_val is null then return null; end if;
  case jsonb_typeof(p_val)
    when 'string' then
      v_s := p_val #>> '{}';
      if position('{{' in v_s) = 0 then return p_val; end if;
      m := regexp_match(v_s, '^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$');
      if m is not null then
        return coalesce(public._wf2_get(p_ctx, m[1]), 'null'::jsonb);
      end if;
      for m in select regexp_matches(v_s, '\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', 'g') loop
        v_s := regexp_replace(v_s, '\{\{\s*' || replace(m[1], '.', '\.') || '\s*\}\}',
                              replace(public._wf2_text(public._wf2_get(p_ctx, m[1])), '\', '\\'), 'g');
      end loop;
      return to_jsonb(v_s);
    when 'object' then
      v_out := '{}';
      for k, x in select * from jsonb_each(p_val) loop
        v_out := v_out || jsonb_build_object(k, public._wf2_resolve(x, p_ctx));
      end loop;
      return v_out;
    when 'array' then
      return coalesce((select jsonb_agg(public._wf2_resolve(e, p_ctx) order by o)
                       from jsonb_array_elements(p_val) with ordinality t (e, o)), '[]');
    else
      return p_val;
  end case;
end;
$$;

-- One condition: { "left": <value or reference>, "op": eq|ne|lt|lte|gt|gte|between|in|contains|
-- is_empty|is_not_empty|is_true|is_false, "right": ..., "right2": ..., "ordered": [list] }.
-- With "ordered" (like ranks), values compare by their place in that list.
create or replace function public._wf2_condition(p_c jsonb, p_ctx jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  l jsonb := public._wf2_resolve(p_c -> 'left', p_ctx);
  r jsonb := public._wf2_resolve(p_c -> 'right', p_ctx);
  r2 jsonb := public._wf2_resolve(p_c -> 'right2', p_ctx);
  v_op text := p_c ->> 'op';
  lt text := public._wf2_text(l);
  rt text := public._wf2_text(r);
  r2t text := public._wf2_text(r2);
  a numeric; b numeric; c numeric;
  v_ord jsonb := p_c -> 'ordered';
begin
  if v_op = 'is_empty' then
    return lt = '' or (jsonb_typeof(l) = 'array' and jsonb_array_length(l) = 0);
  end if;
  if v_op = 'is_not_empty' then
    return not (lt = '' or (jsonb_typeof(l) = 'array' and jsonb_array_length(l) = 0));
  end if;
  if v_op = 'is_true' then return lower(lt) in ('true', 'yes', '1'); end if;
  if v_op = 'is_false' then return lower(lt) not in ('true', 'yes', '1'); end if;
  if v_op = 'contains' then
    if jsonb_typeof(l) = 'array' then
      return exists (select 1 from jsonb_array_elements(l) x where lower(public._wf2_text(x)) = lower(rt));
    end if;
    return position(lower(rt) in lower(lt)) > 0;
  end if;
  if v_op = 'in' then
    if jsonb_typeof(r) = 'array' then
      return exists (select 1 from jsonb_array_elements(r) x where lower(public._wf2_text(x)) = lower(lt));
    end if;
    return exists (select 1 from unnest(string_to_array(rt, ',')) x where lower(btrim(x)) = lower(lt));
  end if;
  if jsonb_typeof(v_ord) = 'array' then
    select o - 1 into a from jsonb_array_elements_text(v_ord) with ordinality t (x, o) where lower(x) = lower(lt);
    select o - 1 into b from jsonb_array_elements_text(v_ord) with ordinality t (x, o) where lower(x) = lower(rt);
    select o - 1 into c from jsonb_array_elements_text(v_ord) with ordinality t (x, o) where lower(x) = lower(r2t);
  else
    begin
      a := lt::numeric; b := rt::numeric;
      c := nullif(r2t, '')::numeric;
    exception when others then
      a := null;
    end;
  end if;
  if a is null or b is null then
    -- Text and ISO dates compare as text.
    return case v_op
      when 'eq' then lower(lt) = lower(rt)
      when 'ne' then lower(lt) <> lower(rt)
      when 'lt' then lt < rt when 'lte' then lt <= rt
      when 'gt' then lt > rt when 'gte' then lt >= rt
      when 'between' then lt between rt and r2t
      else false end;
  end if;
  return case v_op
    when 'eq' then a = b when 'ne' then a <> b
    when 'lt' then a < b when 'lte' then a <= b
    when 'gt' then a > b when 'gte' then a >= b
    when 'between' then a between least(b, coalesce(c, b)) and greatest(b, coalesce(c, b))
    else false end;
end;
$$;

create or replace function public._wf2_conditions(p_conds jsonb, p_match text, p_ctx jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_match, 'all') = 'any'
    then exists (select 1 from jsonb_array_elements(coalesce(p_conds, '[]')) c where public._wf2_condition(c, p_ctx))
    else not exists (select 1 from jsonb_array_elements(coalesce(p_conds, '[]')) c where not public._wf2_condition(c, p_ctx)) end;
$$;

-- ── The runner ─────────────────────────────────────────────────────────────────────────────────
-- p_state: { status: {key: succeeded|failed|skipped}, outputs: {key: output}, vars: {},
--            decisions: {key: value}, attempts: {key: n}, waits: {key: timestamp}, jobs: {key: id},
--            count: n, resume_at, wait_job, final }
-- p_ctx: { trigger, steps: {id: output}, vars, item, items: {loop id: item}, loop: {loop id: {index}} }
-- p_env: { org, run, dry, workflow, app }
-- A key is the step's id plus where it is in loops: "mail[3]".
-- Returns succeeded, failed, paused or terminated.
create or replace function public._wf2_exec_list(
  p_steps jsonb, p_iter text, inout p_state jsonb, inout p_ctx jsonb, p_env jsonb, out p_result text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s jsonb;
  v_key text;
  v_local jsonb := '{}';      -- this list's statuses by step id, for run_after
  v_prev text;
  v_ra jsonb;
  v_ok boolean;
  v_res record;
  v_failed text[] := '{}';
  v_handled text[] := '{}';
  k text;
  x jsonb;
begin
  p_result := 'succeeded';
  for s in select * from jsonb_array_elements(coalesce(p_steps, '[]')) loop
    v_key := (s ->> 'id') || coalesce(p_iter, '');
    -- Done before (a run carrying on): reuse what it did.
    if p_state -> 'status' ? v_key then
      v_local := v_local || jsonb_build_object(s ->> 'id', p_state #>> array['status', v_key]);
      p_ctx := jsonb_set(p_ctx, array['steps', s ->> 'id'], coalesce(p_state #> array['outputs', v_key], 'null'), true);
      if p_state #>> array['status', v_key] = 'failed' then v_failed := v_failed || (s ->> 'id'); end if;
      v_prev := s ->> 'id';
      continue;
    end if;
    -- Run after: the previous step succeeded, unless it says otherwise.
    v_ra := s -> 'run_after';
    if v_ra is null or jsonb_typeof(v_ra) <> 'object' or v_ra = '{}' then
      v_ra := case when v_prev is null then '{}' else jsonb_build_object(v_prev, '["succeeded"]'::jsonb) end;
    end if;
    v_ok := true;
    for k, x in select * from jsonb_each(v_ra) loop
      if not coalesce(x ? (v_local ->> k), false) then v_ok := false; end if;
      if x ? 'failed' then v_handled := v_handled || k; end if;
    end loop;
    if not v_ok then
      p_state := jsonb_set(p_state, array['status', v_key], '"skipped"', true);
      p_state := jsonb_set(p_state, '{trace}', coalesce(p_state -> 'trace', '[]') || jsonb_build_array(
        jsonb_build_object('key', v_key, 'id', s ->> 'id', 'name', coalesce(s ->> 'name', s ->> 'type'), 'type', s ->> 'type',
                           'status', 'skipped', 'detail', 'The steps it runs after didn''t end the way it needs.')), true);
      v_local := v_local || jsonb_build_object(s ->> 'id', 'skipped');
      p_ctx := jsonb_set(p_ctx, array['steps', s ->> 'id'], 'null', true);
      v_prev := s ->> 'id';
      continue;
    end if;

    select * into v_res from public._wf2_exec_step(s, v_key, p_iter, p_state, p_ctx, p_env);
    p_state := v_res.p_state;
    p_ctx := v_res.p_ctx;
    if v_res.p_result in ('paused', 'terminated') then
      p_result := v_res.p_result;
      return;
    end if;
    v_local := v_local || jsonb_build_object(s ->> 'id', v_res.p_result);
    if v_res.p_result = 'failed' then v_failed := v_failed || (s ->> 'id'); end if;
    v_prev := s ->> 'id';
  end loop;
  -- A failure counts unless a later step was set to run after it failed.
  if exists (select 1 from unnest(v_failed) f where not f = any (v_handled)) then
    p_result := 'failed';
  end if;
end;
$$;

create or replace function public._wf2_trace(p_state jsonb, p_s jsonb, p_key text, p_status text, p_detail text, p_output jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(p_state, '{trace}', coalesce(p_state -> 'trace', '[]') || jsonb_build_array(jsonb_build_object(
    'key', p_key, 'id', p_s ->> 'id', 'name', coalesce(nullif(p_s ->> 'name', ''), p_s ->> 'type'), 'type', p_s ->> 'type',
    'status', p_status, 'detail', coalesce(p_detail, ''),
    'output', case when p_output is null then null when length(p_output::text) > 2000 then to_jsonb(left(p_output::text, 2000) || '…') else p_output end,
    'at', now())), true);
$$;

create or replace function public._wf2_people(p_org uuid, p_to jsonb, p_ctx jsonb)
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x jsonb;
begin
  case p_to ->> 'type'
    when 'address' then
      -- An email address, e.g. {{item.email}} from a lookup of members.
      if coalesce(btrim(p_to ->> 'email'), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        return query select (select m.user_id from public.memberships m join auth.users u on u.id = m.user_id
                             where m.org_id = p_org and lower(u.email::text) = lower(btrim(p_to ->> 'email')) limit 1),
                            lower(btrim(p_to ->> 'email'));
      end if;
    when 'people' then
      -- Everyone in a list (e.g. a lookup's rows), by their user id or email address.
      for x in select * from jsonb_array_elements(case when jsonb_typeof(p_to -> 'items') = 'array' then p_to -> 'items' else '[]' end) loop
        if x ->> 'user_id' ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = (x ->> 'user_id')::uuid) then
          return query select (x ->> 'user_id')::uuid, null::text;
        elsif coalesce(x ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          return query select null::uuid, lower(x ->> 'email');
        end if;
      end loop;
    else
      return query select * from public._automation_recipients(p_org, p_to, p_ctx -> 'trigger');
  end case;
end;
$$;

create or replace function public._wf2_exec_step(
  s jsonb, p_key text, p_iter text, inout p_state jsonb, inout p_ctx jsonb, p_env jsonb, out p_result text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_type text := s ->> 'type';
  v_org uuid := (p_env ->> 'org')::uuid;
  v_dry boolean := coalesce((p_env ->> 'dry')::boolean, false);
  p jsonb;
  v_out jsonb;
  v_detail text;
  v_status text := 'succeeded';
  v_items jsonb;
  v_n int;
  v_i int;
  v_sub record;
  v_branch jsonb;
  v_save jsonb;
  v_any_failed boolean := false;
  v_t public.automation_action_types;
  v_job public.automation_jobs;
  v_until timestamptz;
  v_val jsonb;
  v_acc jsonb;
  v_attempt int;
  v_retry jsonb;
  v_count int;
  v_delay interval;
  v_app text := coalesce(p_env ->> 'app', 'hub');
  r record;
  x jsonb;
  k text;
begin
  p_result := 'succeeded';
  v_n := coalesce((p_state ->> 'count')::int, 0) + 1;
  if v_n > 10000 then
    raise exception 'This run went over 10,000 steps.' using errcode = '54000';
  end if;
  p_state := jsonb_set(p_state, '{count}', to_jsonb(v_n), true);

  begin
    case v_type
      -- Containers ------------------------------------------------------------------------------
      when 'condition' then
        if not (p_state -> 'decisions' ? p_key) then
          p_state := jsonb_set(p_state, array['decisions', p_key],
            to_jsonb(public._wf2_conditions(s #> '{params,conditions}', s #>> '{params,match}', p_ctx)), true);
        end if;
        v_branch := case when (p_state #>> array['decisions', p_key])::boolean then s -> 'then' else s -> 'else' end;
        select * into v_sub from public._wf2_exec_list(v_branch, p_iter, p_state, p_ctx, p_env);
        p_state := v_sub.p_state; p_ctx := v_sub.p_ctx;
        if v_sub.p_result in ('paused', 'terminated') then p_result := v_sub.p_result; return; end if;
        v_status := v_sub.p_result;
        v_out := jsonb_build_object('result', (p_state #>> array['decisions', p_key])::boolean);
        v_detail := case when (p_state #>> array['decisions', p_key])::boolean then 'Yes' else 'No' end;

      when 'switch' then
        if not (p_state -> 'decisions' ? p_key) then
          v_val := public._wf2_resolve(s #> '{params,on}', p_ctx);
          v_i := null;
          for x in select e from jsonb_array_elements(coalesce(s -> 'cases', '[]')) with ordinality t (e, o) order by o loop
            if lower(public._wf2_text(v_val)) = lower(public._wf2_text(public._wf2_resolve(x -> 'equals', p_ctx))) then
              select o - 1 into v_i from jsonb_array_elements(s -> 'cases') with ordinality t (e, o) where e = x limit 1;
              exit;
            end if;
          end loop;
          p_state := jsonb_set(p_state, array['decisions', p_key], coalesce(to_jsonb(v_i), '"default"'), true);
        end if;
        v_val := p_state #> array['decisions', p_key];
        v_branch := case when jsonb_typeof(v_val) = 'number' then s #> array['cases', v_val::text, 'steps'] else s -> 'default' end;
        select * into v_sub from public._wf2_exec_list(v_branch, p_iter, p_state, p_ctx, p_env);
        p_state := v_sub.p_state; p_ctx := v_sub.p_ctx;
        if v_sub.p_result in ('paused', 'terminated') then p_result := v_sub.p_result; return; end if;
        v_status := v_sub.p_result;
        v_out := jsonb_build_object('case', v_val);
        v_detail := case when jsonb_typeof(v_val) = 'number' then format('Case %s', v_val::int + 1) else 'Default' end;

      when 'foreach' then
        if not (p_state -> 'decisions' ? p_key) then
          v_items := public._wf2_resolve(s #> '{params,items}', p_ctx);
          if jsonb_typeof(v_items) <> 'array' then
            raise exception '"For each" needs a list (for example a lookup''s rows).' using errcode = '22023';
          end if;
          if jsonb_array_length(v_items) > 5000 then
            raise exception '"For each" goes through up to 5,000 items; this list has %.', jsonb_array_length(v_items) using errcode = '22023';
          end if;
          p_state := jsonb_set(p_state, array['decisions', p_key], v_items, true);
        end if;
        v_items := p_state #> array['decisions', p_key];
        v_save := jsonb_build_object('item', p_ctx -> 'item', 'items', p_ctx -> 'items', 'loop', p_ctx -> 'loop');
        for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
          p_ctx := jsonb_set(p_ctx, '{item}', v_items -> v_i, true);
          p_ctx := jsonb_set(p_ctx, '{items}', coalesce(p_ctx -> 'items', '{}') || jsonb_build_object(s ->> 'id', v_items -> v_i), true);
          p_ctx := jsonb_set(p_ctx, '{loop}', coalesce(p_ctx -> 'loop', '{}') || jsonb_build_object(s ->> 'id', jsonb_build_object('index', v_i, 'number', v_i + 1)), true);
          select * into v_sub from public._wf2_exec_list(s -> 'steps', coalesce(p_iter, '') || format('[%s]', v_i), p_state, p_ctx, p_env);
          p_state := v_sub.p_state; p_ctx := v_sub.p_ctx;
          if v_sub.p_result in ('paused', 'terminated') then p_result := v_sub.p_result; return; end if;
          if v_sub.p_result = 'failed' then v_any_failed := true; end if;
        end loop;
        p_ctx := p_ctx || jsonb_build_object('item', v_save -> 'item', 'items', coalesce(v_save -> 'items', '{}'), 'loop', coalesce(v_save -> 'loop', '{}'));
        v_status := case when v_any_failed then 'failed' else 'succeeded' end;
        v_out := jsonb_build_object('count', jsonb_array_length(v_items));
        v_detail := format('%s %s', jsonb_array_length(v_items), case when jsonb_array_length(v_items) = 1 then 'item' else 'items' end);

      when 'scope' then
        select * into v_sub from public._wf2_exec_list(s -> 'steps', p_iter, p_state, p_ctx, p_env);
        p_state := v_sub.p_state; p_ctx := v_sub.p_ctx;
        if v_sub.p_result in ('paused', 'terminated') then p_result := v_sub.p_result; return; end if;
        v_status := v_sub.p_result;
        v_out := jsonb_build_object('status', v_status);

      -- Variables -------------------------------------------------------------------------------
      when 'init_variable', 'set_variable' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        v_val := p -> 'value';
        if v_type = 'init_variable' then
          v_val := case p ->> 'kind'
            when 'number' then to_jsonb(coalesce(nullif(public._wf2_text(v_val), '')::numeric, 0))
            when 'list' then case when jsonb_typeof(v_val) = 'array' then v_val else '[]'::jsonb end
            when 'boolean' then to_jsonb(lower(public._wf2_text(v_val)) in ('true', 'yes', '1'))
            else coalesce(v_val, '""') end;
        end if;
        p_ctx := jsonb_set(p_ctx, array['vars', p ->> 'name'], coalesce(v_val, 'null'), true);
        v_out := jsonb_build_object('value', v_val);
      when 'increment_variable' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        v_val := to_jsonb(coalesce(nullif(public._wf2_text(p_ctx #> array['vars', p ->> 'name']), '')::numeric, 0)
                          + coalesce(nullif(public._wf2_text(p -> 'by'), '')::numeric, 1));
        p_ctx := jsonb_set(p_ctx, array['vars', p ->> 'name'], v_val, true);
        v_out := jsonb_build_object('value', v_val);
      when 'append_variable' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        v_acc := p_ctx #> array['vars', p ->> 'name'];
        v_val := case when jsonb_typeof(v_acc) = 'array' then v_acc || jsonb_build_array(p -> 'value')
                      else to_jsonb(public._wf2_text(v_acc) || public._wf2_text(p -> 'value')) end;
        p_ctx := jsonb_set(p_ctx, array['vars', p ->> 'name'], v_val, true);
        v_out := jsonb_build_object('value', v_val);

      -- Data ------------------------------------------------------------------------------------
      when 'compose' then
        v_out := jsonb_build_object('value', public._wf2_resolve(s #> '{params,value}', p_ctx));
      when 'filter', 'select', 'join', 'aggregate' then
        v_items := public._wf2_resolve(s #> '{params,items}', p_ctx);
        if jsonb_typeof(v_items) <> 'array' then
          raise exception 'This step needs a list (for example a lookup''s rows).' using errcode = '22023';
        end if;
        v_save := p_ctx -> 'item';
        v_acc := '[]';
        if v_type = 'filter' then
          for x in select * from jsonb_array_elements(v_items) loop
            p_ctx := jsonb_set(p_ctx, '{item}', x, true);
            if public._wf2_conditions(s #> '{params,conditions}', s #>> '{params,match}', p_ctx) then v_acc := v_acc || jsonb_build_array(x); end if;
          end loop;
          v_out := jsonb_build_object('items', v_acc, 'count', jsonb_array_length(v_acc));
          v_detail := format('%s of %s kept', jsonb_array_length(v_acc), jsonb_array_length(v_items));
        elsif v_type = 'select' then
          for x in select * from jsonb_array_elements(v_items) loop
            p_ctx := jsonb_set(p_ctx, '{item}', x, true);
            v_acc := v_acc || jsonb_build_array(public._wf2_resolve(coalesce(s #> '{params,map}', '{}'), p_ctx));
          end loop;
          v_out := jsonb_build_object('items', v_acc, 'count', jsonb_array_length(v_acc));
        elsif v_type = 'join' then
          v_out := jsonb_build_object('text', coalesce((
            select string_agg(public._wf2_text(case when coalesce(s #>> '{params,field}', '') <> '' then e -> (s #>> '{params,field}') else e end),
                              coalesce(s #>> '{params,separator}', ', ') order by o)
            from jsonb_array_elements(v_items) with ordinality t (e, o)), ''));
        else
          select case s #>> '{params,op}'
              when 'sum' then sum(n) when 'min' then min(n) when 'max' then max(n) when 'average' then round(avg(n), 2)
              else count(*) end
            into v_val
          from (select nullif(public._wf2_text(case when coalesce(s #>> '{params,field}', '') <> '' then e -> (s #>> '{params,field}') else e end), '')::numeric as n
                from jsonb_array_elements(v_items) e) q;
          v_out := jsonb_build_object('value', coalesce(v_val, '0'::jsonb));
          v_detail := public._wf2_text(v_out -> 'value');
        end if;
        p_ctx := jsonb_set(p_ctx, '{item}', coalesce(v_save, 'null'), true);

      -- Time and flow ---------------------------------------------------------------------------
      when 'wait' then
        if v_dry then
          v_out := jsonb_build_object('waited', false);
          v_detail := 'Would wait here (skipped in a test run)';
        elsif p_state -> 'waits' ? p_key then
          v_until := (p_state #>> array['waits', p_key])::timestamptz;
          if now() < v_until then
            p_state := jsonb_set(p_state, '{resume_at}', to_jsonb(v_until), true);
            p_result := 'paused';
            return;
          end if;
          v_out := jsonb_build_object('waited_until', v_until);
          v_detail := format('Waited until %s', to_char(v_until, 'YYYY-MM-DD HH24:MI'));
        else
          p := public._wf2_resolve(s -> 'params', p_ctx);
          if p ->> 'mode' = 'until' then
            v_until := (p ->> 'until')::timestamptz;
          else
            v_until := now() + make_interval(mins => case coalesce(p ->> 'unit', 'days')
              when 'minutes' then 1 when 'hours' then 60 else 1440 end * greatest(coalesce(nullif(p ->> 'amount', '')::numeric, 1), 0)::int);
          end if;
          p_state := jsonb_set(p_state, array['waits', p_key], to_jsonb(v_until), true);
          if now() < v_until then
            p_state := jsonb_set(p_state, '{resume_at}', to_jsonb(v_until), true);
            p_state := public._wf2_trace(p_state, s, p_key, 'waiting', format('Waiting until %s', to_char(v_until, 'YYYY-MM-DD HH24:MI')), null);
            p_result := 'paused';
            return;
          end if;
          v_out := jsonb_build_object('waited_until', v_until);
        end if;
      when 'terminate' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        p_state := jsonb_set(p_state, '{final}', jsonb_build_object('status', coalesce(p ->> 'status', 'succeeded'), 'message', coalesce(p ->> 'message', '')), true);
        p_state := jsonb_set(p_state, array['status', p_key], '"succeeded"', true);
        p_state := public._wf2_trace(p_state, s, p_key, 'succeeded', coalesce(nullif(p ->> 'message', ''), 'Stopped the run'), null);
        p_result := 'terminated';
        return;

      -- People ----------------------------------------------------------------------------------
      when 'email' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        v_count := 0;
        for r in select distinct * from public._wf2_people(v_org, p -> 'to', p_ctx) loop
          if not v_dry then
            perform public.enqueue_email(v_app, 'automation.message', v_org, r.user_id, r.email,
              jsonb_build_object('subject', public._wf2_text(p -> 'subject'), 'message', public._wf2_text(p -> 'message'),
                'workflow', p_env ->> 'workflow', 'link', p_ctx #>> '{trigger,link}', 'link_app', p_ctx #>> '{trigger,link_app}'),
              'essential', format('wf2:%s:%s:%s', p_env ->> 'run', p_key, coalesce(r.user_id::text, r.email)));
          end if;
          v_count := v_count + 1;
        end loop;
        if v_count = 0 then raise exception 'Nobody to email (is that seat or office filled, or the address empty?)' using errcode = 'P0002'; end if;
        v_out := jsonb_build_object('count', v_count);
        v_detail := format('%s %s %s', case when v_dry then 'Would email' else 'Emailed' end, v_count, case when v_count = 1 then 'person' else 'people' end);
      when 'task' then
        p := public._wf2_resolve(s -> 'params', p_ctx);
        v_count := 0;
        for r in select distinct x2.user_id from public._wf2_people(v_org, p -> 'to', p_ctx) x2 where x2.user_id is not null loop
          if not v_dry then
            insert into public.automation_tasks (org_id, run_id, assignee_id, title, note, link, due_on)
            values (v_org, (p_env ->> 'run')::bigint, r.user_id, public._wf2_text(p -> 'title'), public._wf2_text(p -> 'note'),
                    p_ctx #>> '{trigger,link}',
                    case when nullif(public._wf2_text(p -> 'due_in_days'), '') is not null then current_date + public._wf2_text(p -> 'due_in_days')::int end);
          end if;
          v_count := v_count + 1;
        end loop;
        if v_count = 0 then raise exception 'Nobody to give it to (is that seat or office filled?)' using errcode = 'P0002'; end if;
        v_out := jsonb_build_object('count', v_count);
        v_detail := format('%s %s %s', case when v_dry then 'Would create' else 'Created' end, v_count, case when v_count = 1 then 'task' else 'tasks' end);

      -- The apps' steps -------------------------------------------------------------------------
      else
        select * into v_t from public.automation_action_types where type = v_type;
        if not found then
          raise exception 'Unknown step "%".', v_type using errcode = '22023';
        end if;
        p := public._wf2_resolve(coalesce(s -> 'params', '{}'), p_ctx);
        if v_t.kind in ('query', 'call') then
          if v_t.kind = 'call' and v_dry then
            v_out := jsonb_build_object('simulated', true);
            v_detail := format('Would %s', lower(v_t.label));
          elsif v_t.run_fn ~ '^[a-z_]+\.[a-z0-9_]+$' and to_regprocedure(v_t.run_fn || '(uuid,jsonb)') is not null then
            execute format('select %s($1, $2)', v_t.run_fn) into v_out using v_org, p;
            v_detail := coalesce(v_out ->> 'summary',
              case when v_out ? 'count' then format('%s found', v_out ->> 'count') end, 'Done');
          else
            raise exception '"%" isn''t available on this server.', v_t.label using errcode = '42883';
          end if;
        else
          -- A job the app does: queue it, and carry on when it's done.
          if v_dry then
            v_out := jsonb_build_object('simulated', true);
            v_detail := format('Would %s', lower(v_t.label));
          elsif p_state -> 'jobs' ? p_key then
            select * into v_job from public.automation_jobs where id = (p_state #>> array['jobs', p_key])::bigint;
            if v_job.status = 'done' then
              v_out := coalesce(v_job.result, '{}');
              v_detail := coalesce(v_job.result ->> 'summary', 'Done');
            elsif v_job.status = 'failed' or v_job.id is null then
              raise exception '%', coalesce(v_job.error, 'The app couldn''t do it.') using errcode = 'P0001';
            else
              p_state := jsonb_set(p_state, '{wait_job}', to_jsonb(v_job.id), true);
              p_result := 'paused';
              return;
            end if;
          else
            insert into public.automation_jobs (org_id, run_id, app, kind, payload)
            values (v_org, nullif(p_env ->> 'run', '')::bigint, v_t.app, v_t.type,
                    p || jsonb_build_object('ctx', coalesce(p_ctx -> 'trigger', '{}') || coalesce(public._wf2_resolve(s -> 'context', p_ctx), '{}')))
            returning * into v_job;
            p_state := jsonb_set(p_state, array['jobs', p_key], to_jsonb(v_job.id), true);
            p_state := jsonb_set(p_state, '{wait_job}', to_jsonb(v_job.id), true);
            p_state := public._wf2_trace(p_state, s, p_key, 'waiting', format('Waiting for %s', v_t.app), null);
            p_result := 'paused';
            return;
          end if;
        end if;
    end case;
  exception when others then
    if sqlstate = '54000' then raise; end if;   -- over the step limit: the whole run fails
    -- Retry, if the step says so (not in a test run).
    v_retry := coalesce(s -> 'retry', '{}');
    v_attempt := coalesce((p_state #>> array['attempts', p_key])::int, 0) + 1;
    if not v_dry and v_attempt <= least(coalesce((v_retry ->> 'count')::int, 0), 10) then
      p_state := jsonb_set(p_state, array['attempts', p_key], to_jsonb(v_attempt), true);
      v_delay := make_interval(mins => least(greatest(coalesce((v_retry ->> 'interval_minutes')::int, 5), 1), 1440)
        * case when v_retry ->> 'backoff' = 'exponential' then (2 ^ (v_attempt - 1))::int else 1 end);
      p_state := jsonb_set(p_state, '{resume_at}', to_jsonb(now() + v_delay), true);
      p_state := public._wf2_trace(p_state, s, p_key, 'retrying', format('Try %s failed (%s); trying again at %s', v_attempt, sqlerrm, to_char(now() + v_delay, 'HH24:MI')), null);
      p_result := 'paused';
      return;
    end if;
    v_status := 'failed';
    v_detail := sqlerrm;
    v_out := jsonb_build_object('error', sqlerrm);
  end;

  p_state := jsonb_set(p_state, array['status', p_key], to_jsonb(v_status), true);
  p_state := jsonb_set(p_state, array['outputs', p_key], coalesce(v_out, '{}'), true);
  p_state := public._wf2_trace(p_state, s, p_key, v_status, v_detail, v_out);
  p_ctx := jsonb_set(p_ctx, array['steps', s ->> 'id'], coalesce(v_out, '{}'), true);
  p_result := v_status;
end;
$$;

-- A run's state starts with its containers (jsonb_set only creates the last key of a path).
create or replace function public._wf2_empty_state()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"status": {}, "outputs": {}, "decisions": {}, "attempts": {}, "waits": {}, "jobs": {}, "vars": {}, "trace": [], "count": 0}'::jsonb;
$$;

-- Carries a run on from where it is (start, after a wait, after an app's job).
create or replace function public._wf2_continue(p_run bigint)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.automation_runs;
  v_wf public.automation_workflows;
  v_def jsonb;
  v_res record;
  v_state jsonb;
  v_ctx jsonb;
  v_status text;
  v_app text := case
    when to_regclass('hub.instance') is not null then 'hub'
    when to_regclass('charter.units') is not null then 'charter'
    when to_regclass('board.meetings') is not null then 'board'
    when to_regclass('ledger.transactions') is not null then 'ledger'
    else 'hub' end;
begin
  select * into v from public.automation_runs where id = p_run and status in ('running', 'waiting') for update skip locked;
  if not found then return null; end if;
  select * into v_wf from public.automation_workflows where id = v.workflow_id;
  v_def := coalesce(v_wf.definition, (select src.definition from public.automation_workflows src where src.id = v_wf.adopted_from));
  v_state := public._wf2_empty_state() || (v.state - 'resume_at' - 'wait_job') || jsonb_build_object('trace', v.trace);
  v_ctx := jsonb_build_object('trigger', v.ctx, 'steps', '{}'::jsonb, 'vars', coalesce(v.state -> 'vars', '{}'),
                              'items', '{}'::jsonb, 'loop', '{}'::jsonb, 'run', jsonb_build_object('id', v.id),
                              'today', to_jsonb(current_date));
  begin
    select * into v_res from public._wf2_exec_list(v_def -> 'steps', '', v_state, v_ctx,
      jsonb_build_object('org', v.org_id, 'run', v.id, 'dry', false, 'workflow', v_wf.name, 'app', v_app));
    v_state := v_res.p_state;
    v_status := case v_res.p_result
      when 'paused' then 'waiting'
      when 'terminated' then case when v_state #>> '{final,status}' = 'failed' then 'failed' else 'done' end
      when 'failed' then 'failed'
      else 'done' end;
    v_state := v_state || jsonb_build_object('vars', coalesce(v_res.p_ctx -> 'vars', '{}'));
  exception when others then
    v_status := 'failed';
    v_state := v_state || jsonb_build_object('error', sqlerrm);
  end;
  update public.automation_runs set
    status = v_status,
    state = v_state - 'trace',
    trace = coalesce(v_state -> 'trace', '[]'),
    resume_at = case when v_status = 'waiting' then nullif(v_state ->> 'resume_at', '')::timestamptz end,
    wait_job = case when v_status = 'waiting' then nullif(v_state ->> 'wait_job', '')::bigint end,
    error = case when v_status = 'failed' then coalesce(v_state ->> 'error', v_state #>> '{final,message}',
      (select t ->> 'detail' from jsonb_array_elements(coalesce(v_state -> 'trace', '[]')) t where t ->> 'status' = 'failed' limit 1)) end,
    log = coalesce((select jsonb_agg(jsonb_build_object('action', t ->> 'name', 'ok', t ->> 'status' <> 'failed', 'detail', t ->> 'detail'))
                    from jsonb_array_elements(coalesce(v_state -> 'trace', '[]')) t where t ->> 'status' in ('succeeded', 'failed')), '[]'),
    finished_at = case when v_status in ('done', 'failed') then now() end
  where id = p_run;
  return v_status;
end;
$$;

create or replace function public._wf2_start(p_wf public.automation_workflows, p_def jsonb, p_org uuid, p_dedupe text, p_ctx jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run bigint;
begin
  insert into public.automation_runs (workflow_id, org_id, dedupe_key, trigger_type, ctx, status, version)
  values (p_wf.id, p_org, p_dedupe, p_def #>> '{trigger,type}', p_ctx, 'running', 2)
  on conflict (workflow_id, dedupe_key) do nothing
  returning id into v_run;
  if v_run is null then return null; end if;
  perform public._wf2_continue(v_run);
  return v_run;
end;
$$;

-- Runs waiting on a time or on an app's job, ready to carry on.
create or replace function public._wf2_resume_due()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select ar.id from public.automation_runs ar
    where ar.status = 'waiting' and ar.version = 2
      and ((ar.resume_at is not null and ar.resume_at <= now())
           or exists (select 1 from public.automation_jobs j where j.id = ar.wait_job and j.status in ('done', 'failed')))
    order by ar.resume_at nulls last
    limit 200
  loop
    perform public._wf2_continue(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── Checking a designer workflow before it's saved ─────────────────────────────────────────────
create or replace function public._wf2_core_steps()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['email', 'task', 'condition', 'switch', 'foreach', 'scope', 'init_variable', 'set_variable',
               'increment_variable', 'append_variable', 'compose', 'filter', 'select', 'join', 'aggregate', 'wait', 'terminate'];
$$;

-- Walks the steps in order; p_seen: ids of steps before (references may only point back).
create or replace function public._wf2_validate_list(p_steps jsonb, p_depth int, inout p_seen text[], inout p_vars text[], inout p_count int, p_loops text[])
language plpgsql
stable
set search_path = ''
as $$
declare
  s jsonb;
  v_id text;
  v_type text;
  v_siblings text[] := '{}';
  m text[];
  k text;
  x jsonb;
  v_res record;
  v_t public.automation_action_types;
begin
  if p_steps is null then return; end if;
  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Steps must be a list.' using errcode = '22023';
  end if;
  if p_depth > 8 then
    raise exception 'Steps can nest up to 8 levels deep.' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(p_steps) loop
    p_count := p_count + 1;
    if p_count > 250 then
      raise exception 'A workflow has up to 250 steps.' using errcode = '22023';
    end if;
    v_id := s ->> 'id';
    v_type := s ->> 'type';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,40}$' then
      raise exception 'Every step needs an id (lowercase letters, digits, underscores).' using errcode = '22023';
    end if;
    if v_id = any (p_seen) then
      raise exception 'Two steps share the id "%".', v_id using errcode = '22023';
    end if;
    if not (v_type = any (public._wf2_core_steps())) then
      select * into v_t from public.automation_action_types where type = v_type;
      if not found then
        raise exception 'Step "%" is a kind of step this server doesn''t have (%).', coalesce(s ->> 'name', v_id), v_type using errcode = '22023';
      end if;
    end if;
    -- Run after: earlier steps in the same list only.
    if s ? 'run_after' then
      if jsonb_typeof(s -> 'run_after') <> 'object' then
        raise exception 'Step "%": "run after" must name earlier steps.', v_id using errcode = '22023';
      end if;
      for k, x in select * from jsonb_each(s -> 'run_after') loop
        if not k = any (v_siblings) then
          raise exception 'Step "%" can only run after a step before it at the same level.', v_id using errcode = '22023';
        end if;
        if jsonb_typeof(x) <> 'array' or exists (select 1 from jsonb_array_elements_text(x) y where y not in ('succeeded', 'failed', 'skipped')) then
          raise exception 'Step "%": run after succeeded, failed or skipped.', v_id using errcode = '22023';
        end if;
      end loop;
    end if;
    if s ? 'retry' and (coalesce((s #>> '{retry,count}')::int, 0) not between 0 and 10
        or coalesce((s #>> '{retry,interval_minutes}')::int, 5) not between 1 and 1440) then
      raise exception 'Step "%": retry up to 10 times, 1 minute to 1 day apart.', v_id using errcode = '22023';
    end if;
    -- References point back: to earlier steps, the loops it's in, and variables made before.
    for m in select regexp_matches(coalesce(s -> 'params', '{}')::text || coalesce(s -> 'context', '{}')::text,
                                   '\{\{\s*(steps|items|vars)\.([A-Za-z0-9_]+)', 'g') loop
      if m[1] = 'steps' and not m[2] = any (p_seen) then
        raise exception 'Step "%" uses step "%", which doesn''t come before it.', coalesce(s ->> 'name', v_id), m[2] using errcode = '22023';
      elsif m[1] = 'items' and not m[2] = any (p_loops) then
        raise exception 'Step "%" uses the items of "%", but isn''t inside that "for each".', coalesce(s ->> 'name', v_id), m[2] using errcode = '22023';
      elsif m[1] = 'vars' and not m[2] = any (p_vars) and v_type not in ('init_variable') then
        raise exception 'Step "%" uses variable "%" before it''s made (add "Make a variable" before it).', coalesce(s ->> 'name', v_id), m[2] using errcode = '22023';
      end if;
    end loop;
    if v_type in ('set_variable', 'increment_variable', 'append_variable') and not (s #>> '{params,name}') = any (p_vars) then
      raise exception 'Step "%" changes variable "%" before it''s made.', coalesce(s ->> 'name', v_id), s #>> '{params,name}' using errcode = '22023';
    end if;
    if v_type = 'init_variable' then
      if p_depth > 0 then
        raise exception 'Make variables at the top of the workflow, not inside another step (as in "%").', coalesce(s ->> 'name', v_id) using errcode = '22023';
      end if;
      if coalesce(s #>> '{params,name}', '') !~ '^[a-z][a-z0-9_]{0,40}$' then
        raise exception 'A variable''s name is lowercase letters, digits and underscores.' using errcode = '22023';
      end if;
      p_vars := p_vars || (s #>> '{params,name}');
    end if;
    if v_type = 'foreach' and coalesce(s #>> '{params,items}', '') = '' then
      raise exception '"%" needs a list to go through.', coalesce(s ->> 'name', v_id) using errcode = '22023';
    end if;
    -- Containers: their own steps see this step's loop.
    if v_type = 'condition' then
      select * into v_res from public._wf2_validate_list(s -> 'then', p_depth + 1, p_seen, p_vars, p_count, p_loops);
      p_seen := v_res.p_seen; p_vars := v_res.p_vars; p_count := v_res.p_count;
      select * into v_res from public._wf2_validate_list(s -> 'else', p_depth + 1, p_seen, p_vars, p_count, p_loops);
      p_seen := v_res.p_seen; p_vars := v_res.p_vars; p_count := v_res.p_count;
    elsif v_type = 'switch' then
      for x in select * from jsonb_array_elements(coalesce(s -> 'cases', '[]')) loop
        select * into v_res from public._wf2_validate_list(x -> 'steps', p_depth + 1, p_seen, p_vars, p_count, p_loops);
        p_seen := v_res.p_seen; p_vars := v_res.p_vars; p_count := v_res.p_count;
      end loop;
      select * into v_res from public._wf2_validate_list(s -> 'default', p_depth + 1, p_seen, p_vars, p_count, p_loops);
      p_seen := v_res.p_seen; p_vars := v_res.p_vars; p_count := v_res.p_count;
    elsif v_type in ('foreach', 'scope') then
      select * into v_res from public._wf2_validate_list(s -> 'steps', p_depth + 1, p_seen, p_vars, p_count,
        case when v_type = 'foreach' then p_loops || v_id else p_loops end);
      p_seen := v_res.p_seen; p_vars := v_res.p_vars; p_count := v_res.p_count;
    end if;
    p_seen := p_seen || v_id;
    v_siblings := v_siblings || v_id;
  end loop;
end;
$$;

create or replace function public._validate_workflow_v2(p_def jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_trig public.automation_trigger_types;
  v_params jsonb;
  v_res record;
begin
  select * into v_trig from public.automation_trigger_types where type = p_def #>> '{trigger,type}';
  if not found then
    raise exception 'Choose what starts this workflow (When).' using errcode = '22023';
  end if;
  v_params := public._clean_automation_params(v_trig.params_schema, coalesce(p_def #> '{trigger,params}', '{}'));
  if exists (select 1 from jsonb_each(v_trig.params_schema) s
             where not coalesce((s.value->>'optional')::boolean, false) and not (v_params ? s.key)
               and not (v_trig.type = 'core.schedule' and s.key = 'day' and v_params->>'frequency' = 'daily')) then
    raise exception 'Fill in every setting for "%".', v_trig.label using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_def -> 'steps', '[]')) <> 'array' or jsonb_array_length(coalesce(p_def -> 'steps', '[]')) = 0 then
    raise exception 'Add at least one step.' using errcode = '22023';
  end if;
  select * into v_res from public._wf2_validate_list(p_def -> 'steps', 0, '{}'::text[], '{}'::text[], 0, '{}'::text[]);
  return jsonb_build_object('version', 2, 'trigger', jsonb_build_object('type', v_trig.type, 'params', v_params),
                            'steps', p_def -> 'steps');
end;
$$;

-- ── Trying a workflow without doing anything ───────────────────────────────────────────────────
-- Runs the steps on sample data: lookups run for real (they only read); emails, tasks, the apps'
-- actions and waits are only described. Returns what each step would do.
create or replace function public.test_workflow(p_org uuid, p_definition jsonb, p_trigger jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_def jsonb;
  v_res record;
  v_ctx jsonb;
  v_trigger jsonb := coalesce(p_trigger, public.sample_trigger_data(p_org, p_definition #>> '{trigger,type}'), '{}');
begin
  perform public._require_uid();
  if not public.can_edit_automations(p_org) then
    raise exception 'Only owners, admins and people they choose can test workflows.' using errcode = '42501';
  end if;
  v_def := public._validate_workflow_v2(p_definition);
  v_ctx := jsonb_build_object('trigger', v_trigger, 'steps', '{}'::jsonb, 'vars', '{}'::jsonb, 'items', '{}'::jsonb,
                              'loop', '{}'::jsonb, 'run', jsonb_build_object('id', 0), 'today', to_jsonb(current_date));
  begin
    select * into v_res from public._wf2_exec_list(v_def -> 'steps', '', public._wf2_empty_state(), v_ctx,
      jsonb_build_object('org', p_org, 'run', '', 'dry', true, 'workflow', 'Test', 'app', 'hub'));
  exception when others then
    return jsonb_build_object('status', 'failed', 'error', sqlerrm, 'trace', '[]'::jsonb, 'trigger', v_trigger);
  end;
  return jsonb_build_object(
    'status', case v_res.p_result when 'terminated' then coalesce(v_res.p_state #>> '{final,status}', 'succeeded') else v_res.p_result end,
    'trace', coalesce(v_res.p_state -> 'trace', '[]'), 'vars', coalesce(v_res.p_ctx -> 'vars', '{}'), 'trigger', v_trigger);
end;
$$;

-- What a trigger's data looks like here: the latest event of that kind in this organization,
-- or the first thing a date-based trigger finds today. Null when there's nothing yet.
create or replace function public.sample_trigger_data(p_org uuid, p_type text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_t public.automation_trigger_types;
  s record;
begin
  -- Signed-in callers must belong to the organization (anon can't call it; the service has no uid).
  if auth.uid() is not null and not public.is_member(p_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  select ctx into v from public.automation_events where org_id = p_org and type = p_type order by id desc limit 1;
  if v is not null then return v; end if;
  select * into v_t from public.automation_trigger_types where type = p_type;
  if v_t.kind = 'scan' and v_t.scan_fn ~ '^[a-z_]+\.[a-z0-9_]+$' and to_regprocedure(v_t.scan_fn || '(uuid,jsonb)') is not null then
    begin
      for s in execute format('select * from %s($1, $2) limit 1', v_t.scan_fn) using p_org, '{}'::jsonb loop
        return s.ctx;
      end loop;
    exception when others then
      return null;
    end;
  end if;
  if v_t.kind = 'schedule' then
    return jsonb_build_object('today', current_date, 'summary', format('Scheduled, %s', current_date));
  end if;
  return null;
end;
$$;

revoke all on function public.test_workflow(uuid, jsonb, jsonb), public.sample_trigger_data(uuid, text) from public, anon;
grant execute on function public.test_workflow(uuid, jsonb, jsonb), public.sample_trigger_data(uuid, text) to authenticated, service_role;
revoke all on function public._wf2_exec_list(jsonb, text, jsonb, jsonb, jsonb), public._wf2_exec_step(jsonb, text, text, jsonb, jsonb, jsonb),
  public._wf2_continue(bigint), public._wf2_start(public.automation_workflows, jsonb, uuid, text, jsonb), public._wf2_resume_due(),
  public._wf2_people(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ── The existing engine hands designer workflows over (0009's functions, with that added) ─────
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
  -- Designer workflows (S-28) run step by step and can pause.
  if p_def ->> 'version' = '2' then
    return public._wf2_start(p_wf, p_def, p_org, p_dedupe, p_ctx);
  end if;
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
  -- Designer runs waiting on a time or an app's job (S-28).
  v_n := v_n + public._wf2_resume_due();
  return v_n;
end;
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
  -- A designer run waiting on this job carries on now (S-28).
  if v.run_id is not null and (p_ok or v.status = 'failed')
     and exists (select 1 from public.automation_runs ar where ar.id = v.run_id and ar.version = 2) then
    perform public._wf2_continue(v.run_id);
    return;
  end if;
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
  if p_def ->> 'version' = '2' then
    return public._validate_workflow_v2(p_def);
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
