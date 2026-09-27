import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Lints TypeScript and the root configs. The legacy browser JavaScript under apps/web/public is ignored
// until it is rewritten in TypeScript.
export default defineConfig([
  globalIgnores(["**/node_modules/", "**/.cache/", "apps/web/public/", "apps/web/dist/", "apps/web/.astro/", "docs/"]),
  {
    files: ["*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // An empty string means "not set" (environment, database columns), so `text || fallback` is intended.
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
    },
  },
  {
    // node:test registers tests through returned promises that the runner awaits itself.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  },
]);
