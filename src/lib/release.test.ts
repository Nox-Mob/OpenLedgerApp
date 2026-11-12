// Mandatory release steps that a machine can check (see docs/release-checklist.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const changelog = readFileSync("CHANGELOG.md", "utf8");
const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/gm)];

describe("release checklist", () => {
  it("changelog keeps an Unreleased section above the releases", () => {
    const u = changelog.indexOf("## [Unreleased]");
    expect(u).toBeGreaterThan(-1);
    expect(u).toBeLessThan(changelog.indexOf(released[0]![0]));
  });
  // Ledger's architecture document now lives in OpenAppHub (docs/ledger/architecture.md); the
  // release checklist there says to update its "Current as of" line.
});
