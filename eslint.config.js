import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "shared/**",
      "db/core/**",
      "scripts/migrate.mjs",
      "scripts/check-shared.mjs",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // React Compiler rules. Components defined inside render remount (and lose focus) every time.
      "react-hooks/static-components": "error",
      "react-hooks/purity": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
      // Off on purpose: reading browser-only state (theme, storage, URL hash) in useEffect is how
      // this app avoids SSR hydration mismatches, and that pattern sets state inside an effect.
      "react-hooks/set-state-in-effect": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Zero loose types in app code since v0.0.5; new ones fail the check.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  eslintPluginPrettier,
  // Formatting is checked separately (`npm run format:check`) so lint errors mean real code problems.
  { rules: { "prettier/prettier": "off" } },
  // Route files must export `Route`, and shadcn ui files export variants by design.
  {
    files: ["src/routes/**/*.tsx", "src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  // Vendored shadcn files: skeleton widths use Math.random by design.
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-hooks/purity": "off" },
  },
  // Test doubles fake only the slice of a library they need; loose types are fine there.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Generated / vendored files are not ours to edit.
  { ignores: ["src/integrations/supabase/**", "src/routeTree.gen.ts"] },
);
