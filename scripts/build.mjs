// Bundle src/entry.ts into dist/index.js — one file, Node only, sql.js
// WebAssembly inlined. Same approach as the upstream extension.
import { build } from "esbuild";

await build({
    entryPoints: ["src/entry.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    loader: { ".wasm": "binary" },
    outfile: "dist/index.js",
    legalComments: "linked",
    banner: {
        js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __furl } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __furl(import.meta.url); const __dirname = __dn(__filename);",
    },
    logLevel: "info",
});
