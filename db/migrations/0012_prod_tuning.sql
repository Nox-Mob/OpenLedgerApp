-- Pre-production tuning (2026-11-14): this app's schema through core 0016's helper. Policies call
-- auth.uid() once per query instead of once per row, and every foreign key gets an index.
-- Runs after the last migration that changes policies; db/tests/99_tuning.sql keeps it that way.
select public._tune_schema('ledger');
