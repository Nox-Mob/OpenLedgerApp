#!/usr/bin/env bash
# Performance check (mirrors OpenCharterApp's scripts/db-perf.sh): builds a throwaway
# database with the migration runner, seeds 31 organizations, then grows one set of books through
# PERF_SIZES transactions (default 5,000, 20,000 and 50,000; with entries, bank rows
# and history; db/perf/grow.sql). At each size
# it prints how long the heavy reads take and fails if one is over PERF_BUDGET_MS
# (default 1000 ms). Finally checks the security catalogue (db/perf/catalogue.sql).
# Requires TEST_DATABASE_URL, like scripts/db/test.sh. Never point it at a real database.
set -euo pipefail
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/postgres}"
DB="${PERF_DB_NAME:-ledger_perf_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIZES="${PERF_SIZES:-5000 20000 50000}"
URL="${TEST_DATABASE_URL%/*}/$DB"
admin() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }
run() { psql "$URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

admin -c "drop database if exists $DB" -c "create database $DB"
run -f "$ROOT/db/ci/supabase-stub.sql"
(cd "$ROOT" && DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null)
run -f "$ROOT/db/tests/00_helpers.sql"
run -f "$ROOT/db/perf/setup.sql"
for n in $SIZES; do
  run -v budget_ms="${PERF_BUDGET_MS:-1000}" -v txns="$n" -f "$ROOT/db/perf/grow.sql"
done
run -f "$ROOT/db/perf/catalogue.sql"
[ -n "${KEEP_DB:-}" ] || admin -c "drop database if exists $DB"
