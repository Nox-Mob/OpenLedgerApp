-- Security review, round 4 (2026-11-14): no table rights the API never needs.
--
-- Supabase's default privileges gave the API roles (anon = signed out, authenticated = signed in)
-- TRUNCATE, REFERENCES and TRIGGER, and on Postgres 17 MAINTAIN, on every table later created in
-- public. Row security decides which rows they read and write; these four rights sit outside it
-- (TRUNCATE empties a table whatever its policies; MAINTAIN allows VACUUM, REINDEX and LOCK
-- TABLE). The API (PostgREST) can't send any of them, so nothing could use them, but a right
-- nobody needs is one less thing to go wrong. This takes them away from every table in the
-- schemas the API can reach and from tables created later. SELECT, INSERT, UPDATE and DELETE are
-- unchanged: grants and row security already decide those.

do $$
declare
  r record;
  rights text := 'truncate, references, trigger'
    || case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname in ('public', 'hub', 'billing')
  loop
    execute format('revoke %s on table %I.%I from anon, authenticated', rights, r.nspname, r.relname);
  end loop;

  -- Tables created later (by whichever role runs the migrations, and Supabase's own default).
  foreach r.nspname in array array['public', 'hub', 'billing'] loop
    if exists (select 1 from pg_namespace where nspname = r.nspname) then
      execute format('alter default privileges in schema %I revoke %s on tables from anon, authenticated',
        r.nspname, rights);
      if exists (select 1 from pg_roles where rolname = 'postgres') and current_user <> 'postgres'
         and pg_has_role(current_user, 'postgres', 'member') then
        execute format('alter default privileges for role postgres in schema %I revoke %s on tables from anon, authenticated',
          r.nspname, rights);
      end if;
    end if;
  end loop;
end $$;
