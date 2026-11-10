\set ON_ERROR_STOP on
-- Security catalogue checks, printed for review and enforced.
\echo '--- Tables in ledger without row-level security (expect none)'
select tablename from pg_tables where schemaname = 'ledger' and not rowsecurity;
\echo '--- Ledger functions anon can run (expect none)'
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'ledger' and has_function_privilege('anon', p.oid, 'execute') order by 1;
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'ledger' and not rowsecurity) then
    raise exception 'a ledger table has no row-level security';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'ledger' and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can run a ledger function';
  end if;
end $$;
