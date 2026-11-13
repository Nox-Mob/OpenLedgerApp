-- OpenAppHub core: approvals and actions from email (C-08, owner decisions 2026-11-13). Idempotent.
--
-- * Approvals: a designer step, "Ask for approval", that asks one or more people and waits for
--   their answer. The workflow's builder chooses whether the first answer decides or everyone
--   must approve (one decline declines), and may set a time limit (the outcome is then
--   "timed_out"). Later steps use the outcome, who answered and their comments.
-- * Actions from email: an email can carry links to do what it's about (approve, decline, mark
--   done), when the organization allows that kind of action; each kind is off until an owner or
--   admin switches it on. Otherwise the email only says what's waiting, with a link to the app.
--   A link is for one person and one action, works once, for 7 days, and only signed in as that
--   person; it opens a page that says what will happen and asks to confirm. The action itself is
--   the app's own function, called as the signed-in person, so the app's rules still decide.
-- * Notifications to particular people (a task, an approval, a join request) can't be turned on
--   by anyone else: fixes core 0013, where customizing "A task was given to you" made someone
--   get everyone's.

-- ── Which actions an organization allows from email ────────────────────────────────────────────
create table if not exists public.email_action_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z0-9_]*$'),
  app text not null,
  label text not null,
  description text not null default '',
  sort int not null default 100
);
alter table public.email_action_kinds enable row level security;
drop policy if exists email_action_kinds_read on public.email_action_kinds;
create policy email_action_kinds_read on public.email_action_kinds for select to authenticated using (true);
grant select on public.email_action_kinds to authenticated;
grant all on public.email_action_kinds to service_role;

create table if not exists public.email_action_settings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null references public.email_action_kinds (kind) on delete cascade,
  allowed boolean not null default false,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (org_id, kind)
);
alter table public.email_action_settings enable row level security;
drop policy if exists email_action_settings_read on public.email_action_settings;
create policy email_action_settings_read on public.email_action_settings for select to authenticated using (public.is_member(org_id));
grant select on public.email_action_settings to authenticated;
grant all on public.email_action_settings to service_role;

create or replace function public.register_email_action_kind(p_kind text, p_app text, p_label text, p_description text, p_sort int default 100)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.email_action_kinds (kind, app, label, description, sort)
  values (p_kind, p_app, p_label, coalesce(p_description, ''), coalesce(p_sort, 100))
  on conflict (kind) do update set app = excluded.app, label = excluded.label, description = excluded.description, sort = excluded.sort;
$$;
revoke all on function public.register_email_action_kind(text, text, text, text, int) from public, anon, authenticated;

create or replace function public.email_actions_allowed(p_org uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select allowed from public.email_action_settings where org_id = p_org and kind = p_kind), false);
$$;
revoke all on function public.email_actions_allowed(uuid, text) from public, anon;
grant execute on function public.email_actions_allowed(uuid, text) to authenticated, service_role;

