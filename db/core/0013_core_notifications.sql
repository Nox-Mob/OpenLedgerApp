-- OpenAppHub core: notifications (H-02, owner direction 2026-11-13). Idempotent.
--
-- Things that happened, told to the people they matter to: in a list in OpenAppHub and every app
-- (the bell), by email, or both. They're fixed by the suite, not built by organizations, and
-- don't go through the automation engine.
--
-- * public.notification_kinds: each kind (a payment failed, someone joined…), who gets it by
--   default (described; the code that raises it chooses them), who else may turn it on, and
--   whether it shows in the app and goes by email by default.
-- * public.notification_preferences: each person's choice per kind (in the app, by email);
--   no row means the kind's defaults, for the people it goes to by default. Someone not in a
--   kind's default audience gets it only after turning it on (and only if they may).
-- * public.notifications: the in-app list, one row per person.
-- * public.notify(): raises one. Emails go through the outbox (template "notification").
--
-- Default audience (owner decision 2026-11-13): the owner; billing kinds also the billing contact
-- (by email). Tasks a workflow gives someone go to that person.

create table if not exists public.notification_kinds (
  kind text primary key check (kind ~ '^[a-z]+\.[a-z0-9_]+$'),
  app text not null,
  label text not null,
  description text not null default '',
  audience text not null default '',                      -- who gets it by default, in words
  default_roles public.org_role[] not null default '{owner}',        -- who gets it without asking (OpenAppHub role)
  eligible_roles public.org_role[] not null default '{owner,admin}',  -- who may turn it on (OpenAppHub role)
  email_category text not null default 'org_activity'
    check (email_category in ('essential', 'reminders', 'billing', 'org_activity')),
  default_in_app boolean not null default true,
  default_email boolean not null default true,
  sort int not null default 100
);
alter table public.notification_kinds enable row level security;
drop policy if exists notification_kinds_read on public.notification_kinds;
create policy notification_kinds_read on public.notification_kinds for select to authenticated using (true);
grant select on public.notification_kinds to authenticated;
grant all on public.notification_kinds to service_role;

create table if not exists public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null references public.notification_kinds (kind) on delete cascade,
  in_app boolean not null,
  email boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.notification_preferences enable row level security;
drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences for select to authenticated using (user_id = auth.uid());
grant select on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null references public.notification_kinds (kind) on delete cascade,
  title text not null,
  body text not null default '',
  link text,
  link_app text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dedupe_key text,
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_recent on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread on public.notifications (user_id) where read_at is null;
alter table public.notifications enable row level security;
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;

