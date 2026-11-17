import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, type Kind, type PackageConfig } from "./support/import-graph";

/**
 * Import-Struktur (Umbau F426, PR 9): keine Zyklen, Barrels nur mit Re-Exporten, Ordnergrenzen
 * nur über das Barrel, Schichten als Kantenliste. Der Test prüft sich selbst an einem Fixture.
 */
const ROOT = join(import.meta.dirname, "../..");
const FIXTURE = join(import.meta.dirname, "fixtures/import-graph/bad");

/** Erlaubte Ordnerkanten der Web-App (statische Wert-Importe). */
const WEB_EDGES = [
  ".->components/layout",
  ".->components/lazy",
  ".->components/panels",
  ".->config",
  ".->hooks",
  ".->lib/utils",
  ".->services/analytics",
  "components/dialogs->components/ui",
  "components/dialogs->hooks",
  "components/dialogs->lib/a11y",
  "components/dialogs->services/api",
  "components/layout->components/lazy",
  "components/layout->components/panels",
  "components/layout->components/ui",
  "components/layout->components/viewers",
  "components/layout->hooks",
  "components/layout->lib/a11y",
  "components/layout->lib/export",
  "components/layout->lib/graph",
  "components/layout->lib/utils",
  "components/layout->preferences",
  "components/layout->services/api",
  "components/layout->services/llm",
  "components/layout->services/storage",
  "components/layout->services/sync",
  "components/layout->theme",
  "components/media->components/ui",
  "components/media->hooks",
  "components/media->lib/a11y",
  "components/media->lib/export",
  "components/media->lib/utils",
  "components/media->services/api",
  "components/media->theme",
  "components/panels->components/lazy",
  "components/panels->components/media",
  "components/panels->components/ui",
  "components/panels->hooks",
  "components/panels->i18n",
  "components/panels->i18n/catalogs",
  "components/panels->lib/a11y",
  "components/panels->lib/export",
  "components/panels->lib/utils",
  "components/panels->preferences",
  "components/panels->services/analytics",
  "components/panels->services/api",
  "components/panels->services/llm",
  "components/panels->theme",
  "components/ui->hooks",
  "components/ui->lib/utils",
  "components/ui->theme",
  "components/viewers->components/ui",
  "components/viewers->hooks",
  "components/viewers->lib/export",
  "components/viewers->lib/graph",
  "components/viewers->preferences",
  "components/viewers->services/api",
  "components/viewers->theme",
  "hooks->config",
  "hooks->i18n",
  "hooks->i18n/catalogs",
  "hooks->lib/a11y",
  "hooks->services/storage",
  "hooks->theme",
  "services/analytics->config",
  "services/llm->i18n",
  "services/llm->i18n/catalogs",
  "services/sync->services/storage",
  "theme->i18n"
] as const;

/** Erlaubte Ordnerkanten des Workers (statische Wert-Importe). */
const WORKER_EDGES = [
  ".->config",
  ".->db",
  ".->durable-objects",
  ".->middleware",
  ".->platform/node",
  ".->repositories",
  ".->routes",
  ".->scheduled",
  ".->security",
  ".->services",
  "durable-objects->routes",
  "middleware->security",
  "middleware->services",
  "platform/node->db",
  "platform/node->routes",
  "platform/node->scheduled",
  "platform/node->security",
  "providers->security",
  "routes->config",
  "routes->db",
  "routes->middleware",
  "routes->providers",
  "routes->scheduled",
  "routes->security",
  "routes->services",
  "scheduled->config",
  "scheduled->security",
  "services->config"
] as const;

const PACKAGES: PackageConfig[] = [
  {
    name: "web",
    src: join(ROOT, "apps/web/src"),
    alias: true,
    skipFolders: ["workers", "assets", "styles", "i18n/locales"],
    allowedEdges: WEB_EDGES
  },
  { name: "worker", src: join(ROOT, "apps/worker/src"), alias: true, allowedEdges: WORKER_EDGES },
  { name: "shared", src: join(ROOT, "packages/shared/src"), alias: false }
];

/** Module, die Node-Skripte ohne Vite-Alias laden (generate-theme-css, build-diagrams, vite.config.ts). */
const ALIAS_FREE = [
  "apps/web/src/config/analytics-config.ts",
  "apps/web/src/config/seo.ts",
  "apps/web/src/theme/design-tokens.ts",
  "apps/web/src/i18n/catalogs/diagram-i18n.ts"
] as const;

describe("Import-Struktur der Pakete", () => {
  it.each(PACKAGES)("$name: keine Verstöße gegen Zyklen-, Barrel- und Schichtregeln", (cfg) => {
    expect(existsSync(cfg.src)).toBe(true);
    expect(check(cfg).map((v) => v.message)).toEqual([]);
  });

  it("Module, die Skripte ohne Alias laden, nutzen kein @/", () => {
    for (const file of ALIAS_FREE) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).not.toMatch(/from "@\//);
    }
  });
});

describe("Selbsttest am Fixture mit absichtlichen Fehlern", () => {
  const kinds = (cfg: PackageConfig): Set<Kind> => new Set(check(cfg).map((v) => v.kind));

  it("erkennt Zyklus, Logik im Barrel, eigenes Barrel, Tiefenimport und Wert-Re-Export", () => {
    const found = kinds({ name: "fx", src: FIXTURE, alias: false, allowedEdges: [] });
    for (const kind of [
      "cycle",
      "barrel-logic",
      "own-barrel",
      "deep-import",
      "dynamic-reexport",
      "edge-not-allowed"
    ] as const) {
      expect(found.has(kind), kind).toBe(true);
    }
  });

  it("erkennt @/ in einem Paket ohne Alias", () => {
    expect(kinds({ name: "fx", src: FIXTURE, alias: false }).has("alias-in-shared")).toBe(true);
    expect(kinds({ name: "fx", src: FIXTURE, alias: true }).has("alias-in-shared")).toBe(false);
  });
});
