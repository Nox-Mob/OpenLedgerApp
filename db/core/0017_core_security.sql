-- Security review (2026-11-14, OWASP Top 10): defense in depth at the database, so a bad value
-- is refused where it's stored, whatever code wrote it.

-- A03 Injection / A01 open redirects: links the apps show as buttons and menu items are paths in
-- the suite ("/billing", "/orgs/…"), never another site ("//evil.example", "https://…") or a
-- script ("javascript:…"). Shared UI checks too (safePath); this refuses them at the source.
alter table public.notifications drop constraint if exists notifications_link_is_path;
alter table public.notifications add constraint notifications_link_is_path
  check (link is null or link ~ '^/([^/\\]|$)');
alter table public.automation_tasks drop constraint if exists automation_tasks_link_is_path;
alter table public.automation_tasks add constraint automation_tasks_link_is_path
  check (link is null or link ~ '^/([^/\\]|$)');
alter table public.action_links drop constraint if exists action_links_open_link_is_path;
alter table public.action_links add constraint action_links_open_link_is_path
  check (open_link is null or open_link ~ '^/([^/\\]|$)');

-- A03 Injection (mail): an address is one plain address, no spaces, line breaks or brackets, so
-- it can't add a recipient or an SMTP command when a self-hosted install sends it.
alter table public.email_outbox drop constraint if exists email_outbox_to_email_plain;
alter table public.email_outbox add constraint email_outbox_to_email_plain
  check (to_email is null or (to_email !~ '[[:space:][:cntrl:]<>,;"()\\]' and to_email ~ '^[^@]+@[^@]+\.[^@]+$'
         and char_length(to_email) <= 254));

-- A03 Injection (dynamic SQL): the registries name the functions the engine calls with
-- execute format('select %s(...)'). Only migrations write them; each name must also be a plain
-- schema.function, so a bad row can never become SQL.
do $$
declare
  c record;
  re constant text := '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$';
begin
  for c in
    select * from (values
      ('email_jobs', 'fn'),
      ('automation_trigger_types', 'scan_fn'),
      ('automation_trigger_types', 'fields_fn'),
      ('automation_action_types', 'run_fn'),
      ('automation_recipient_types', 'resolve_fn'),
      ('automation_recipient_types', 'options_fn')) v(tbl, col)
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = c.tbl and column_name = c.col) then
      execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.tbl || '_' || c.col || '_name');
      execute format('alter table public.%I add constraint %I check (%I is null or %I ~ %L)',
        c.tbl, c.tbl || '_' || c.col || '_name', c.col, c.col, re);
    end if;
  end loop;
end $$;

-- A04 Insecure design (abuse): invitations send email to any address, so a new organization
-- could be used to send spam from our domain. At most 100 an hour and 500 a day per
-- organization, whichever app sends them (they all insert here). Real use is far below that.
create index if not exists invitations_org_created_idx on public.invitations (org_id, created_at);
create or replace function public._limit_invitations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.invitations i
      where i.org_id = new.org_id and i.created_at > now() - interval '1 hour') >= 100
     or (select count(*) from public.invitations i
         where i.org_id = new.org_id and i.created_at > now() - interval '1 day') >= 500 then
    raise exception 'That''s a lot of invitations at once. Please wait a while before sending more, or contact support.'
      using errcode = '53400';
  end if;
  return new;
end;
$$;
drop trigger if exists limit_invitations on public.invitations;
create trigger limit_invitations before insert on public.invitations
  for each row execute function public._limit_invitations();

-- Performance and clarity (advisor multiple_permissive_policies): one read policy for
-- organizations instead of two, same rows: your organizations and the parent of your chapter.
drop policy if exists "organizations: members read" on public.organizations;
drop policy if exists "organizations: read the parent of your chapter" on public.organizations;
drop policy if exists "organizations: members and chapter parents read" on public.organizations;
create policy "organizations: members and chapter parents read" on public.organizations
  for select to authenticated
  using (public.is_member(id) or public.is_member_of_child(id));

-- What's left to tune also covers two permissive policies for the same table, role and action
-- (one "for all" policy counts for each action), so the repos' tests keep it at one.
create or replace function public.tuning_problems(p_schema text)
returns table (kind text, object text)
language sql
stable
set search_path = ''
as $$
  select 'policy calls auth per row', p.tablename || ': ' || p.policyname
  from pg_catalog.pg_policies p
  where p.schemaname = p_schema
    and (coalesce(p.qual, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)'
         or coalesce(p.with_check, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)')
  union all
  select 'foreign key without an index', cl.relname || ': ' || c.conname
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class cl on cl.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
  where c.contype = 'f' and n.nspname = p_schema
    and not exists (
      select 1 from pg_catalog.pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] @> c.conkey
        and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] <@ c.conkey)
  union all
  select 'more than one permissive policy', x.tablename || ': ' || x.role || ' ' || x.action || ' (' || x.names || ')'
  from (
    select p.tablename, r.role, a.action, pg_catalog.string_agg(p.policyname, ', ' order by p.policyname) as names
    from pg_catalog.pg_policies p
    cross join lateral pg_catalog.unnest(p.roles) r(role)
    cross join lateral pg_catalog.unnest(case when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                                              else array[p.cmd] end) a(action)
    where p.schemaname = p_schema and p.permissive = 'PERMISSIVE'
    group by p.tablename, r.role, a.action
    having count(*) > 1
  ) x;
$$;
revoke all on function public.tuning_problems(text) from public, anon, authenticated;

select public._tune_schema('public');
