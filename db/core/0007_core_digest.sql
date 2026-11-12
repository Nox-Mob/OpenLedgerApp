-- OpenAppHub core: the task digest (S-17). Idempotent; runs hosted and self-hosted.
--
-- One email per person with their open tasks and upcoming meetings from every app on this
-- database, on their own schedule. Each person chooses (public.email_preferences):
--   digest            off | daily | weekly (0005)
--   digest_day        weekly: 0 Sunday … 6 Saturday
--   digest_hour       0–23, in digest_time_zone
--   digest_time_zone  an IANA zone; null = their first organization's
--   digest_org_ids    which organizations; null = all of theirs
--   digest_include    tasks and/or meetings
-- public.queue_digests() runs as an email job every 15 minutes and queues a digest for everyone
-- whose time has come (once per local day), skipping people with nothing to report. What each
-- person sees follows each app's own rules (below), since the job runs without their session.

alter table public.email_preferences
  add column if not exists digest_day int not null default 1,
  add column if not exists digest_hour int not null default 7,
  add column if not exists digest_time_zone text,
  add column if not exists digest_org_ids uuid[],
  add column if not exists digest_include text[] not null default '{tasks,meetings}',
  add column if not exists digest_last_sent_at timestamptz;

do $$
begin
  alter table public.email_preferences add constraint email_preferences_digest_day_check check (digest_day between 0 and 6);
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.email_preferences add constraint email_preferences_digest_hour_check check (digest_hour between 0 and 23);
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.email_preferences add constraint email_preferences_digest_include_check
    check (digest_include <@ array['tasks', 'meetings']::text[]);
exception when duplicate_object then null;
end $$;

-- Read your own digest choices (0005's get_email_preferences stays as it is, so re-running 0005
-- by hand still works). digest_time_zone falls back to your first organization's zone.
create or replace function public.get_digest_preferences()
returns table (
  digest text, digest_day int, digest_hour int, digest_time_zone text,
  digest_org_ids uuid[], digest_include text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.digest, 'weekly'), coalesce(p.digest_day, 1),
         coalesce(p.digest_hour, 7),
         coalesce(p.digest_time_zone,
           (select o.time_zone from public.memberships m join public.organizations o on o.id = m.org_id
            where m.user_id = me.uid order by m.created_at, m.org_id limit 1), 'UTC'),
         p.digest_org_ids, coalesce(p.digest_include, '{tasks,meetings}')
  from (select auth.uid() as uid) me
  left join public.email_preferences p on p.user_id = me.uid
  where me.uid is not null;
$$;

create or replace function public.set_digest_preferences(
  p_digest text, p_day int, p_hour int, p_time_zone text, p_org_ids uuid[], p_include text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if p_digest not in ('off', 'daily', 'weekly') then
    raise exception 'Choose off, daily or weekly.' using errcode = '22023';
  end if;
  if p_day is null or p_day not between 0 and 6 then
    raise exception 'Choose a day of the week.' using errcode = '22023';
  end if;
  if p_hour is null or p_hour not between 0 and 23 then
    raise exception 'Choose a time.' using errcode = '22023';
  end if;
  if p_time_zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose a time zone from the list.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_include), 0) = 0 or not (p_include <@ array['tasks', 'meetings']::text[]) then
    raise exception 'Choose what the summary includes.' using errcode = '22023';
  end if;
  -- Only organizations you belong to; an empty list means all of them.
  if p_org_ids is not null and exists (
    select 1 from unnest(p_org_ids) x(id)
    where not exists (select 1 from public.memberships m where m.org_id = x.id and m.user_id = v_uid)
  ) then
    raise exception 'You can only choose your own organizations.' using errcode = '42501';
  end if;
  insert into public.email_preferences (user_id, digest, digest_day, digest_hour, digest_time_zone, digest_org_ids, digest_include)
  values (v_uid, p_digest, p_day, p_hour, p_time_zone, nullif(p_org_ids, '{}'), p_include)
  on conflict (user_id) do update set
    digest = excluded.digest, digest_day = excluded.digest_day, digest_hour = excluded.digest_hour,
    digest_time_zone = excluded.digest_time_zone, digest_org_ids = excluded.digest_org_ids,
    digest_include = excluded.digest_include, updated_at = now();
end;
$$;

-- What one person's digest says: per organization, their open tasks and the coming meetings.
-- Each app's rules, applied without the person's session:
--   Board    action items assigned to them (open or in progress)
--   Charter  its tasks, for owners and admins, and for people who manage the unit in Charter
--   Ledger   recurring transactions due, for owners, admins and treasurers
--   Meetings Board meetings scheduled in the next 7 days (daily: 2 days), for every member
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

-- The email job: queue the digests that are due. Returns how many were queued.
create or replace function public.queue_digests()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_local timestamp;
  v_data jsonb;
  v_n int := 0;
  -- Hosted, the hub sends; on a self-hosted database, the app that's installed.
  v_app text := case
    when to_regclass('hub.instance') is not null then 'hub'
    when to_regclass('charter.units') is not null then 'charter'
    when to_regclass('board.meetings') is not null then 'board'
    when to_regclass('ledger.transactions') is not null then 'ledger'
    else 'hub' end;
begin
  for r in
    select u.user_id,
           coalesce(p.digest, 'weekly') as digest, coalesce(p.digest_day, 1) as day, coalesce(p.digest_hour, 7) as hour,
           coalesce(p.digest_time_zone,
             (select o.time_zone from public.memberships m2 join public.organizations o on o.id = m2.org_id
              where m2.user_id = u.user_id order by m2.created_at, m2.org_id limit 1), 'UTC') as tz,
           p.digest_last_sent_at
    from (select distinct m.user_id from public.memberships m) u
    left join public.email_preferences p on p.user_id = u.user_id
    where coalesce(p.digest, 'weekly') <> 'off'
  loop
    v_local := now() at time zone r.tz;
    continue when extract(hour from v_local) < r.hour;
    continue when r.digest = 'weekly' and extract(dow from v_local) <> r.day;
    -- Once per local day.
    continue when r.digest_last_sent_at is not null and (r.digest_last_sent_at at time zone r.tz)::date = v_local::date;
    v_data := public.digest_for(r.user_id, r.digest);
    insert into public.email_preferences (user_id, digest_last_sent_at) values (r.user_id, now())
    on conflict (user_id) do update set digest_last_sent_at = now();
    continue when jsonb_array_length(v_data->'orgs') = 0;  -- nothing to report
    if public.enqueue_email(v_app, 'digest', null, r.user_id, null, v_data, 'digest',
         format('digest:%s:%s', r.user_id, v_local::date)) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

insert into public.email_jobs (name, fn, every)
values ('core.digest', 'public.queue_digests', interval '15 minutes')
on conflict (name) do update set fn = excluded.fn, every = excluded.every;

revoke all on function public.get_digest_preferences(), public.set_digest_preferences(text, int, int, text, uuid[], text[]),
  public.digest_for(uuid, text), public.queue_digests()
from public, anon, authenticated;
grant execute on function public.get_digest_preferences(), public.set_digest_preferences(text, int, int, text, uuid[], text[])
  to authenticated, service_role;
grant execute on function public.digest_for(uuid, text), public.queue_digests() to service_role;
