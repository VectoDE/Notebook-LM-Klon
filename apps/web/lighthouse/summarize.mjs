// Fasst den repräsentativen Lighthouse-Lauf (Median) als Markdown-Tabelle zusammen.
// Aufruf: node apps/web/lighthouse/summarize.mjs .lighthouseci/<profil>
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.argv[2] ?? ".lighthouseci";
const manifestPath = join(dir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.log(`### Lighthouse ${basename(dir)}\n\nKein Report gefunden (${manifestPath}).`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const entry = manifest.find((run) => run.isRepresentativeRun) ?? manifest[0];
const report = JSON.parse(readFileSync(entry.jsonPath, "utf-8"));
const audit = (id) => report.audits[id];
const scripts = audit("resource-summary").details.items.find((i) => i.resourceType === "script");
const total = audit("resource-summary").details.items.find((i) => i.resourceType === "total");

const rows = [
  ["Performance-Score", Math.round(report.categories.performance.score * 100), "–"],
  ["LCP", audit("largest-contentful-paint").displayValue, "< 2,5 s"],
  ["TBT (Labor-Ersatz für INP)", audit("total-blocking-time").displayValue, "< 200 ms"],
  ["CLS", audit("cumulative-layout-shift").displayValue, "< 0,1"],
  ["FCP", audit("first-contentful-paint").displayValue, "–"],
  ["Script (Transfer)", `${(scripts.transferSize / 1024).toFixed(1)} KiB`, "< 547 KiB"],
  ["Gesamt (Transfer)", `${(total.transferSize / 1024).toFixed(1)} KiB`, "Warnung > 1074 KiB"]
];

console.log(`### Lighthouse ${basename(dir)} (${report.configSettings.formFactor})\n`);
console.log("| Messwert | Ergebnis | Budget |\n| --- | --- | --- |");
for (const [name, value, budget] of rows) console.log(`| ${name} | ${value} | ${budget} |`);
console.log(`\nLighthouse ${report.lighthouseVersion}, ${entry.url}`);
