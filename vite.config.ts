import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

// Desktop (Tauri) loads files from disk, so it builds as a static single-page app.
const desktop = process.argv.includes("desktop");

export default defineConfig(({ command }) => ({
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  // Pre-bundle recharts with React up front so a late discovery doesn't produce
  // two React copies (null useRef crash).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "recharts",
    ],
  },
  server: { host: "::", port: 8080 },
  // The desktop build prerenders through a preview server; IPv4 loopback works everywhere.
  preview: { host: "127.0.0.1" },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      ...(desktop ? { spa: { enabled: true } } : {}),
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // TanStack Start's server entry is src/server.ts (our SSR error wrapper); nitro builds from it.
      server: { entry: "server" },
    }),
    // The hosted build is a Cloudflare Worker; the desktop build is static files only.
    ...(command === "build" && !desktop ? [nitro({ preset: "cloudflare-module" })] : []),
    viteReact(),
  ],
  // Unit tests only: e2e/ is Playwright's (npm run test:e2e).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
}));
