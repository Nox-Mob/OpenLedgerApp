-- OWASP Top 10 2025 review (2026-11-15), A10 Mishandling of Exceptional Conditions / A06:
-- "Nothing in information technology should be limitless." Anyone can sign up, and creating an
-- organization had no limit, so a script could create thousands (each with its own settings,
-- defaults and invitations allowance). At most 20 new organizations a day per person, far above
-- real use. Chapters (made when a national approves them), seeds and server tasks aren't limited:
-- the check applies only to signed-in people calling the API.

create index if not exists organizations_created_by_idx
  on public.organizations (created_by, created_at) where parent_org_id is null;

create or replace function public._limit_new_organizations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if new.parent_org_id is not null or new.created_by is null or v_role is distinct from 'authenticated' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('new-orgs:' || new.created_by::text, 0));
  if (select count(*) from public.organizations o
      where o.created_by = new.created_by and o.parent_org_id is null
        and o.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve created a lot of organizations today. Try again tomorrow, or contact support.'
      using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public._limit_new_organizations() from public, anon, authenticated;

drop trigger if exists organizations_new_limit on public.organizations;
create trigger organizations_new_limit
  before insert on public.organizations
  for each row execute function public._limit_new_organizations();
