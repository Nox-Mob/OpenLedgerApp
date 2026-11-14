-- Pre-production tuning (2026-11-14), from the Supabase database advisors on staging.
--
-- public._tune_schema(schema) does two mechanical things to one schema, and each repo calls it
-- for the schemas it owns (core: public; the hub: hub and billing; each app: its own):
--
--  1. Row-level security policies call auth.uid() / auth.jwt() / auth.role() once per query,
--     not once per row: each bare call becomes (select auth.uid()), which Postgres evaluates
--     once (an "initPlan"). Same meaning; at 10,000 rows it's one call instead of 10,000.
--     https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--  2. Every foreign key gets an index on its columns, if none covers them, so deletes that
--     cascade (an organization, a person) and joins don't scan the whole table. A nullable
--     single column gets a partial index (where it's not null), so sparse columns stay small.
--
-- It's safe to run again (it skips what's done), and public.tuning_problems(schema) lists
-- anything left, which each repo's tests use to keep it that way.

create or replace function public._tune_schema(p_schema text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_q text;
  v_w text;
  v_sql text;
  v_name text;
  -- A bare call, not already inside "( SELECT auth.uid() AS uid)".
  c_bare constant text := '(?<!SELECT )auth\.(uid|jwt|role)\(\)';
begin
  -- 1. Policies. pg_policies shows each expression fully qualified (search_path is empty here).
  for r in
    select p.schemaname, p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    from pg_catalog.pg_policies p
    where p.schemaname = p_schema
      and (coalesce(p.qual, '') ~ c_bare or coalesce(p.with_check, '') ~ c_bare)
  loop
    v_q := pg_catalog.regexp_replace(r.qual, c_bare, '(select auth.\1())', 'g');
    v_w := pg_catalog.regexp_replace(r.with_check, c_bare, '(select auth.\1())', 'g');
    v_sql := pg_catalog.format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_q is not null then v_sql := v_sql || pg_catalog.format(' using (%s)', v_q); end if;
    if v_w is not null then v_sql := v_sql || pg_catalog.format(' with check (%s)', v_w); end if;
    execute v_sql;
  end loop;

  -- 2. Foreign keys without an index whose leading columns are the key's columns.
  for r in
    select c.conrelid, cl.relname as tbl, c.conname, c.conkey,
           (select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by k.ord)
            from pg_catalog.unnest(c.conkey) with ordinality k(attnum, ord)
            join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select bool_and(not a.attnotnull) from pg_catalog.pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as nullable
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = p_schema
      and not exists (
        select 1 from pg_catalog.pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] <@ c.conkey)
  loop
    v_name := pg_catalog.left(r.tbl || '_' || pg_catalog.replace(pg_catalog.replace(r.cols, '"', ''), ', ', '_'), 56) || '_fk_idx';
    v_sql := pg_catalog.format('create index if not exists %I on %I.%I (%s)', v_name, p_schema, r.tbl, r.cols);
    if r.nullable and pg_catalog.array_length(r.conkey, 1) = 1 then
      v_sql := v_sql || pg_catalog.format(' where %s is not null', r.cols);
    end if;
    execute v_sql;
  end loop;
end;
$$;

-- What's left to tune in a schema (empty when it's done): for the repos' tests.
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
        and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] <@ c.conkey);
$$;

revoke all on function public._tune_schema(text), public.tuning_problems(text) from public, anon, authenticated;

-- Housekeeping: sent and failed emails (each holds an address and the message's data) and used or
-- expired action links were kept forever. Keep 180 days of email (well past any reminder that
-- could be queued again under the same dedupe key) and 30 days of finished links, daily, like
-- the automation log and notifications.
create or replace function public.prune_email_history()
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with e as (delete from public.email_outbox
             where status in ('sent', 'failed', 'suppressed') and created_at < now() - interval '180 days'
             returning 1),
       l as (delete from public.action_links
             where coalesce(used_at, expires_at) < now() - interval '30 days'
             returning 1)
  select ((select count(*) from e) + (select count(*) from l))::int;
$$;
revoke all on function public.prune_email_history() from public, anon, authenticated;
insert into public.email_jobs (name, fn, every)
values ('core.prune_email_history', 'public.prune_email_history', interval '1 day')
on conflict (name) do update set fn = excluded.fn, every = excluded.every;

select public._tune_schema('public');
