/**
 * Schreibt die Farbblöcke in apps/web/src/themes.css aus design-tokens.ts neu
 * (zwischen den Markierungen @tokens:start und @tokens:end).
 *
 * Aufruf: pnpm --filter @notebook-lm/web themes:generate
 * Der Test design-tokens.test.ts schlägt fehl, wenn themes.css nicht synchron ist.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildThemeCss } from "../src/design-tokens.ts";

const file = resolve(import.meta.dirname, "../src/themes.css");
const css = readFileSync(file, "utf8");
const start = "/* @tokens:start */";
const end = "/* @tokens:end */";
const a = css.indexOf(start);
const b = css.indexOf(end);
if (a < 0 || b < a) {
  throw new Error("Markierungen @tokens:start/@tokens:end fehlen in themes.css");
}
const next = `${css.slice(0, a + start.length)}\n${buildThemeCss()}${css.slice(b)}`;
writeFileSync(file, next, "utf8");
console.log("themes.css aktualisiert");
