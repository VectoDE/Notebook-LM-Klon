import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const workflow = read(".github/workflows/load-test.yml");
const script = read("load-test/k6/scenarios.js");
const runner = read("load-test/run-local.mjs");
const fakeLlm = read("load-test/fake-ollama.mjs");

describe("k6-Lasttest mit 200 gleichzeitigen Nutzern (#256)", () => {
  it("simuliert standardmäßig 200 Nutzer in CI und lokal", () => {
    expect(workflow).toContain('default: "200"');
    expect(workflow).toContain("inputs.peak_vus || '200'");
    expect(script).toContain("Number(__ENV.PEAK_VUS || 200)");
    expect(runner).toContain('argument("peak", "200")');
  });

  it("deckt Gast, Quelle hochladen, Chat, Suche und Studio ab", () => {
    for (const exec of ["publicVisitor", "guestMember", "sourceCreator"]) {
      expect(script).toContain(`exec: "${exec}"`);
      expect(script).toContain(`export function ${exec}()`);
    }
    for (const route of [
      "/api/v1/auth/guest",
      "/api/v1/notebooks/${creatorState.notebookId}/sources",
      "/api/v1/sources/${sourceId}/upload",
      "/api/v1/sources/${sourceId}/upload/complete",
      "/api/v1/sources/${sourceId}/chunks",
      "/api/v1/notebooks/${creatorState.notebookId}/search",
      "/api/v1/notebooks/${creatorState.notebookId}/chat",
      "/api/v1/jobs/enqueue"
    ]) {
      expect(script).toContain(route);
    }
  });

  it("prüft Fehlerrate und p95 als harte Schwellen, auch je Ablauf", () => {
    expect(script).toContain('http_req_failed: ["rate<0.01"]');
    expect(script).toContain('http_req_duration: ["p(95)<800", "p(99)<2000"]');
    for (const endpoint of [
      "guest_login",
      "search_fts",
      "source_upload",
      "chat",
      "studio_enqueue"
    ]) {
      expect(script).toMatch(
        new RegExp(`"http_req_duration\\{endpoint:${endpoint}\\}": \\["p\\(95\\)<\\d+"\\]`)
      );
    }
  });

  it("läuft nur gegen die im Job gestartete Instanz und ein Test-LLM auf Loopback", () => {
    expect(runner).toContain("const BASE_URL = `http://127.0.0.1:${PORT}`");
    expect(runner).toContain('"--local"');
    expect(runner).toContain("startFakeOllama");
    expect(fakeLlm).toContain('listen(port, "127.0.0.1")');
    expect(fakeLlm).not.toMatch(/listen\(port, "0\.0\.0\.0"\)/);
    expect(script).toContain('model: "llama3"');
  });

  it("legt HTML- und JSON-Report als Artefakt ab und vergibt nur Leserechte", () => {
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("name: load-test-report");
    expect(runner).toContain("K6_WEB_DASHBOARD_EXPORT");
    expect(runner).toContain("render-report.mjs");
    expect(workflow).not.toMatch(/:\s*write\b/);
  });
});
