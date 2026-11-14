-- Security settings move to OpenAppHub (owner request 2026-11-14). OpenLedgerApp had its own
-- "require two-step sign-in" switch for an organization's books. The organization setting in
-- OpenAppHub (core 0019: off, owner and admins, everyone) now does this for every app, so an
-- organization that had Ledger's switch on gets "everyone" there (unless it already asks for
-- that), and Ledger's own switch is turned off. Nothing gets less strict: "everyone" covers the
-- books and the other apps too. The column stays for older backups; nothing turns it on now.
insert into public.org_role_settings as s (org_id, mfa_required)
select o.org_id, 'everyone' from ledger.org_settings o where o.require_mfa
on conflict (org_id) do update set mfa_required = 'everyone'
  where s.mfa_required <> 'everyone';
update ledger.org_settings set require_mfa = false where require_mfa;
comment on column ledger.org_settings.require_mfa is
  'Retired (0015): two-step sign-in is set for the whole organization in OpenAppHub (public.org_role_settings.mfa_required).';
