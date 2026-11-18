// Copies the static desktop build into desktop-dist/ for Tauri.
// The SPA build writes its page as _shell.html (dist/client locally, .output/public on
// some hosts); Tauri opens index.html, so without this the window stays blank.
import { cpSync, existsSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";

const from = ["dist/client", ".output/public"].find(
  (d) => existsSync(`${d}/_shell.html`) || existsSync(`${d}/index.html`),
);
if (!from) {
  console.error("Desktop build output not found (looked in dist/client and .output/public).");
  process.exit(1);
}
rmSync("desktop-dist", { recursive: true, force: true });
cpSync(from, "desktop-dist", { recursive: true });
if (!existsSync("desktop-dist/index.html"))
  renameSync("desktop-dist/_shell.html", "desktop-dist/index.html");
console.log(`Desktop files ready in desktop-dist/ (from ${from}).`);

// Open-source licenses for the Rust libraries only the desktop app ships (SHARED-SPEC §10.3). The
// About page adds them to the suite's list; the web build never has these files.
const rust = JSON.parse(readFileSync("licenses/rust.json", "utf8")).packages;
const seen = new Set();
const libraries = [];
for (const { name, license } of rust) {
  const shown = license === "UNKNOWN" ? "Not stated" : license;
  if (seen.has(`${name}\u0000${shown}`)) continue;
  seen.add(`${name}\u0000${shown}`);
  libraries.push({ name, license: shown });
}
writeFileSync("desktop-dist/rust-libraries.json", JSON.stringify({ libraries }));
cpSync("licenses/THIRD-PARTY-LICENSES-RUST.txt", "desktop-dist/third-party-licenses-rust.txt");
console.log(`Desktop license files ready (${libraries.length} Rust libraries).`);
