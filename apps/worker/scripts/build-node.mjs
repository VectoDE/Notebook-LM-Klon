/**
 * Builds the Node runtime into one file: apps/worker/dist/node-server.js.
 *
 * Every dependency is bundled, so a production image needs no node_modules and no tsx:
 * only this file, apps/worker/migrations (read at start) and the built web app.
 * Run with: pnpm --filter @notebook-lm/worker build:node
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [resolve(root, "src/node-server.ts")],
  outfile: resolve(root, "dist/node-server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  sourcemap: "linked",
  legalComments: "linked",
  metafile: true,
  logLevel: "info",
  // CommonJS dependencies (e.g. nodemailer) call require() for Node built-ins.
  banner: {
    js: 'import { createRequire as __nlkCreateRequire } from "node:module"; const require = __nlkCreateRequire(import.meta.url);'
  }
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.info(
  `[build-node] dist/node-server.js gebaut (${(bytes / 1024).toFixed(0)} KiB inkl. Sourcemap).`
);
