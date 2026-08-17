import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Playwright suite's build output (see next.config.ts `distDir`). Without this,
    // linting the repo means linting a few megabytes of minified server chunks.
    ".next-e2e/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    files: ["e2e/**/*.ts"],
    rules: {
      /**
       * Playwright names its fixture callback `use`, which the React rule reads as the
       * `use` hook being called outside a component. There is no React in this directory;
       * the rule is matching on the identifier alone.
       */
      "react-hooks/rules-of-hooks": "off",
      // `async ({}, use)` is Playwright's documented way to declare a fixture that takes
      // no other fixtures.
      "no-empty-pattern": "off",
    },
  },
]);

export default eslintConfig;
