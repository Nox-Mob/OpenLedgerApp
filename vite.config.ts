// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { configDefaults } from "vitest/config";

// Desktop (Tauri) loads files from disk, so it builds as a static single-page app.
const desktop = process.argv.includes("desktop");

export default defineConfig({
  tanstackStart: {
    ...(desktop ? { spa: { enabled: true } } : {}),
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Pre-bundle recharts with React up front so a late discovery doesn't produce
  // two React copies (null useRef crash).
  vite: {
    optimizeDeps: { include: ["recharts"] },
    // Unit tests only: e2e/ is Playwright's (npm run test:e2e).
    test: { exclude: [...configDefaults.exclude, "e2e/**"] },
  },
});
