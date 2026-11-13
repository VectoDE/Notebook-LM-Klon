// Erzeugt aus summary-<profil>.json einen statischen HTML-Report ohne Skripte.
//
//   node load-test/render-report.mjs <summary.json> <report.html>

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Aufruf: node load-test/render-report.mjs <summary.json> <report.html>");
  process.exit(2);
}

const { summary } = JSON.parse(readFileSync(input, "utf8"));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ms = (n) => (typeof n === "number" ? `${n.toFixed(1)} ms` : "n/a");
const percent = (n) => (typeof n === "number" ? `${(n * 100).toFixed(2)} %` : "n/a");

const rows = [
  ["Profil", summary.profile],
  ["Erzeugt", summary.generatedAt],
  ["Werkzeug", summary.k6Version],
  ["Simulierte Nutzer (Spitze)", summary.peakVus],
  ["Anfragen", summary.requests],
  ["Durchsatz", `${summary.requestsPerSecond.toFixed(1)} Anfragen/s`],
  ["Fehlerquote", percent(summary.failedRate)],
  ["Unerwartete Status", percent(summary.unexpectedStatusRate)],
  ["Status 429 (Rate-Limit)", summary.rateLimited],
  ["Erfolgreiche Prüfungen", percent(summary.checksPassRate)],
  ["Latenz p50", ms(summary.durationMs.p50)],
  ["Latenz p90", ms(summary.durationMs.p90)],
  ["Latenz p95", ms(summary.durationMs.p95)],
  ["Latenz p99", ms(summary.durationMs.p99)],
  ["Latenz Maximum", ms(summary.durationMs.max)],
  ["Schwellenwerte", summary.thresholdsPassed ? "erfüllt" : "verletzt"]
];
const endpointRows = Object.entries(summary.perEndpointP95Ms).sort((a, b) => a[1] - b[1]);
const checkRows = Object.entries(summary.checks || {});

const table = (head, body) =>
  `<table><thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lasttest-Report ${escapeHtml(summary.profile)}</title>
<style>
:root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1b16; --muted: #5c5648; --line: #d9d4c7; }
@media (prefers-color-scheme: dark) { :root { --bg: #14130f; --fg: #f2efe6; --muted: #b9b3a2; --line: #3a372e; } }
body { margin: 0 auto; max-width: 52rem; padding: 2rem 1rem; background: var(--bg); color: var(--fg); font: 1rem/1.5 system-ui, sans-serif; }
h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; }
p { color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>Lasttest-Report (${escapeHtml(summary.profile)})</h1>
<p>Statischer Report aus den k6-Messwerten. Quelle: <code>${escapeHtml(input.split(/[\/]/).pop())}</code>.</p>
<h2>Kennzahlen</h2>
${table(["Kennzahl", "Wert"], rows)}
<h2>Latenz p95 je Endpunkt</h2>
${table(
  ["Endpunkt", "p95"],
  endpointRows.map(([name, value]) => [name, ms(value)])
)}
<h2>Prüfungen</h2>
${table(
  ["Prüfung", "Erfolgreich", "Fehlgeschlagen"],
  checkRows.map(([name, c]) => [name, c.passes, c.fails])
)}
</main>
</body>
</html>
`;
writeFileSync(output, html, "utf8");
