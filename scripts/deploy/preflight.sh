#!/usr/bin/env bash
# Decides whether a deploy may run (used by .github/workflows/staging.yml and release.yml).
# staging:    prints a notice and sets ready=false when something is missing (job skips, stays green).
# production: fails when something is missing.
# Ready means: the secrets exist, the migration runner and the ledger baseline exist
# (MIGRATION-NOTES steps 4-5), and the app uses the shared client on the ledger schema (step 8).
# Before step 8 the app still reads public.* tables, which in the shared project belong to the core.
set -euo pipefail
target="${1:?usage: preflight.sh <staging|production>}"
missing=()

[ "${HAS_DB:-false}" = "true" ] || missing+=("GitHub secret $( [ "$target" = production ] && echo PROD || echo STAGING )_DATABASE_URL")
[ "${HAS_CF:-false}" = "true" ] || missing+=("GitHub secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID")
[ -f scripts/migrate.mjs ] || missing+=("scripts/migrate.mjs (step 4: vendor the runner)")
[ -f db/migrations/0001_ledger_baseline.sql ] || missing+=("db/migrations/0001_ledger_baseline.sql (step 5)")
grep -rqs "shared/supabase/client" src || missing+=("the shared Supabase client on the ledger schema (step 8)")
if grep -q '"<' wrangler.jsonc; then
  node scripts/deploy/build-env.mjs "$target" > /dev/null 2>&1 || missing+=("real values for the $target placeholders in wrangler.jsonc")
fi

if [ ${#missing[@]} -eq 0 ]; then
  echo "ready=true" >> "${GITHUB_OUTPUT:-/dev/null}"
  echo "Preflight passed for $target."
  exit 0
fi

joined=$(printf '%s; ' "${missing[@]}")
msg="Not deploying $target yet. Missing: ${joined%; }"
echo "ready=false" >> "${GITHUB_OUTPUT:-/dev/null}"
if [ "$target" = production ]; then
  echo "::error::$msg"
  exit 1
fi
echo "::notice::$msg"
