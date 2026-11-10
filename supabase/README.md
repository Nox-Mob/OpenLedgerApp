# Legacy schema (frozen)

`supabase/migrations/` is the **old, public-schema database** that today's app code
still reads. It stays here, unchanged, only so that **self-hosters** can run the
current version (README → Self-hosting). No workflow applies it to the shared
OpenAppHub database, and nothing new is added to it.

The new schema is `db/migrations/` (schema `ledger`, on the OpenAppHub core), applied
by `scripts/migrate.mjs`. When the app switches to it (migration step 8), this
folder is removed and the README's self-hosting steps change to `npm run db:migrate`.

`supabase/seed/demo.sql` is the old sample data; it's ported in step 6.
