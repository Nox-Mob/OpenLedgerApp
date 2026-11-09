#!/usr/bin/env node
// Checks this app's vendored copy of the OpenAppHub shared code (SHARED-SPEC §8).
// Canonical copy: Nox-Mob/OpenAppHub. Don't edit it here; run it in CI:
//
//   node scripts/check-shared.mjs
//
// Fails if a vendored file was changed by hand or is missing, or if
// package.json "oahShared" doesn't match shared/VERSION. To change shared code,
// change it in the hub, bump shared/VERSION, and run the hub's
// scripts/sync-shared.mjs against this checkout.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

export function check(root = process.cwd()) {
  const problems = [];
  const manifestPath = join(root, "shared/MANIFEST.json");
  if (!existsSync(manifestPath))
    return ["shared/MANIFEST.json is missing; run the hub's sync script."];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = readFileSync(join(root, "shared/VERSION"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (manifest.version !== version)
    problems.push(`MANIFEST says ${manifest.version}, shared/VERSION says ${version}.`);
  if (pkg.oahShared !== version)
    problems.push(
      `package.json "oahShared" is ${pkg.oahShared ?? "missing"}, shared/VERSION is ${version}.`,
    );
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const file = join(root, rel);
    if (!existsSync(file)) {
      problems.push(`${rel} is missing.`);
      continue;
    }
    if (createHash("sha256").update(readFileSync(file)).digest("hex") !== hash) {
      problems.push(`${rel} was changed here. Change it in Nox-Mob/OpenAppHub and sync instead.`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("check-shared.mjs")) {
  const problems = check();
  if (problems.length) {
    console.error(`Vendored shared code check failed:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Vendored shared code matches its manifest.");
}
