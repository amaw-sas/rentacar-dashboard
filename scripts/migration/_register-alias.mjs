// Minimal ESM resolve hook that maps the project's `@/` import alias to the repo
// root, so a `.ts` migration script can run under Node's native type-stripping
// (`node --experimental-strip-types ...`) the same way vitest resolves it.
//
//   node --import ./scripts/migration/_register-alias.mjs <script>.ts ...args
//
// Resolution mirrors tsconfig `@/* -> ./*`, trying `.ts`, `.tsx`, then `/index.ts`.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

function resolveAlias(specifier) {
  const base = path.join(root, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const url = resolveAlias(specifier);
      if (url) return { url, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