-- Every kind, and whether this organization allows it. Members read; owners and admins change.
create or replace function public.email_action_settings(p_org uuid)
returns table (kind text, app text, label text, description text, allowed boolean, can_change boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_member(p_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  return query
    select k.kind, k.app, k.label, k.description, public.email_actions_allowed(p_org, k.kind),
           public.has_role(p_org, array['owner', 'admin']::public.org_role[])
    from public.email_action_kinds k
    order by k.sort, k.label;
end;
$$;

create or replace function public.set_email_action_allowed(p_org uuid, p_kind text, p_allowed boolean)
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
  if not exists (select 1 from public.email_action_kinds where kind = p_kind) then
    raise exception 'Unknown kind of action.' using errcode = '22023';
  end if;
  insert into public.email_action_settings (org_id, kind, allowed, set_by, set_at)
  values (p_org, p_kind, coalesce(p_allowed, false), auth.uid(), now())
  on conflict (org_id, kind) do update set allowed = excluded.allowed, set_by = excluded.set_by, set_at = now();
end;
$$;
revoke all on function public.email_action_settings(uuid), public.set_email_action_allowed(uuid, text, boolean) from public, anon;
grant execute on function public.email_action_settings(uuid), public.set_email_action_allowed(uuid, text, boolean) to authenticated, service_role;

-- ── Signed links ───────────────────────────────────────────────────────────────────────────────
-- Only the SHA-256 of a link's token is kept. The action is the function the app's own screens
-- call (rpc_schema.rpc_fn with rpc_args); the confirm page calls it as the signed-in person.
create table if not exists public.action_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null references public.email_action_kinds (kind) on delete cascade,
  label text not null,
  what text not null default '',
  rpc_schema text not null check (rpc_schema in ('public', 'charter', 'board', 'ledger')),
  rpc_fn text not null check (rpc_fn ~ '^[a-z_][a-z0-9_]*$'),
  rpc_args jsonb not null default '{}'::jsonb,
  comment_arg text check (comment_arg is null or comment_arg ~ '^[a-z_][a-z0-9_]*$'),
  open_link text,
  open_app text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);
create index if not exists action_links_user on public.action_links (user_id);
alter table public.action_links enable row level security;
grant all on public.action_links to service_role;

-- Makes the links for one person: [{label, token}] for each action, or [] when the organization
-- doesn't allow this kind from email. p_actions: [{label, schema, fn, args, comment_arg}].
create or replace function public.action_links_for(
  p_org uuid, p_user uuid, p_kind text, p_what text, p_actions jsonb, p_open_link text default null, p_open_app text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a jsonb;
  v_token text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_user is null or p_actions is null or jsonb_typeof(p_actions) <> 'array'
     or not public.email_actions_allowed(p_org, p_kind) then
    return v_out;
  end if;
  for a in select * from jsonb_array_elements(p_actions) loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.action_links (token_hash, org_id, user_id, kind, label, what, rpc_schema, rpc_fn, rpc_args, comment_arg, open_link, open_app)
    values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_org, p_user, p_kind, a ->> 'label', coalesce(p_what, ''),
            a ->> 'schema', a ->> 'fn', coalesce(a -> 'args', '{}'), nullif(a ->> 'comment_arg', ''), p_open_link, p_open_app);
    v_out := v_out || jsonb_build_object('label', a ->> 'label', 'token', v_token);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.action_links_for(uuid, uuid, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.action_links_for(uuid, uuid, text, text, jsonb, text, text) to service_role;

-- What a link would do, for the confirm page. Signed in as the person it was sent to only.
-- state: ready | used | expired | not_allowed | other_person | unknown.
create or replace function public.action_link(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.action_links;
  v_base jsonb;
begin
  perform public._require_uid();
  select * into l from public.action_links where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if not found then return jsonb_build_object('state', 'unknown'); end if;
  if l.user_id <> auth.uid() then return jsonb_build_object('state', 'other_person'); end if;
  v_base := jsonb_build_object('label', l.label, 'what', l.what, 'org_id', l.org_id,
    'org_name', (select name from public.organizations where id = l.org_id),
    'kind', l.kind, 'kind_label', (select label from public.email_action_kinds where kind = l.kind),
    'open_link', l.open_link, 'open_app', l.open_app, 'expires_at', l.expires_at, 'used_at', l.used_at);
  if l.used_at is not null then return v_base || jsonb_build_object('state', 'used'); end if;
  if l.expires_at <= now() then return v_base || jsonb_build_object('state', 'expired'); end if;
  if not public.email_actions_allowed(l.org_id, l.kind) then return v_base || jsonb_build_object('state', 'not_allowed'); end if;
  return v_base || jsonb_build_object('state', 'ready',
    'rpc', jsonb_build_object('schema', l.rpc_schema, 'fn', l.rpc_fn, 'args', l.rpc_args), 'comment_arg', l.comment_arg);
end;
$$;

-- After the action succeeded: the link (and its sibling, e.g. Decline after Approve) is used up.
create or replace function public.consume_action_link(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.action_links;
begin
  perform public._require_uid();
  select * into l from public.action_links
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and user_id = auth.uid();
  if not found then return false; end if;
  -- The other links sent for the same thing to this person go too (same email, same target).
  update public.action_links set used_at = now()
  where user_id = l.user_id and used_at is null and org_id = l.org_id and kind = l.kind and created_at = l.created_at;
  return true;
end;
$$;
revoke all on function public.action_link(text), public.consume_action_link(text) from public, anon;
grant execute on function public.action_link(text), public.consume_action_link(text) to authenticated, service_role;

-- ── Approvals ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id bigint references public.automation_runs (id) on delete cascade,
  step_key text not null default '',
  what text not null,
  details text not null default '',
  mode text not null default 'first' check (mode in ('first', 'all')),
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'timed_out', 'cancelled')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approval_requests_org on public.approval_requests (org_id, status);
create table if not exists public.approval_approvers (
  request_id uuid not null references public.approval_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision text check (decision in ('approved', 'declined')),
  comment text not null default '',
  decided_at timestamptz,
  primary key (request_id, user_id)
);
create index if not exists approval_approvers_user on public.approval_approvers (user_id) where decision is null;
alter table public.approval_requests enable row level security;
alter table public.approval_approvers enable row level security;
drop policy if exists approval_requests_read on public.approval_requests;
create policy approval_requests_read on public.approval_requests for select to authenticated using (
  public.has_role(org_id, array['owner', 'admin']::public.org_role[])
  or exists (select 1 from public.approval_approvers a where a.request_id = id and a.user_id = auth.uid()));
drop policy if exists approval_approvers_read on public.approval_approvers;
create policy approval_approvers_read on public.approval_approvers for select to authenticated using (user_id = auth.uid());
grant select on public.approval_requests, public.approval_approvers to authenticated;
grant all on public.approval_requests, public.approval_approvers to service_role;

-- What a decided approval tells later steps.
create or replace function public._approval_output(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'outcome', r.status,
    'approved', r.status = 'approved',
    'what', r.what,
    'decided_by', coalesce((select string_agg(coalesce(nullif(p.display_name, ''), u.email::text), ', ' order by a.decided_at)
                            from public.approval_approvers a join auth.users u on u.id = a.user_id
                            left join public.profiles p on p.id = a.user_id
                            where a.request_id = r.id and a.decision is not null), ''),
    'comment', coalesce((select string_agg(nullif(a.comment, ''), ' / ' order by a.decided_at)
                         from public.approval_approvers a where a.request_id = r.id), ''),
    'approvals', (select count(*) from public.approval_approvers a where a.request_id = r.id and a.decision = 'approved'),
    'declines', (select count(*) from public.approval_approvers a where a.request_id = r.id and a.decision = 'declined'),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(p.display_name, ''), u.email::text),
                             'decision', coalesce(a.decision, 'no answer'), 'comment', a.comment) order by a.decided_at nulls last)
                           from public.approval_approvers a join auth.users u on u.id = a.user_id
                           left join public.profiles p on p.id = a.user_id where a.request_id = r.id), '[]'))
  from public.approval_requests r where r.id = p_id;
