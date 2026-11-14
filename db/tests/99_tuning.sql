-- Pre-production tuning (core 0016): nothing left to tune in the ledger schema.
begin;
do $$
declare n int;
begin
  select count(*) into n from public.tuning_problems('ledger');
  if n > 0 then
    raise exception 'FAILED: % has % things to tune: %', 'ledger', n,
      (select string_agg(kind || ' (' || object || ')', '; ') from public.tuning_problems('ledger'));
  end if;
end $$;
rollback;
