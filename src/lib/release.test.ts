// Mandatory release steps that a machine can check (see docs/release-checklist.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

const changelog = readFileSync("CHANGELOG.md", "utf8");
const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/gm)];

describe("release checklist", () => {
  it("changelog keeps an Unreleased section above the releases", () => {
    const u = changelog.indexOf("## [Unreleased]");
    expect(u).toBeGreaterThan(-1);
    expect(u).toBeLessThan(changelog.indexOf(released[0]![0]));
  });

  it("when the app version is released in the changelog, the architecture doc names it", () => {
    const isReleased = released.some((m) => m[1] === APP_VERSION);
    if (!isReleased) return;
    expect(readFileSync("docs/architecture.md", "utf8")).toContain(`Current as of v${APP_VERSION}`);
  });

  it("architecture doc is never behind the latest released version", () => {
    const doc = readFileSync("docs/architecture.md", "utf8");
    const m = doc.match(/Current as of v(\d+\.\d+\.\d+)/);
    expect(m, "docs/architecture.md needs a 'Current as of vX.Y.Z' line").not.toBeNull();
    expect(m![1]).toBe(released[0]![1] === APP_VERSION ? APP_VERSION : m![1]);
  });
});
