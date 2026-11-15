-- Security review, round 5 (2026-11-15): limits on what sends email to an address someone types.
--
-- Anyone can sign up, and two things then email any address they enter: an invitation
-- (OpenAppHub sends it through Supabase Auth) and a new recovery email (a confirmation link, core
-- 0019). Core 0017 already limits invitations per organization (100 an hour, 500 a day), but one
-- person could create many organizations and send that many from each. A script could use either
-- to send mail from our domain to strangers, which hurts everyone's email getting delivered. These
-- limits are far above what a real person needs:
--   invitations with an email address: 200 a day per person, across all their organizations;
--   recovery email changes: 5 a day per person.
-- Link-only invitations (no email address) send nothing and don't count. The checks are triggers,
-- so every way in (the API, OpenAppHub, the apps, self-hosted servers) gets them.

create index if not exists invitations_invited_by_created_idx
  on public.invitations (invited_by, created_at) where email is not null;

create or replace function public._limit_invitation_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null then
    return new;
  end if;
  if new.invited_by is null then
    return new;
  end if;
  -- One at a time per person, so two requests can't both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended('invitations:' || new.invited_by::text, 0));
  if (select count(*) from public.invitations i
      where i.invited_by = new.invited_by and i.email is not null
        and i.created_at > now() - interval '1 day') >= 200 then
    raise exception 'Too many invitations today. Try again tomorrow, or contact support.'
      using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public._limit_invitation_email() from public, anon, authenticated;

drop trigger if exists invitations_email_limit on public.invitations;
create trigger invitations_email_limit
  before insert on public.invitations
  for each row execute function public._limit_invitation_email();

create or replace function public._limit_recovery_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;
  if (select count(*) from public.account_security_events e
      where e.user_id = new.user_id and e.kind = 'recovery_email_set'
        and e.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many recovery email changes today. Try again tomorrow.'
      using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public._limit_recovery_email() from public, anon, authenticated;

drop trigger if exists account_recovery_email_limit on public.account_recovery;
create trigger account_recovery_email_limit
  before insert or update of email on public.account_recovery
  for each row execute function public._limit_recovery_email();
