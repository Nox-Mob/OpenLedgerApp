// Prints the public build variables for one Worker environment, read from wrangler.jsonc.
// VITE_* values are baked into the browser bundle at build time, so `npm run build:hosted`
// writes them to .env.production.local before building; the same values are also the
// Worker's runtime `vars`. The top level of wrangler.jsonc is production.
// Usage: node scripts/deploy/build-env.mjs <production|staging> > .env.production.local
// Fails if a value is still a "<…>" placeholder, so a half-configured deploy never runs.
import { readFileSync } from "node:fs";

/** Remove // and /* *\/ comments and trailing commas from JSONC, leaving strings untouched. */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
    } else if (c === '"') {
      inString = true;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function buildEnv(config, envName) {
  const env = envName === "production" ? config : config.env?.[envName];
  if (!env) throw new Error(`wrangler.jsonc has no env "${envName}"`);
  // Wrangler doesn't inherit top-level `vars` into an env, so only the env's own block counts.
  const vars = env.vars ?? {};
  const placeholders = Object.entries(vars)
    .filter(([, v]) => typeof v === "string" && /^<.*>$/.test(v))
    .map(([k]) => k);
  if (placeholders.length) {
    throw new Error(
      `wrangler.jsonc env "${envName}" still has placeholder values: ${placeholders.join(", ")}`,
    );
  }
  return Object.entries(vars).map(([k, v]) => {
    const value = typeof v === "string" ? v : JSON.stringify(v);
    // JSON and other values with special characters are single-quoted for the .env file.
    return /^[\w:/.@-]*$/.test(value) ? `${k}=${value}` : `${k}='${value}'`;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const envName = process.argv[2];
  try {
    const config = JSON.parse(stripJsonc(readFileSync("wrangler.jsonc", "utf8")));
    console.log(buildEnv(config, envName).join("\n"));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
