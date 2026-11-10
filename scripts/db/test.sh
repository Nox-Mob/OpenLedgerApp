#!/usr/bin/env bash
# Database rules (mirrors OpenCharterApp's scripts/db-test.sh): builds a throwaway
# database the way production is built, with the vendored migration runner (core,
# then db/migrations), on plain Postgres with a stub of the Supabase-managed
# schemas, then runs db/tests/*.sql. Each test file runs in a transaction that is
# rolled back.
#
# Requires TEST_DATABASE_URL pointing at a server where the user may create databases.
# Never point this at a real project database.
set -euo pipefail
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/postgres}"
DB="${TEST_DB_NAME:-ledger_rules_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="${TEST_DATABASE_URL%/*}/$DB"
admin() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }
run() { psql "$URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

admin -c "drop database if exists $DB" -c "create database $DB"
run -f "$ROOT/db/ci/supabase-stub.sql"
(cd "$ROOT" && DATABASE_URL="$URL" node scripts/migrate.mjs)
# Running the runner again must change nothing (every file is recorded).
(cd "$ROOT" && DATABASE_URL="$URL" node scripts/migrate.mjs | grep -q "Nothing to apply") \
  || { echo "FAIL a second migrate run wanted to apply something"; exit 1; }
run -f "$ROOT/db/tests/00_helpers.sql"

# Two kinds of test file:
#  - plain: fails with an error (tests.ok / tests.throws); passes when it runs to the end;
#  - RESULT (Ledger's earlier format): ends with RAISE 'RESULT k=v; ...' (rolling back) and
#    every value must be PASS, blocked or 0.
fail=0
for f in $(ls "$ROOT"/db/tests/[0-9]*.sql | sort); do
  name=$(basename "$f")
  [ "$name" = "00_helpers.sql" ] && continue
  out=$(run -f "$f" 2>&1) && status=0 || status=$?
  result=$(grep -o 'RESULT .*' <<<"$out" | head -1 | sed 's/^RESULT //' || true)
  if [ -n "$result" ]; then
    bad=""
    IFS=';' read -ra parts <<<"$result"
    for p in "${parts[@]}"; do
      p=$(xargs <<<"$p"); [ -z "$p" ] && continue
      case "${p#*=}" in PASS|blocked|0) ;; *) bad+="$p; " ;; esac
    done
    if [ -z "$bad" ]; then echo "ok   $name"; else echo "FAIL $name: $bad"; fail=1; fi
  elif [ "$status" = 0 ]; then
    echo "ok   $name"
  else
    echo "FAIL $name"; echo "$out" | sed 's/^/     /'; fail=1
  fi
done
# The staging demo seed loads on top of the migrations and its books balance.
if (cd "$ROOT" && DATABASE_URL="$URL" node scripts/migrate.mjs --seed >/dev/null) &&
  [ "$(run -tAc "select (select count(*) from ledger.transactions) > 30 and (select coalesce(sum(amount_cents), 0) from ledger.entries) = 0 and (select count(*) from ledger.reconciliations where status = 'completed') = 2")" = "t" ]; then
  echo "ok   staging seed (db/seed)"
else
  echo "FAIL staging seed (db/seed)"; fail=1
fi
[ -n "${KEEP_DB:-}" ] || admin -c "drop database if exists $DB"
exit $fail
