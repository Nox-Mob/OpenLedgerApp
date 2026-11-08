// Env file safety (docs/SHARED-SPEC.md §7.1):
// 1. No env file may be tracked except .env.example (placeholders) and .env.desktop (public build flag).
//    Real values live in wrangler.jsonc vars (public), Worker secrets, or an untracked .env.local.
// 2. The tracked env files must not contain anything that looks like a private key.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const ALLOWED_ENV_FILES = [".env.example", ".env.desktop"];

/** Tracked paths that are env files but not on the allowlist. */
export function trackedEnvFindings(paths) {
  return paths.filter((p) => {
    const name = p.split("/").pop() ?? "";
    const isEnv = name === ".env" || name.startsWith(".env.") || name === ".dev.vars";
    return isEnv && !ALLOWED_ENV_FILES.includes(p);
  });
}

/** Lines holding a private value. Names alone are fine in .env.example when the value is a placeholder. */
export function privateKeyFindings(text, { allowPlaceholders = false } = {}) {
  const bad = [];
  text.split("\n").forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const [name, ...rest] = l.split("=");
    const value = rest.join("=").replace(/^["']|["']$/g, "");
    const placeholder = value === "" || /^<[^>]*>$/.test(value);
    if (/SERVICE_ROLE|SECRET|PASSWORD|PRIVATE|DB_URL|API_KEY|SEED/i.test(name)) {
      if (!(allowPlaceholders && placeholder)) bad.push(`${i + 1}: ${name}`);
    } else if (/sb_secret_/.test(value)) bad.push(`${i + 1}: ${name} (secret key)`);
    else if (/^eyJ[\w-]+\.([\w-]+)\./.test(value)) {
      try {
        const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
        if (payload.role === "service_role") bad.push(`${i + 1}: ${name} (service role token)`);
      } catch {
        /* not a token */
      }
    }
  });
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const problems = trackedEnvFindings(tracked).map(
    (p) =>
      `${p} is tracked. Run \`git rm --cached ${p}\` and move its values to wrangler.jsonc vars or .env.local.`,
  );
  for (const file of ALLOWED_ENV_FILES) {
    if (!existsSync(file)) continue;
    const allowPlaceholders = file === ".env.example";
    for (const f of privateKeyFindings(readFileSync(file, "utf8"), { allowPlaceholders })) {
      problems.push(`${file} line ${f} holds a private value. Remove it and rotate the key.`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    "Env files: only .env.example and .env.desktop are tracked, and they hold no private values.",
  );
}
