import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import worker from "../index.js";

const WRANGLER_PATH = join(import.meta.dirname, "../../wrangler.jsonc");

/** wrangler.jsonc erlaubt Kommentare; ganze Kommentarzeilen werden vor JSON.parse entfernt. */
function readWranglerConfig(): string {
  return readFileSync(WRANGLER_PATH, "utf-8").replace(/^\s*\/\/.*$/gm, "");
}

describe("Wrangler Single-Worker Configuration", () => {
  it("declares SPA static assets routing with /api/* worker-first handling", () => {
    const raw = readWranglerConfig();
    const parsed = JSON.parse(raw) as {
      name: string;
      assets: {
        directory: string;
        binding: string;
        not_found_handling: string;
        run_worker_first: string[];
      };
      d1_databases: { binding: string; database_name: string }[];
      r2_buckets: { binding: string; bucket_name: string }[];
      durable_objects: { bindings: { name: string; class_name: string }[] };
      migrations: { tag: string; new_sqlite_classes: string[] }[];
    };

    expect(parsed.name).toBe("notebook-lm-klon");
    expect(parsed.assets.not_found_handling).toBe("single-page-application");
    expect(parsed.assets.run_worker_first).toContain("/api/*");
    expect(parsed.d1_databases[0]?.binding).toBe("DB");
    expect(parsed.r2_buckets[0]?.binding).toBe("MEDIA");
    expect(parsed.durable_objects.bindings).toEqual([
      { name: "NOTEBOOK_DO", class_name: "NotebookDO" },
      { name: "JOB_DO", class_name: "JobDO" }
    ]);
    expect(parsed.migrations[0]?.new_sqlite_classes).toEqual(["NotebookDO", "JobDO"]);
  });

  it("schedules the hourly cleanup cron handled by the worker's scheduled() export (#334)", () => {
    const parsed = JSON.parse(readWranglerConfig()) as {
      main: string;
      compatibility_flags?: string[];
      triggers?: { crons?: string[] };
    };

    expect(parsed.triggers?.crons).toEqual(["0 * * * *"]);
    expect(parsed.compatibility_flags).toContain("nodejs_compat");
    expect(parsed.main).toBe("src/index.ts");
    expect(typeof worker.scheduled).toBe("function");
  });

  it("hält die Region fest: D1 mit EU-Jurisdiktion, R2 mit Location Hint weur, beides nur beim Anlegen (F249)", () => {
    const raw = readFileSync(WRANGLER_PATH, "utf-8");
    const parsed = JSON.parse(readWranglerConfig()) as {
      d1_databases: Record<string, unknown>[];
      r2_buckets: Record<string, unknown>[];
    };
    // D1-Jurisdiktion und R2-Location-Hint gelten beim Anlegen, nicht im Binding.
    // Ein R2-Binding braucht "jurisdiction" nur für Jurisdiktions-Buckets (eu, fedramp, us);
    // der Bucket hat nur einen Location Hint, das Feld würde ihn nicht finden.
    expect(parsed.r2_buckets[0]).toEqual({ binding: "MEDIA", bucket_name: "notebook-lm-media" });
    expect(parsed.d1_databases[0]).not.toHaveProperty("jurisdiction");
    expect(raw).toContain("wrangler d1 create notebook-lm-db --jurisdiction=eu");
    expect(raw).toContain("wrangler r2 bucket create notebook-lm-media --location=weur");

    const deploy = readFileSync(join(import.meta.dirname, "../../../../docs/deploy.md"), "utf-8");
    expect(deploy).toContain("wrangler d1 create notebook-lm-db --jurisdiction=eu");
    expect(deploy).toContain("wrangler r2 bucket create notebook-lm-media --location=weur");
    // Ehrlichkeit: der R2-Standort ist ein Wunsch ohne Garantie, keine EU-Zusage für Uploads.
    expect(deploy).toContain("Wunsch ohne Garantie");
    expect(deploy).toContain("bevorzugt Westeuropa, ohne Garantie");
    expect(raw).toContain("Wunsch ohne Garantie");
  });
});
