#!/usr/bin/env node
// OpenAppHub suite migration runner (SHARED-SPEC §3.3).
// Canonical copy lives in Nox-Mob/OpenAppHub; apps vendor it. Don't edit it in an app repo.
//
// Usage: DATABASE_URL=postgres://… node scripts/migrate.mjs [--repo <key>] [--seed] [--dry-run] [--skip <name>]…
//
//   1. Connects with DATABASE_URL.
//   2. Creates ops.schema_migrations(repo, version, checksum, applied_at).
//   3. Takes pg_advisory_lock(424242), so two runs never overlap.
//   4. Applies db/core/*.sql under the key "core", then db/migrations/*.sql under
//      this repo's key, in filename order, each file in its own transaction.
//   5. Skips recorded files; fails loudly if a recorded file's checksum changed.
//   6. --seed also runs db/seed/*.sql (staging only; recorded under "<repo>:seed").
//      --dry-run prints the plan. --skip <name> skips a migration by file name,
//      with or without ".sql" (e.g. --skip 0001_billing for self-hosters).
//
// The repo key defaults to package.json "name".

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const LOCK_KEY = 424242;

export function parseArgs(argv) {
  const opts = {
    seed: false,
    dryRun: false,
    skip: new Set(),
    repo: undefined,
    root: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") opts.seed = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--skip" || arg === "--repo" || arg === "--root") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      if (arg === "--skip") opts.skip.add(value.replace(/\.sql$/, ""));
      else if (arg === "--repo") opts.repo = value;
      else opts.root = resolve(value);
    } else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

export function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function sqlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf8");
      return { file, version: file.replace(/\.sql$/, ""), sql, checksum: checksum(sql) };
    });
}

function repoKey(root, override) {
  if (override) return override;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!pkg.name) throw new Error('package.json has no "name"; pass --repo <key>');
  return pkg.name;
}

/** Works out which files run, which are skipped and which have changed. Pure, for tests. */
export function plan(groups, applied, skip) {
  const steps = [];
  const changed = [];
  for (const { key, files } of groups) {
    for (const f of files) {
      const recorded = applied.get(`${key}/${f.version}`);
      if (recorded !== undefined) {
        if (recorded !== f.checksum) changed.push(`${key}/${f.file}`);
        continue;
      }
      steps.push({ key, ...f, skipped: skip.has(f.version) });
    }
  }
  return { steps, changed };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      readFileSync(new URL(import.meta.url), "utf8")
        .split("\n")
        .slice(1, 20)
        .join("\n"),
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const repo = repoKey(opts.root, opts.repo);
  const groups = [
    { key: "core", files: sqlFiles(join(opts.root, "db/core")) },
    { key: repo, files: sqlFiles(join(opts.root, "db/migrations")) },
  ];
  if (opts.seed) groups.push({ key: `${repo}:seed`, files: sqlFiles(join(opts.root, "db/seed")) });

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, application_name: "oah-migrate" });
  await client.connect();
  try {
    await client.query("create schema if not exists ops");
    await client.query(`create table if not exists ops.schema_migrations (
      repo text not null,
      version text not null,
      checksum text not null,
      applied_at timestamptz not null default now(),
      primary key (repo, version)
    )`);
    await client.query("revoke all on schema ops from public");
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);

    const { rows } = await client.query(
      "select repo, version, checksum from ops.schema_migrations",
    );
    const applied = new Map(rows.map((r) => [`${r.repo}/${r.version}`, r.checksum]));
    const { steps, changed } = plan(groups, applied, opts.skip);

    if (changed.length) {
      throw new Error(
        `Applied migration(s) changed since they ran. Never edit an applied migration; add a new one.\n  ${changed.join("\n  ")}`,
      );
    }
    if (!steps.length) {
      console.log("Nothing to apply. Database is up to date.");
      return;
    }

    for (const step of steps) {
      const label = `${step.key}/${step.file}`;
      if (step.skipped) {
        console.log(`skip   ${label} (--skip)`);
        continue;
      }
      if (opts.dryRun) {
        console.log(`apply  ${label} (dry run)`);
        continue;
      }
      process.stdout.write(`apply  ${label} … `);
      try {
        await client.query("begin");
        await client.query(step.sql);
        await client.query(
          "insert into ops.schema_migrations (repo, version, checksum) values ($1, $2, $3)",
          [step.key, step.version, step.checksum],
        );
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        console.log("FAILED");
        throw new Error(`${label}: ${error.message}`, { cause: error });
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((error) => {
    console.error(`\nMigration failed: ${error.message}`);
    process.exit(1);
  });
}
