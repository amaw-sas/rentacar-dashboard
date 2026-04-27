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
    // Proxy is a separate package with its own tooling; its compiled
    // output ends up here at the repo root and must not be linted.
    "proxy/dist/**",
    "proxy/node_modules/**",
  ]),
]);

export default eslintConfig;
