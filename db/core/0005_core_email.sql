-- OpenAppHub core: email (S-16).
-- Idempotent (runs on the shared database and on self-hosted app databases).
--
-- Every app puts the email it wants sent in one outbox. A sender drains it:
--   hosted       the hub's Worker, every few minutes, through Resend
--   self-hosted  the app's own Worker, through the SMTP server its owner entered
-- Apps never send directly, so retries, opt-outs and the sent-mail log work the
-- same everywhere. Rows carry a template name and its data; the sender renders
-- them with shared/email/templates.ts, so every email looks the same.
--
-- Nothing here is callable by browsers: the outbox, jobs and SMTP settings are
-- for service_role (the sender) and for other security definer functions (an
-- app's job that queues reminders). People manage only their own preferences.

-- The outbox -------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  app text not null check (app ~ '^[a-z][a-z0-9_]*$'),
  template text not null check (template ~ '^[a-z][a-z0-9_.]*$'),
  -- essential: always sent (invitations, security, the test email).
  -- The others can be switched off by the recipient.
  category text not null default 'essential'
    check (category in ('essential', 'reminders', 'digest', 'billing', 'org_activity')),
  to_user_id uuid references auth.users (id) on delete cascade,
  to_email text check (to_email is null or to_email = lower(btrim(to_email))),
  data jsonb not null default '{}'::jsonb,
  -- The same reminder is queued once: e.g. 'board.meeting:<id>:7d'.
  dedupe_key text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  attempts int not null default 0,
  last_error text,
  provider_id text,
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_outbox_recipient check (to_user_id is not null or to_email is not null)
);

create unique index if not exists email_outbox_dedupe_idx on public.email_outbox (dedupe_key)
  where dedupe_key is not null;
create index if not exists email_outbox_due_idx on public.email_outbox (send_after)
  where status in ('queued', 'sending');
create index if not exists email_outbox_org_idx on public.email_outbox (org_id, created_at desc);

-- Preferences for the email apps send (the hub keeps its own billing and
-- organization-activity choices in hub.user_preferences) ----------------------------

create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reminders boolean not null default true,
  digest text not null default 'weekly' check (digest in ('off', 'daily', 'weekly')),
  updated_at timestamptz not null default now()
);

-- SMTP for a self-hosted instance (one row). The password is encrypted by the
-- server before it's stored (shared/email/secret.ts); the database never sees it.

