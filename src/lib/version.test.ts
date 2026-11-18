// The app version stamped into backups must match package.json.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

describe("app version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.version).toBe(APP_VERSION);
  });
});
