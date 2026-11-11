# Signed backups and restore

## What the user gets
- **Download backup** creates a signed backup file. If anyone changes even one value, the app refuses to restore it.
- **Restore backup** (Settings, then Exports and backup) loads a backup into a **new organization**. Existing books are never touched.
- Backups from **another install** (for example, cloud to self-hosted) can be restored. They are re-checked line by line and labeled "Restored from another install". The app shows that install's fingerprint so you can confirm where the file came from.
- CSV and Excel exports stay **reports only** and can't be restored, because they leave out links like bank matches, statement checks and fund tags. The page will say so.
- Backups downloaded before this change aren't signed, so they will be refused. Download a new one after this ships.

## How tamper protection works
```text
each row  -> fingerprint (SHA-256 of the row in a fixed format)
each table -> chained fingerprint of its rows, in order
manifest  -> table fingerprints, counts, org, app version, install fingerprint
signature -> Ed25519 signature of the manifest, using a private key only the server holds
```
- **Row fingerprints alone don't prove anything.** Anyone who edits a row can recompute its fingerprint. Their job is to show exactly which rows changed. The **signature** is what proves the file is authentic, because nobody can produce it without the server's private key.
- **Same install:** the signature must match this install's key. Anything else is refused.
- **Another install:** the signature must be valid for the key included in the file, so edits made after signing are still caught. Honest limit: someone who runs their own install could edit a file and sign it with their own key. That's why foreign restores are labeled, show the install fingerprint, and go through every bookkeeping check.
- **Desktop edition (future):** the key has to live on the user's own machine, so desktop backups prove they're intact but not where they came from. This will be documented, not hidden.

## Restore always re-checks everything
The file is never trusted to bypass the rules. Restore:
1. Verifies size (capped), format version, signature, then every row and table fingerprint. Any mismatch stops the restore before anything is written.
2. Creates a new organization with the restoring user as owner and admin. Other people's memberships are listed for reference but not granted. Invite people again.
3. Gives every record a new app-generated ID, keeping links through an old-to-new ID map.
4. Writes in a safe order through the same domain rules as normal posting: accounts, categories, tags, projects and funds first, then balanced transactions, then voids, bank evidence, statement checks (completed last), pledges, budgets, and finally the books lock date and year-end closes.
5. Adds the original history as read-only "restored" history entries with their original times, plus one "restored from backup" entry naming the file's fingerprint and source.
6. If any step fails, the half-built organization is deleted (owner delete path) and the error says which record failed.

## Technical section
- New server secret `BACKUP_SIGNING_SEED` (32 random bytes) generated for the cloud install. The Ed25519 key pair is derived from it with WebCrypto, which runs in the worker runtime. Self-hosted installs set it in `.env.local`, and the README and `.env.example` will be updated.
- `src/lib/domain/backup.ts` (pure): canonical row encoding, row and table chain hashing, manifest build and verify, plus restore ordering and ID remapping. Covered by unit tests: tamper one cent, reorder rows, drop a row, swap the key, wrong version.
- `src/lib/backup.functions.ts`: `exportBackup` becomes format v2 (signed). New `restoreBackup` (any signed-in user, because it creates a new org) does the verification, then the ordered writes through services and repositories with `newId()`. History rows go through `writeAudit()`.
- Upload size cap of about 25 MB. Very large organizations may hit worker time limits. If they do, restore will move to batches as a follow-up.
- Contract test: export from the memory adapter, then restore into a fresh one. Reports must match exactly (income, balance sheet, trial balance, fund balances).
- UI: a Restore section with a file picker, a verification summary (source, date, counts, fingerprint, same or other install), and a typed confirmation before writing.
- Update AGENTS.md (backup signing and restore rules), CHANGELOG (Unreleased) and the roadmap.