create table if not exists public.instance_email_settings (
  id boolean primary key default true check (id),
  smtp_host text check (smtp_host is null or smtp_host ~ '^[A-Za-z0-9.-]{1,253}$'),
  smtp_port int check (smtp_port is null or smtp_port between 1 and 65535),
  smtp_security text not null default 'starttls' check (smtp_security in ('starttls', 'tls', 'none')),
  smtp_username text check (smtp_username is null or char_length(smtp_username) <= 320),
  smtp_password_enc text,
  from_address text check (from_address is null or from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  from_name text check (from_name is null or char_length(from_name) <= 120),
  reply_to text check (reply_to is null or reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Jobs that queue email on a schedule (an app's reminders, the hub's digest) -----------
-- Each app registers its job in its own migration; the sender runs the due ones
-- before draining the outbox. A job is a security definer function with no
-- arguments that returns how many emails it queued.

create table if not exists public.email_jobs (
  name text primary key check (name ~ '^[a-z][a-z0-9_.]*$'),
  fn text not null,
  every interval not null default interval '15 minutes',
  last_run_at timestamptz,
  last_error text
);

alter table public.email_outbox enable row level security;
alter table public.email_preferences enable row level security;
alter table public.instance_email_settings enable row level security;
alter table public.email_jobs enable row level security;

revoke all on table public.email_outbox, public.email_preferences,
  public.instance_email_settings, public.email_jobs
from public, anon, authenticated;
grant all on table public.email_outbox, public.email_preferences,
  public.instance_email_settings, public.email_jobs
to service_role;

-- Queueing ---------------------------------------------------------------------------

create or replace function public.enqueue_email(
  p_app text,
  p_template text,
  p_org uuid default null,
  p_to_user uuid default null,
  p_to_email text default null,
  p_data jsonb default '{}'::jsonb,
  p_category text default 'essential',
  p_dedupe_key text default null,
  p_send_after timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.email_outbox
    (app, template, org_id, to_user_id, to_email, data, category, dedupe_key, send_after)
  values
    (p_app, p_template, p_org, p_to_user, nullif(lower(btrim(coalesce(p_to_email, ''))), ''),
     coalesce(p_data, '{}'::jsonb), p_category, p_dedupe_key, coalesce(p_send_after, now()))
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id; -- null when this email was already queued
end;
$$;

-- True when the recipient switched this kind of email off.
create or replace function public._email_opted_out(p_user uuid, p_category text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out boolean := false;
begin
  if p_user is null or p_category = 'essential' then
    return false;
  end if;
  if p_category = 'reminders' then
    select not p.reminders into v_out from public.email_preferences p where p.user_id = p_user;
  elsif p_category = 'digest' then
    select p.digest = 'off' into v_out from public.email_preferences p where p.user_id = p_user;
  elsif p_category in ('billing', 'org_activity') and to_regclass('hub.user_preferences') is not null then
    execute format('select not %I from hub.user_preferences where user_id = $1',
      case p_category when 'billing' then 'billing_emails' else 'org_activity_emails' end)
      into v_out using p_user;
  end if;
  return coalesce(v_out, false);
end;
$$;

-- Run the jobs that are due. Each job's failure is recorded and doesn't stop the others.
create or replace function public.run_email_jobs()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int;
  v_total int := 0;
begin
  for r in
    select j.* from public.email_jobs j
    where j.last_run_at is null or j.last_run_at <= now() - j.every
    order by j.name
    for update skip locked
  loop
    begin
      if to_regprocedure(r.fn || '()') is null then
        raise exception 'job function % is missing', r.fn;
      end if;
      execute format('select %s()', r.fn) into v_n;
      v_total := v_total + coalesce(v_n, 0);
      update public.email_jobs set last_run_at = now(), last_error = null where name = r.name;
    exception when others then
      update public.email_jobs set last_run_at = now(), last_error = left(sqlerrm, 500) where name = r.name;
    end;
  end loop;
  return v_total;
end;
$$;

-- Claim a batch to send. Rows stuck in 'sending' for 10 minutes (a sender that
-- died) are claimed again. Opted-out rows are suppressed here. p_apps: a
-- self-hosted app sends only its own email (null: the hub sends everyone's).
create or replace function public.claim_emails(p_limit int default 50, p_apps text[] default null)
returns table (
  id uuid, org_id uuid, app text, template text, category text, to_user_id uuid,
  to_email text, to_name text, org_name text, org_time_zone text, data jsonb, attempts int
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.email_outbox o
  set status = 'suppressed', last_error = 'The recipient switched this email off.'
  where o.status = 'queued' and o.send_after <= now()
    and (p_apps is null or o.app = any (p_apps))
    and public._email_opted_out(o.to_user_id, o.category);

  return query
  with picked as (
    select o.id from public.email_outbox o
    where ((o.status = 'queued' and o.send_after <= now())
       or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes'))
      and (p_apps is null or o.app = any (p_apps))
    order by o.send_after
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    for update skip locked
  ), claimed as (
    update public.email_outbox o
    set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.*
  )
  select c.id, c.org_id, c.app, c.template, c.category, c.to_user_id,
         coalesce(c.to_email, lower(u.email::text)), p.display_name, org.name,
         org.time_zone, c.data, c.attempts
  from claimed c
  left join auth.users u on u.id = c.to_user_id
  left join public.profiles p on p.id = c.to_user_id
  left join public.organizations org on org.id = c.org_id;
end;
$$;

-- Record what happened. 'retry' backs off (1, 5, 30, 120 minutes) and fails after 5 tries.
create or replace function public.finish_email(
  p_id uuid, p_outcome text, p_provider_id text default null, p_error text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'retry', 'failed', 'suppressed') then
    raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
  end if;
  update public.email_outbox o set
    status = case
      when p_outcome = 'retry' and o.attempts >= 5 then 'failed'
      when p_outcome = 'retry' then 'queued'
      else p_outcome end,
    provider_id = coalesce(p_provider_id, o.provider_id),
    last_error = left(p_error, 500),
    sent_at = case when p_outcome = 'sent' then now() else o.sent_at end,
    send_after = case when p_outcome = 'retry'
      then now() + (array[1, 5, 30, 120, 120])[least(o.attempts, 5)] * interval '1 minute'
      else o.send_after end
  where o.id = p_id;
end;
$$;

-- Unsubscribe links (the sender checks the link's signature first).
create or replace function public.email_unsubscribe(p_user uuid, p_category text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_category = 'reminders' then
    insert into public.email_preferences (user_id, reminders) values (p_user, false)
    on conflict (user_id) do update set reminders = false, updated_at = now();
  elsif p_category = 'digest' then
    insert into public.email_preferences (user_id, digest) values (p_user, 'off')
    on conflict (user_id) do update set digest = 'off', updated_at = now();
  elsif p_category in ('billing', 'org_activity') and to_regclass('hub.user_preferences') is not null then
    execute format(
      'insert into hub.user_preferences (user_id, %1$I) values ($1, false)
       on conflict (user_id) do update set %1$I = false, updated_at = now()',
      case p_category when 'billing' then 'billing_emails' else 'org_activity_emails' end)
      using p_user;
  else
    raise exception 'This email can''t be switched off.' using errcode = '22023';
  end if;
end;
$$;

-- People's own preferences ---------------------------------------------------------------

create or replace function public.get_email_preferences()
returns table (reminders boolean, digest text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.reminders, true), coalesce(p.digest, 'weekly')
  from (select auth.uid() as uid) me
  left join public.email_preferences p on p.user_id = me.uid
  where me.uid is not null;
$$;

create or replace function public.set_email_preferences(p_reminders boolean, p_digest text)
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
  insert into public.email_preferences (user_id, reminders, digest)
  values (v_uid, coalesce(p_reminders, true), p_digest)
  on conflict (user_id) do update
    set reminders = excluded.reminders, digest = excluded.digest, updated_at = now();
end;
$$;

-- Who may set the self-hosted instance's SMTP server: the owner of the
-- instance's first organization (the person who set the instance up).
create or replace function public.is_instance_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.role = 'owner'
      and m.org_id = (select o.id from public.organizations o order by o.created_at, o.id limit 1)
  );
$$;

-- An organization's recent email, for its owners and admins.
create or replace function public.org_email_log(p_org uuid, p_limit int default 50)
returns table (
  id uuid, app text, template text, category text, to_email text, status text,
  attempts int, last_error text, created_at timestamptz, sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role(p_org, '{owner,admin}'::public.org_role[]) then
    raise exception 'Only the owner or an admin can see this.' using errcode = '42501';
  end if;
  return query
  select o.id, o.app, o.template, o.category, coalesce(o.to_email, lower(u.email::text)), o.status,
         o.attempts, o.last_error, o.created_at, o.sent_at
  from public.email_outbox o
  left join auth.users u on u.id = o.to_user_id
  where o.org_id = p_org
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function
  public.enqueue_email(text, text, uuid, uuid, text, jsonb, text, text, timestamptz),
  public._email_opted_out(uuid, text),
  public.run_email_jobs(),
  public.claim_emails(int, text[]),
  public.finish_email(uuid, text, text, text),
  public.email_unsubscribe(uuid, text),
  public.get_email_preferences(),
  public.set_email_preferences(boolean, text),
  public.is_instance_owner(),
  public.org_email_log(uuid, int)
from public, anon, authenticated;

grant execute on function
  public.enqueue_email(text, text, uuid, uuid, text, jsonb, text, text, timestamptz),
  public.run_email_jobs(),
  public.claim_emails(int, text[]),
  public.finish_email(uuid, text, text, text),
  public.email_unsubscribe(uuid, text)
to service_role;

grant execute on function
  public.get_email_preferences(),
  public.set_email_preferences(boolean, text),
  public.is_instance_owner(),
  public.org_email_log(uuid, int)
to authenticated, service_role;