create or replace function public.register_notification_kind(
  p_kind text, p_app text, p_label text, p_description text, p_audience text,
  p_eligible public.org_role[], p_email_category text, p_default_in_app boolean, p_default_email boolean, p_sort int default 100,
  p_default_roles public.org_role[] default '{owner}'
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notification_kinds (kind, app, label, description, audience, default_roles, eligible_roles, email_category, default_in_app, default_email, sort)
  values (p_kind, p_app, p_label, coalesce(p_description, ''), coalesce(p_audience, ''), coalesce(p_default_roles, '{owner}'), coalesce(p_eligible, '{owner,admin}'),
          coalesce(p_email_category, 'org_activity'), coalesce(p_default_in_app, true), coalesce(p_default_email, true), coalesce(p_sort, 100))
  on conflict (kind) do update set app = excluded.app, label = excluded.label, description = excluded.description,
    audience = excluded.audience, default_roles = excluded.default_roles, eligible_roles = excluded.eligible_roles, email_category = excluded.email_category,
    default_in_app = excluded.default_in_app, default_email = excluded.default_email, sort = excluded.sort;
$$;
revoke all on function public.register_notification_kind(text, text, text, text, text, public.org_role[], text, boolean, boolean, int, public.org_role[]) from public, anon, authenticated;

-- ── Raising one ────────────────────────────────────────────────────────────────────────────────
-- p_users: the people it goes to by default (they can turn it off); p_emails: addresses that get
-- the email only (a billing contact without an account). Anyone else in the organization who may
-- and turned it on gets it too. The person who caused it (p_actor) isn't told about it.
-- Returns how many people were told.
create or replace function public.notify(
  p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_link_app text,
  p_users uuid[], p_emails text[] default '{}', p_dedupe text default null, p_actor uuid default null
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
      perform public.enqueue_email(v_app, 'notification', p_org, r.user_id, null, v_data, k.email_category,
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
revoke all on function public.notify(uuid, text, text, text, text, text, uuid[], text[], text, uuid) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, text, text, text, uuid[], text[], text, uuid) to service_role;

create or replace function public._org_owner(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.memberships where org_id = p_org and role = 'owner' limit 1;
$$;
revoke all on function public._org_owner(uuid) from public, anon, authenticated;

-- ── Reading and settings (each person, their own) ──────────────────────────────────────────────
create or replace function public.my_notifications(p_limit int default 30, p_org uuid default null)
returns table (id bigint, org_id uuid, org_name text, kind text, kind_label text, title text, body text,
               link text, link_app text, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.org_id, o.name, n.kind, k.label, n.title, n.body, n.link, n.link_app, n.created_at, n.read_at
  from public.notifications n
  join public.notification_kinds k on k.kind = n.kind
  left join public.organizations o on o.id = n.org_id
  where n.user_id = auth.uid() and (p_org is null or n.org_id = p_org)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 200);
$$;

create or replace function public.unread_notification_count()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and read_at is null;
$$;

-- Marks some (or, with null, all) of the caller's notifications read.
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public._require_uid();
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The kinds the caller gets or may turn on, with what they get now: their own choice, or the
-- kind's defaults when they're in its default audience somewhere (the owner, for most), or
-- nothing until they turn it on.
create or replace function public.notification_settings()
returns table (kind text, app text, label text, description text, audience text, email_category text,
               in_app boolean, email boolean, customized boolean, by_default boolean,
               default_in_app boolean, default_email boolean, may_turn_on boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (select array_agg(distinct m.role) as roles from public.memberships m where m.user_id = auth.uid())
  select k.kind, k.app, k.label, k.description, k.audience, k.email_category,
         case when np.user_id is not null then np.in_app when coalesce(mine.roles && k.default_roles, false) then k.default_in_app else false end,
         case when np.user_id is not null then np.email when coalesce(mine.roles && k.default_roles, false) then k.default_email else false end,
         np.user_id is not null, coalesce(mine.roles && k.default_roles, false),
         k.default_in_app, k.default_email,
         coalesce(mine.roles && k.eligible_roles, false)
  from public.notification_kinds k
  cross join mine
  left join public.notification_preferences np on np.kind = k.kind and np.user_id = auth.uid()
  where coalesce(mine.roles && (k.eligible_roles || k.default_roles), false)
  order by k.sort, k.label;
$$;

create or replace function public.set_notification_preference(p_kind text, p_in_app boolean, p_email boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public._require_uid();
  if not exists (select 1 from public.notification_kinds where kind = p_kind) then
    raise exception 'Unknown notification.' using errcode = '22023';
  end if;
  if (coalesce(p_in_app, false) or coalesce(p_email, false)) and not exists (
    select 1 from public.memberships m join public.notification_kinds k on k.kind = p_kind
    where m.user_id = auth.uid() and m.role = any (k.eligible_roles || k.default_roles)
  ) then
    raise exception 'This notification isn''t available to you.' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, kind, in_app, email)
  values (auth.uid(), p_kind, coalesce(p_in_app, false), coalesce(p_email, false))
  on conflict (user_id, kind) do update set in_app = excluded.in_app, email = excluded.email, updated_at = now();
end;
$$;

-- Back to the kind's defaults.
create or replace function public.reset_notification_preference(p_kind text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.notification_preferences where user_id = auth.uid() and kind = p_kind;
$$;

revoke all on function public.my_notifications(int, uuid), public.unread_notification_count(),
  public.mark_notifications_read(bigint[]), public.notification_settings(),
  public.set_notification_preference(text, boolean, boolean), public.reset_notification_preference(text)
from public, anon;
grant execute on function public.my_notifications(int, uuid), public.unread_notification_count(),
  public.mark_notifications_read(bigint[]), public.notification_settings(),
  public.set_notification_preference(text, boolean, boolean), public.reset_notification_preference(text)
to authenticated, service_role;

-- ── The kinds the core raises ──────────────────────────────────────────────────────────────────
select public.register_notification_kind('people.joined', 'hub', 'Someone joined',
  'Someone accepted an invitation or was added to the organization.', 'The owner', '{owner,admin}', 'org_activity', true, true, 40);
select public.register_notification_kind('people.left', 'hub', 'Someone left',
  'Someone left the organization or was removed from it.', 'The owner', '{owner,admin}', 'org_activity', true, true, 41);
select public.register_notification_kind('people.role_changed', 'hub', 'Someone''s role changed',
  'Someone''s role in OpenAppHub, their named role, or their role in an app changed.', 'The owner', '{owner,admin}', 'org_activity', true, true, 42);
select public.register_notification_kind('tasks.assigned', 'hub', 'A task was given to you',
  'A workflow gave you a task on your dashboard.', 'The person the task is for', '{owner,admin,member,viewer}', 'reminders', true, false, 50,
  '{owner,admin,member,viewer}');
select public.register_notification_kind('workflows.failed', 'hub', 'A workflow couldn''t finish',
  'A run of one of your organization''s workflows failed (see What happened on the Automations page).', 'The owner',
  '{owner,admin}', 'org_activity', true, false, 60);

-- People: joined, left, roles. One notification per person per change (several changes made
-- together, like accepting an invitation with roles, are one).
create or replace function public._notify_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_owner uuid;
  v_name text;
  v_kind text;
  v_title text;
  v_flag text := 'openapphub.joined_' || replace(v_user::text, '-', '') || replace(v_org::text, '-', '');
begin
  v_owner := public._org_owner(v_org);
  if v_owner is null or v_user = v_owner then return null; end if;
  select coalesce(nullif(p.display_name, ''), u.email::text, 'Someone') into v_name
  from auth.users u left join public.profiles p on p.id = u.id where u.id = v_user;
  v_name := coalesce(v_name, 'Someone');
  if tg_table_name = 'memberships' and tg_op = 'INSERT' then
    v_kind := 'people.joined'; v_title := format('%s joined', v_name);
    perform set_config(v_flag, '1', true);
  elsif tg_table_name = 'memberships' and tg_op = 'DELETE' then
    if not exists (select 1 from public.organizations where id = v_org) then return null; end if;
    v_kind := 'people.left'; v_title := format('%s left', v_name);
  else
    -- A role changed. Nothing to say when the person is leaving (their app roles go with them)
    -- or joined in this same change (joining is the news; it shares the dedupe key anyway).
    if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = v_user)
       or current_setting(v_flag, true) = '1' then
      return null;
    end if;
    if tg_table_name = 'memberships' and tg_op = 'UPDATE'
       and new.role is not distinct from old.role and new.named_role_id is not distinct from old.named_role_id then
      return null;
    end if;
    v_kind := 'people.role_changed'; v_title := format('%s''s role changed', v_name);
  end if;
  perform public.notify(v_org, v_kind, v_title, '', '/members', 'hub', array[v_owner], '{}',
    format('%s:%s:%s:%s', v_kind, v_org, v_user, txid_current()), auth.uid());
  return null;
end;
$$;
revoke all on function public._notify_people() from public, anon, authenticated;
drop trigger if exists notify_people on public.memberships;
create trigger notify_people after insert or update of role, named_role_id or delete on public.memberships
  for each row execute function public._notify_people();
drop trigger if exists notify_people on public.app_role_overrides;
create trigger notify_people after insert or update or delete on public.app_role_overrides
  for each row execute function public._notify_people();

-- Tasks a workflow gives someone.
create or replace function public._notify_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify(new.org_id, 'tasks.assigned', new.title, coalesce(new.note, ''), '/', 'hub',
    array[new.assignee_id], '{}', format('task:%s', new.id), null);
  return null;
end;
$$;
revoke all on function public._notify_task() from public, anon, authenticated;
drop trigger if exists notify_task on public.automation_tasks;
create trigger notify_task after insert on public.automation_tasks
  for each row execute function public._notify_task();

-- A workflow run that failed.
create or replace function public._notify_run_failed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status <> 'failed' or (tg_op = 'UPDATE' and old.status = 'failed') then return null; end if;
  select name into v_name from public.automation_workflows where id = new.workflow_id;
  perform public.notify(new.org_id, 'workflows.failed', format('"%s" couldn''t finish', coalesce(v_name, 'A workflow')),
    coalesce(new.error, ''), '/automations', 'hub', array[public._org_owner(new.org_id)], '{}', format('run:%s', new.id), null);
  return null;
end;
$$;
revoke all on function public._notify_run_failed() from public, anon, authenticated;
drop trigger if exists notify_run_failed on public.automation_runs;
create trigger notify_run_failed after insert or update of status on public.automation_runs
  for each row execute function public._notify_run_failed();

-- Keep a year.
create or replace function public.prune_notifications()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (delete from public.notifications where created_at < now() - interval '1 year' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.prune_notifications() from public, anon, authenticated;
insert into public.email_jobs (name, fn, every)
values ('core.prune_notifications', 'public.prune_notifications', interval '1 day')
on conflict (name) do nothing;
