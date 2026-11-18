import { describe, expect, it } from "vitest";
import { withDesktopLibraries } from "./desktop-licenses";

describe("withDesktopLibraries", () => {
  it("adds the desktop app's Rust libraries to the suite list, once each, sorted", () => {
    const suite = [
      { name: "react", license: "MIT" },
      { name: "zod", license: "MIT" },
    ];
    const rust = [
      { name: "serde", license: "MIT OR Apache-2.0" },
      { name: "zod", license: "MIT" },
    ];
    expect(withDesktopLibraries(suite, rust).map((l) => l.name)).toEqual(["react", "serde", "zod"]);
  });
});
