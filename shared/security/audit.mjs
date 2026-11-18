#!/usr/bin/env node
// Dependency audit for CI (SHARED-SPEC §10.3, security reviews). Fails on any high or critical
// advisory in the packages a repository ships, except advisories listed in
// shared/security/audit-allow.json with a reason and an expiry date. An expired entry no longer
// counts, so an exception can't be forgotten.
//
//   node shared/security/audit.mjs                 npm audit --omit=dev, with the allow-list
//   node shared/security/audit.mjs --ignore-flags  print "--ignore=GHSA-…" for bun audit
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const allowList = JSON.parse(readFileSync(join(here, "audit-allow.json"), "utf8")).advisories;
const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(allowList.filter((a) => a.until >= today).map((a) => [a.id, a]));
for (const a of allowList.filter((a) => a.until < today))
  console.error(`Allow-list entry expired on ${a.until}: ${a.id} (${a.package}). Check for a fix.`);

if (process.argv.includes("--ignore-flags")) {
  console.log([...allowed.keys()].map((id) => `--ignore=${id}`).join(" "));
  process.exit(0);
}

let report;
try {
  report = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  report = error.stdout;
}
const data = JSON.parse(report);
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const found = new Map();
for (const vuln of Object.values(data.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue;
    const id = /GHSA-[\w-]+/.exec(via.url ?? "")?.[0] ?? String(via.source);
    if ((RANK[via.severity] ?? 0) >= RANK.high) found.set(id, { ...via, id });
  }
}

const blocking = [...found.values()].filter((v) => !allowed.has(v.id));
for (const v of found.values()) {
  const a = allowed.get(v.id);
  if (a) console.log(`allowed until ${a.until}: ${v.id} ${v.name} (${v.severity}): ${a.reason}`);
}
if (blocking.length) {
  for (const v of blocking)
    console.error(`${v.severity}: ${v.id} ${v.name}: ${v.title} ${v.url ?? ""}`);
  console.error(`${blocking.length} high or critical advisories in shipped packages.`);
  process.exit(1);
}
console.log("No high or critical advisories in shipped packages (beyond the allow-list).");