$$;
revoke all on function public._approval_output(uuid) from public, anon, authenticated;

-- An approver answers (in the app, or through an email's link). Returns the request's status.
create or replace function public.decide_approval(p_id uuid, p_decision text, p_comment text default '')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_status text;
begin
  perform public._require_uid();
  if p_decision not in ('approved', 'declined') then
    raise exception 'Approve or decline.' using errcode = '22023';
  end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found or not exists (select 1 from public.approval_approvers where request_id = p_id and user_id = auth.uid()) then
    raise exception 'This approval isn''t yours to answer.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This was already decided (%).', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  if r.due_at is not null and r.due_at <= now() then
    raise exception 'The time to answer has passed.' using errcode = '55000';
  end if;
  update public.approval_approvers set decision = p_decision, comment = left(coalesce(p_comment, ''), 2000), decided_at = now()
  where request_id = p_id and user_id = auth.uid() and decision is null;
  if not found then
    raise exception 'You''ve already answered.' using errcode = '55000';
  end if;
  v_status := case
    when r.mode = 'first' then p_decision
    when p_decision = 'declined' then 'declined'
    when not exists (select 1 from public.approval_approvers where request_id = p_id and decision is null) then 'approved'
    else 'pending' end;
  if v_status <> 'pending' then
    update public.approval_requests set status = v_status, decided_at = now() where id = p_id;
    -- Nobody else needs to answer now; their links stop working.
    update public.action_links set used_at = now()
    where used_at is null and kind = 'workflow_approvals' and rpc_fn = 'decide_approval' and rpc_args ->> 'p_id' = p_id::text;
    if r.run_id is not null then perform public._wf2_continue(r.run_id); end if;
  end if;
  return v_status;
end;
$$;

-- The caller's approvals waiting for their answer.
create or replace function public.my_approvals(p_org uuid default null)
returns table (id uuid, org_id uuid, org_name text, what text, details text, mode text, due_at timestamptz, created_at timestamptz, workflow text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.org_id, o.name, r.what, r.details, r.mode, r.due_at, r.created_at, w.name
  from public.approval_requests r
  join public.approval_approvers a on a.request_id = r.id and a.user_id = auth.uid() and a.decision is null
  join public.organizations o on o.id = r.org_id
  left join public.automation_runs ar on ar.id = r.run_id
  left join public.automation_workflows w on w.id = ar.workflow_id
  where r.status = 'pending' and (r.due_at is null or r.due_at > now()) and (p_org is null or r.org_id = p_org)
  order by r.created_at;
$$;

-- One approval, for its page: approvers, and owners and admins.
create or replace function public.approval(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
begin
  perform public._require_uid();
  select * into r from public.approval_requests where id = p_id;
  if not found or not (public.has_role(r.org_id, array['owner', 'admin']::public.org_role[])
                       or exists (select 1 from public.approval_approvers where request_id = p_id and user_id = auth.uid())) then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  return public._approval_output(p_id) || jsonb_build_object(
    'id', r.id, 'org_id', r.org_id, 'org_name', (select name from public.organizations where id = r.org_id),
    'details', r.details, 'mode', r.mode, 'due_at', r.due_at, 'created_at', r.created_at, 'decided_at', r.decided_at,
    'workflow', (select w.name from public.automation_runs ar join public.automation_workflows w on w.id = ar.workflow_id where ar.id = r.run_id),
    'can_answer', r.status = 'pending' and (r.due_at is null or r.due_at > now())
                  and exists (select 1 from public.approval_approvers where request_id = p_id and user_id = auth.uid() and decision is null));
end;
$$;
revoke all on function public.decide_approval(uuid, text, text), public.my_approvals(uuid), public.approval(uuid) from public, anon;
grant execute on function public.decide_approval(uuid, text, text), public.my_approvals(uuid), public.approval(uuid) to authenticated, service_role;

-- ── Kinds ──────────────────────────────────────────────────────────────────────────────────────
select public.register_email_action_kind('workflow_tasks', 'hub', 'Finish workflow tasks from email',
  'The email about a task a workflow gave someone has a "Mark it done" link.', 10);
select public.register_email_action_kind('workflow_approvals', 'hub', 'Answer approvals from email',
  'The email asking for an approval has Approve and Decline links.', 11);

-- Sent to particular people: nobody else may turn these on (eligible_roles empty).
select public.register_notification_kind('tasks.assigned', 'hub', 'A task is waiting for you',
  'A workflow gave you a task. It''s on your dashboard.', 'The person the task is for', '{}', 'essential', true, true, 50,
  '{owner,admin,member,viewer}');
select public.register_notification_kind('workflows.approval_requested', 'hub', 'Something is waiting for your approval',
  'A workflow asks you to approve or decline something.', 'The people asked', '{}', 'essential', true, true, 51,
  '{owner,admin,member,viewer}');


-- ── notify(): emails can carry links to act (C-08) ──────────────────────────────────────────────
-- p_actions: [{label, schema, fn, args, comment_arg}], made into one person's links when the
-- organization allows p_action_kind from email.
drop function if exists public.notify(uuid, text, text, text, text, text, uuid[], text[], text, uuid);
create or replace function public.notify(
  p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_link_app text,
  p_users uuid[], p_emails text[] default '{}', p_dedupe text default null, p_actor uuid default null,
  p_actions jsonb default null, p_action_kind text default null
)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k public.notification_kinds;
  r record;
  v_n int := 0;
  v_app text := case
    when to_regclass('hub.instance') is not null then 'hub'
    when to_regclass('charter.units') is not null then 'charter'
    when to_regclass('board.meetings') is not null then 'board'
    when to_regclass('ledger.transactions') is not null then 'ledger'
    else 'hub' end;
  v_email text;
  v_data jsonb;
  v_user_data jsonb;
  v_links jsonb;
begin
  select * into k from public.notification_kinds where kind = p_kind;
  if not found then return 0; end if;
  v_data := jsonb_build_object('title', p_title, 'body', coalesce(p_body, ''), 'link', p_link, 'link_app', p_link_app,
                               'kind_label', k.label, 'org_name', (select name from public.organizations where id = p_org));
  for r in
    with base as (
      select distinct u as user_id, true as default_audience from unnest(coalesce(p_users, '{}')) u where u is not null
    ), opted as (
      select np.user_id, false as default_audience
      from public.notification_preferences np
      join public.memberships m on m.user_id = np.user_id and m.org_id = p_org
      where np.kind = p_kind and (np.in_app or np.email) and m.role = any (k.eligible_roles)
        and not exists (select 1 from base b where b.user_id = np.user_id)
    )
    select a.user_id,
           coalesce(np.in_app, k.default_in_app) as in_app,
           coalesce(np.email, k.default_email) as email
    from (select * from base union all select * from opted) a
    left join public.notification_preferences np on np.user_id = a.user_id and np.kind = p_kind
    where a.user_id is distinct from p_actor
  loop
    if r.in_app then
      insert into public.notifications (org_id, user_id, kind, title, body, link, link_app, dedupe_key)
      values (p_org, r.user_id, p_kind, p_title, coalesce(p_body, ''), p_link, p_link_app, p_dedupe)
      on conflict (user_id, dedupe_key) do nothing;
    end if;
    if r.email and to_regprocedure('public.enqueue_email(text,text,uuid,uuid,text,jsonb,text,text,timestamptz)') is not null then
      -- Links to act from the email, when the organization allows this kind (C-08).
      v_links := case when p_actions is not null and p_action_kind is not null
        then public.action_links_for(p_org, r.user_id, p_action_kind, p_title, p_actions, p_link, p_link_app) else '[]'::jsonb end;
      v_user_data := v_data || jsonb_build_object('actions', v_links);
      perform public.enqueue_email(v_app, 'notification', p_org, r.user_id, null, v_user_data, k.email_category,
        case when p_dedupe is null then null else format('notif:%s:%s', p_dedupe, r.user_id) end, null);
    end if;
    if r.in_app or r.email then v_n := v_n + 1; end if;
  end loop;
  -- Addresses without an account (a billing contact): email only, unless that address is
  -- someone already told above.
  foreach v_email in array coalesce(p_emails, '{}') loop
    continue when v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    continue when exists (select 1 from auth.users u where lower(u.email::text) = lower(v_email) and u.id = any (coalesce(p_users, '{}')));
    if k.default_email and to_regprocedure('public.enqueue_email(text,text,uuid,uuid,text,jsonb,text,text,timestamptz)') is not null then
      perform public.enqueue_email(v_app, 'notification', p_org, null, lower(v_email), v_data, k.email_category,
        case when p_dedupe is null then null else format('notif:%s:%s', p_dedupe, lower(v_email)) end, null);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text, text, uuid[], text[], text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, text, text, text, uuid[], text[], text, uuid, jsonb, text) to service_role;


create or replace function public._notify_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(new.org_id, 'tasks.assigned', format('A task is waiting for you: %s', new.title),
    concat_ws(E'\n\n', nullif(new.note, ''), case when new.due_on is not null then format('Due %s.', to_char(new.due_on, 'FMMonth FMDD, YYYY')) end,
      'It''s on your OpenAppHub dashboard.'),
    '/', 'hub', array[new.assignee_id], '{}', format('task:%s', new.id), null,
    jsonb_build_array(jsonb_build_object('label', 'Mark it done', 'schema', 'public', 'fn', 'complete_automation_task',
      'args', jsonb_build_object('p_id', new.id))),
    'workflow_tasks');
  return null;
end;
$$;
revoke all on function public._notify_task() from public, anon, authenticated;


-- ── The designer's approval step (S-28 engine) ─────────────────────────────────────────
create or replace function public._wf2_empty_state()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"status": {}, "outputs": {}, "decisions": {}, "attempts": {}, "waits": {}, "jobs": {}, "approvals": {}, "vars": {}, "trace": [], "count": 0}'::jsonb;
$$;

create or replace function public._wf2_core_steps()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['email', 'task', 'condition', 'switch', 'foreach', 'scope', 'init_variable', 'set_variable',
               'increment_variable', 'append_variable', 'compose', 'filter', 'select', 'join', 'aggregate', 'wait', 'terminate', 'approval'];
$$;

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
    if v_type = 'approval' then
      if coalesce(btrim(s #>> '{params,what}'), '') = '' then
        raise exception '"%" needs to say what is to be approved.', coalesce(s ->> 'name', v_id) using errcode = '22023';
      end if;
      if jsonb_typeof(s #> '{params,to}') <> 'object' then
        raise exception '"%" needs someone to ask.', coalesce(s ->> 'name', v_id) using errcode = '22023';
      end if;
      if coalesce(s #>> '{params,mode}', 'first') not in ('first', 'all') then
        raise exception '"%": choose whether the first answer decides or everyone must approve.', coalesce(s ->> 'name', v_id) using errcode = '22023';
      end if;
      if coalesce(s #>> '{params,timeout_days}', '') !~ '^(|[0-9]{1,3})$' or coalesce(nullif(s #>> '{params,timeout_days}', '')::int, 0) > 365 then
        raise exception '"%": the time to answer is a number of days, up to 365.', coalesce(s ->> 'name', v_id) using errcode = '22023';
      end if;
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
  v_ap public.approval_requests;
  v_users uuid[];
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

      when 'approval' then
        -- Ask people to approve or decline; carry on with their answer (C-08).
        if v_dry then
          p := public._wf2_resolve(s -> 'params', p_ctx);
          select count(distinct x2.user_id) into v_count from public._wf2_people(v_org, p -> 'to', p_ctx) x2 where x2.user_id is not null;
          v_out := jsonb_build_object('outcome', 'approved', 'approved', true, 'decided_by', '', 'comment', '', 'approvals', 1,
                                      'declines', 0, 'responses', '[]'::jsonb, 'simulated', true);
          v_detail := format('Would ask %s %s to approve "%s" (a test run carries on as if approved)', v_count,
                             case when v_count = 1 then 'person' else 'people' end, public._wf2_text(p -> 'what'));
        elsif p_state -> 'approvals' ? p_key then
          select * into v_ap from public.approval_requests where id = (p_state #>> array['approvals', p_key])::uuid for update;
          if not found then
            raise exception 'The approval request is gone.' using errcode = 'P0002';
          end if;
          if v_ap.status = 'pending' and v_ap.due_at is not null and now() >= v_ap.due_at then
            update public.approval_requests set status = 'timed_out', decided_at = now() where id = v_ap.id;
            update public.action_links set used_at = now()
            where used_at is null and kind = 'workflow_approvals' and rpc_args ->> 'p_id' = v_ap.id::text;
            v_ap.status := 'timed_out';
          end if;
          if v_ap.status = 'pending' then
            if v_ap.due_at is not null then p_state := jsonb_set(p_state, '{resume_at}', to_jsonb(v_ap.due_at), true); end if;
            p_result := 'paused';
            return;
          end if;
          v_out := public._approval_output(v_ap.id);
          v_detail := case v_ap.status
            when 'approved' then format('Approved by %s', v_out ->> 'decided_by')
            when 'declined' then format('Declined by %s', v_out ->> 'decided_by')
            when 'timed_out' then 'Nobody answered in time'
            else 'Cancelled' end;
        else
          p := public._wf2_resolve(s -> 'params', p_ctx);
          select array_agg(distinct x2.user_id) into v_users
          from public._wf2_people(v_org, p -> 'to', p_ctx) x2 where x2.user_id is not null;
          if coalesce(array_length(v_users, 1), 0) = 0 then
            raise exception 'Nobody to ask (is that seat or office filled, and are they in the organization?)' using errcode = 'P0002';
          end if;
          insert into public.approval_requests (org_id, run_id, step_key, what, details, mode, due_at)
          values (v_org, nullif(p_env ->> 'run', '')::bigint, p_key, left(public._wf2_text(p -> 'what'), 300),
                  left(public._wf2_text(p -> 'details'), 4000), coalesce(nullif(p ->> 'mode', ''), 'first'),
                  case when coalesce(nullif(public._wf2_text(p -> 'timeout_days'), '')::int, 0) > 0
                       then now() + make_interval(days => public._wf2_text(p -> 'timeout_days')::int) end)
          returning * into v_ap;
          insert into public.approval_approvers (request_id, user_id) select v_ap.id, u from unnest(v_users) u;
          perform public.notify(v_org, 'workflows.approval_requested', format('%s is pending your approval', v_ap.what),
            concat_ws(E'\n\n', nullif(v_ap.details, ''),
              case when v_ap.mode = 'all' and array_length(v_users, 1) > 1 then 'Everyone asked must approve it.' end,
              case when v_ap.due_at is not null then format('Please answer by %s.', to_char(v_ap.due_at, 'FMMonth FMDD, YYYY')) end),
            format('/approvals/%s', v_ap.id), 'hub', v_users, '{}', format('approval:%s', v_ap.id), null,
            jsonb_build_array(
              jsonb_build_object('label', 'Approve', 'schema', 'public', 'fn', 'decide_approval',
                'args', jsonb_build_object('p_id', v_ap.id, 'p_decision', 'approved'), 'comment_arg', 'p_comment'),
              jsonb_build_object('label', 'Decline', 'schema', 'public', 'fn', 'decide_approval',
                'args', jsonb_build_object('p_id', v_ap.id, 'p_decision', 'declined'), 'comment_arg', 'p_comment')),
            'workflow_approvals');
          p_state := jsonb_set(p_state, array['approvals', p_key], to_jsonb(v_ap.id), true);
          if v_ap.due_at is not null then p_state := jsonb_set(p_state, '{resume_at}', to_jsonb(v_ap.due_at), true); end if;
          p_state := public._wf2_trace(p_state, s, p_key, 'waiting',
            format('Waiting for %s %s to answer', array_length(v_users, 1), case when array_length(v_users, 1) = 1 then 'person' else 'people' end), null);
          p_result := 'paused';
          return;
        end if;

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
