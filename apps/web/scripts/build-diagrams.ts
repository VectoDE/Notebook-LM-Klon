/**
 * Erzeugt die deutschen, englischen und automatischen Fassungen der Diagramme und des
 * Hero-Banners in docs/assets aus docs/assets/src und docs/assets/i18n/strings.json.
 *
 * Aufruf: node apps/web/scripts/build-diagrams.ts          (schreibt die Dateien)
 *         node apps/web/scripts/build-diagrams.ts --check  (Exit 1, wenn etwas veraltet ist)
 * Der Test diagram-i18n.test.ts schlägt ebenfalls fehl, wenn die Ausgaben nicht synchron sind.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type DiagramStrings, buildDiagramVariants } from "../src/diagram-i18n.ts";

const assets = resolve(import.meta.dirname, "../../../docs/assets");
const catalog = JSON.parse(readFileSync(resolve(assets, "i18n/strings.json"), "utf8")) as Record<
  string,
  DiagramStrings
>;
const sources = Object.fromEntries(
  readdirSync(resolve(assets, "src"))
    .filter((f) => f.endsWith(".svg"))
    .map((f) => [f, readFileSync(resolve(assets, "src", f), "utf8")])
);

const check = process.argv.includes("--check");
const stale: string[] = [];
for (const [file, svg] of buildDiagramVariants(sources, catalog)) {
  const target = resolve(assets, file);
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current === svg) {
    continue;
  }
  if (check) {
    stale.push(file);
  } else {
    writeFileSync(target, svg, "utf8");
    console.log(`geschrieben: docs/assets/${file}`);
  }
}
if (stale.length > 0) {
  console.error(
    `Veraltet: ${stale.join(", ")}. Neu erzeugen mit node apps/web/scripts/build-diagrams.ts`
  );
  process.exit(1);
}
