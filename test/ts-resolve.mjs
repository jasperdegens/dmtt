// test/ts-resolve.mjs — module-resolution hook for `node --test`.
//
// Node 22's native TypeScript type-stripping runs ESM with strict resolution:
// extensionless relative imports are NOT resolved. The frozen `lib/fixtures.ts`
// imports `./types` (no extension), so loading it under `node --test` fails with
// ERR_MODULE_NOT_FOUND. `lib/**` is a frozen contract we must not edit, so we
// teach the loader to retry an extensionless relative specifier as `.ts`.
//
// Registered via `node --import ./test/ts-resolve.mjs` in the "test" script.
// Scope is minimal: only relative specifiers (./ or ../) that fail to resolve
// get a single `.ts` retry; everything else falls through untouched.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, nextResolve) {
        try {
          return await nextResolve(specifier, context);
        } catch (err) {
          const relative = specifier.startsWith("./") || specifier.startsWith("../");
          const hasExt = /\\.[cm]?[jt]sx?$/.test(specifier);
          if (relative && !hasExt) {
            return await nextResolve(specifier + ".ts", context);
          }
          throw err;
        }
      }
    `),
  pathToFileURL("./").href,
);
