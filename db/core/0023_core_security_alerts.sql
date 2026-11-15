-- OWASP Top 10 2025 review (2026-11-15), A09 Security Logging and Alerting Failures: failed
-- attempts were recorded but nobody was told. Turning off two-step sign-in with a backup code or a
-- recovery link needs a session signed in with the person's password, so many wrong tries mean
-- someone has the password and is trying to get past the authenticator. When recovery locks
-- (10 wrong tries in an hour, core 0019), we email the person at once, so they can change their
-- password, and record it in their security activity.

create or replace function public._alert_recovery_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind <> 'recovery_failed' then
    return new;
  end if;
  -- Exactly at the lock, so one attack sends one email, not one per try.
  if (select count(*) from public.account_security_events e
      where e.user_id = new.user_id and e.kind = 'recovery_failed'
        and e.created_at > now() - interval '1 hour') = 10 then
    perform public._log_security_event(new.user_id, 'recovery_locked');
    perform public._security_email('account.security_notice', new.user_id, null,
      jsonb_build_object('event', 'recovery_locked'));
  end if;
  return new;
end;
$$;
revoke all on function public._alert_recovery_lock() from public, anon, authenticated;

drop trigger if exists account_security_events_alert on public.account_security_events;
create trigger account_security_events_alert
  after insert on public.account_security_events
  for each row execute function public._alert_recovery_lock();
