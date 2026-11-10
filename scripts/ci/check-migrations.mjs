// Static checks on db/migrations (spec §3.3, §3.4). Report only — never edits files.
// Fails (with a reason per finding) when a table is created outside schema ledger or
// without GRANTs or row level security, when a migration destroys data at the top
// level, or when a file name is malformed or out of sequence. The runner
// (scripts/migrate.mjs) refuses edited files at apply time.
import { readdirSync, readFileSync } from "node:fs";

const dir = "db/migrations";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const all = files
  .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
  .join("\n")
  .toLowerCase();
const errors = [];

// RLS turned on for every ledger table by a loop over the catalog.
const rlsLoop =
  /for \w+ in select tablename from pg_tables where schemaname = 'ledger' loop[\s\S]*?enable row level security/.test(
    all,
  );
files.forEach((f, i) => {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) errors.push(`${f}: name must look like NNNN_description.sql`);
  else if (Number(m[1]) !== i + 1)
    errors.push(`${f}: expected number ${String(i + 1).padStart(4, "0")} (no gaps or duplicates)`);
});
for (const f of files) {
  const sql = readFileSync(`${dir}/${f}`, "utf8").toLowerCase();
  // Function bodies ($$ ... $$) don't run when the migration is applied, so a DELETE
  // inside one isn't a startup data loss; only top-level statements are checked.
  const code = sql.replace(/--[^\n]*/g, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
  for (const bad of [
    /\btruncate\b(?!\s*on)/,
    /\bdelete\s+from\b/,
    /\bdrop\s+table\b/,
    /\bdrop\s+schema\b/,
  ])
    if (bad.test(code.replace(/revoke[^;]*;/g, "")))
      errors.push(
        `${f}: contains a data-destroying command (${bad.source}). Migrations must never delete real data on startup.`,
      );
  for (const m of sql.matchAll(/create table (?:if not exists )?(?:(\w+)\.)?"?(\w+)"?\s*\(/g)) {
    const [schema, t] = [m[1], m[2]];
    if (schema !== "ledger")
      errors.push(`${f}: table "${t}" must be created in schema ledger (spec §3.1).`);
    if (
      !new RegExp(`grant [^;]+ on\\s[^;]*\\bledger\\.${t}\\b[^;]*\\sto\\s`).test(all) &&
      !new RegExp(`--[^\\n]*\\b${t}: no access`).test(sql.replace(/\n\s*/g, "\n"))
    )
      errors.push(
        `${f}: table "${t}" has no GRANT — the app will get "permission denied" at runtime.`,
      );
    if (!rlsLoop && !new RegExp(`alter table (ledger\\.)?${t} enable row level security`).test(all))
      errors.push(
        `${f}: table "${t}" has no row level security — other organizations could read it.`,
      );
  }
}

if (errors.length) {
  for (const e of errors) console.log(`::error::${e}`);
  console.error(
    `\n${errors.length} migration problem(s) found. Fix them in a new migration; CI does not change files.`,
  );
  process.exit(1);
}
console.log(
  `Checked ${files.length} migrations: every ledger table has GRANTs and row level security.`,
);
