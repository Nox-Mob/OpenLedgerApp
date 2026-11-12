#!/usr/bin/env bash
# H-06: regenerate src/integrations/supabase/types.ts from a database built the way production is
# built (the vendored core, then db/migrations), so the types always match the migrations.
# Needs Postgres (TEST_DATABASE_URL, a server where you may create databases) and Docker (the
# Supabase CLI runs postgres-meta in a container). CI runs it in .github/workflows/gen-types.yml.
# Never point it at a real project database.
set -euo pipefail
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/postgres}"
DB="${TYPES_DB_NAME:-ledger_types}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="${TEST_DATABASE_URL%/*}/$DB"
OUT="$ROOT/src/integrations/supabase/types.ts"
admin() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

admin -c "drop database if exists $DB" -c "create database $DB"
psql "$URL" -v ON_ERROR_STOP=1 -q -X -f "$ROOT/db/ci/supabase-stub.sql"
(cd "$ROOT" && DATABASE_URL="$URL" node scripts/migrate.mjs >/dev/null)
npx -y supabase@2.58.5 gen types typescript --db-url "$URL" --schema ledger,public > "$OUT.new"
mv "$OUT.new" "$OUT"
[ -n "${KEEP_DB:-}" ] || admin -c "drop database if exists $DB"
echo "wrote src/integrations/supabase/types.ts"
