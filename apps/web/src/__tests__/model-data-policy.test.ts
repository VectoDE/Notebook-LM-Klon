import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsDrawer } from "../SettingsDrawer.js";
import {
  CONNECTION_KEYS,
  MODEL_DATA_POLICIES,
  POLICY_RETRIEVED,
  SOURCES,
  STATUS_KEYS,
  policyFor
} from "../model-data-policy.js";
import { MODEL_IDS } from "../theme-preferences.js";
import { TRANSLATIONS, ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const DOC = readFileSync(join(REPO_ROOT, "docs/datenschutz-modelle.md"), "utf-8");
const WIKI = readFileSync(join(REPO_ROOT, "docs/wiki/10-Datenschutz-je-KI-Modell.md"), "utf-8");

function renderDrawer(model: string, language: "de" | "en" = "de"): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { defaultLanguage: language } as ThemeProviderProps,
      createElement(SettingsDrawer, { isOpen: true, onClose: () => {}, activeModel: model })
    )
  );
}

describe("Training-Angabe je Modell (Issue #302)", () => {
  it("hat für jedes wählbare Modell eine Angabe mit mindestens einer https-Quelle", () => {
    for (const id of MODEL_IDS) {
      const policy = MODEL_DATA_POLICIES[id];
      expect(policy, id).toBeDefined();
      expect(policy.sources.length, id).toBeGreaterThan(0);
      for (const source of policy.sources) expect(source.url, id).toMatch(/^https:\/\//);
    }
  });

  it("führt alle Texte auf Deutsch und Englisch", () => {
    const keys = [
      ...Object.values(STATUS_KEYS),
      ...Object.values(CONNECTION_KEYS),
      ...MODEL_IDS.map((id) => MODEL_DATA_POLICIES[id].noteKey),
      "policyTitle",
      "policySource",
      "policyNewWindow",
      "policyRetrieved",
      "policyDisclaimer"
    ];
    for (const key of keys) {
      expect(TRANSLATIONS.de[key], `de.${key}`).toBeTruthy();
      expect(TRANSLATIONS.en[key], `en.${key}`).toBeTruthy();
    }
  });

  it("behauptet nirgends pauschal „ohne Training“ oder „On-Device“", () => {
    for (const lang of ["de", "en"] as const) {
      const all = Object.values(TRANSLATIONS[lang]).join(" ");
      expect(all).not.toMatch(/ohne Training|zero model training|On-Device/i);
    }
    for (const id of MODEL_IDS) {
      const html = renderDrawer(id);
      expect(html, id).not.toMatch(/ohne Training|On-Device|DSGVO-konform/);
    }
  });

  it("nennt jede Quelle samt Abrufdatum auch in der Doku und im Wiki", () => {
    expect(WIKI).toBe(DOC);
    for (const source of Object.values(SOURCES)) {
      expect(DOC, source.url).toContain(`(${source.url})`);
      expect(DOC, source.label).toContain(source.label);
    }
    expect(DOC).toContain(`Stand: ${POLICY_RETRIEVED}`);
    expect(DOC).toContain("keine Rechtsberatung");
  });

  it("stuft Gemini nur bedingt ein, Ollama lokal, Anthropic/OpenAI ohne Training", () => {
    expect(policyFor("gemini-2.5-flash").status).toBe("conditional");
    expect(policyFor("gemini-2.5-pro").status).toBe("conditional");
    expect(policyFor("ollama-local").status).toBe("local");
    expect(policyFor("claude-3-7-sonnet").status).toBe("noTraining");
    expect(policyFor("gpt-4o").status).toBe("noTraining");
    // DeepSeek landet derzeit bei Gemini: dann gelten Googles Bedingungen
    expect(policyFor("deepseek-r1")).toMatchObject({
      status: "conditional",
      connection: "routedToGemini"
    });
    expect(policyFor("deepseek-r1").sources).toContain(SOURCES.geminiTerms);
  });

  it("fällt bei unbekanntem Modell auf das Standardmodell zurück", () => {
    expect(policyFor("unbekannt")).toBe(MODEL_DATA_POLICIES["gemini-2.5-flash"]);
  });

  it("zeigt beim Standardmodell Bedingung, Quelle als Link in neuem Fenster und Stand", () => {
    const html = renderDrawer("gemini-2.5-flash");
    expect(html).toContain('data-testid="model-policy" data-status="conditional"');
    expect(html).toContain("Kein Training nur unter Bedingungen.");
    expect(html).toContain("im EWR, in der Schweiz oder im Vereinigten Königreich");
    expect(html).toContain(
      '<a href="https://aistudio.google.com/docs/terms" target="_blank" rel="noopener noreferrer" lang="en">Gemini API Additional Terms of Service</a>'
    );
    expect(html).toContain("(öffnet in neuem Fenster)");
    expect(html).toContain(
      "Stand der Anbieterangaben: 13. November 2026. Zusammenfassung, keine Rechtsberatung."
    );
    expect(html).not.toContain('data-testid="model-policy-connection"');
    expect(html).toContain('aria-describedby="settings-model-hint settings-model-policy"');
    expect(html).toContain('id="settings-model-policy"');
    expect(html).toContain(">Google Gemini 2.5 Flash (Standard)</option>");
    expect(html).toContain(">Ollama Llama 3 (auf dem Server)</option>");
  });

  it("sagt bei nicht angebundenen Modellen, was mit der Anfrage passiert", () => {
    const claude = renderDrawer("claude-3-7-sonnet");
    expect(claude).toContain("Laut Anbieter kein Training.");
    expect(claude).toContain("Anfragen mit diesem Modell schlagen derzeit fehl");
    const deepseek = renderDrawer("deepseek-r1");
    expect(deepseek).toContain("Anfragen gehen derzeit an Google Gemini 2.5 Flash");
    expect(deepseek).toContain("GroqCloud Services Agreement, 4.2");
    const ollama = renderDrawer("ollama-local");
    expect(ollama).toContain("Lokal, kein externer Anbieter.");
    expect(ollama).toContain("auf dem Server dieser Installation");
  });

  it("übersetzt die Angabe ins Englische", () => {
    const html = renderDrawer("gpt-4o", "en");
    expect(html).toContain("Training on your input: </strong>");
    expect(html).toContain("No training, per provider.");
    expect(html).toContain("Since 1 March 2023");
    expect(html).toContain("Not connected yet");
    expect(html).toContain("Provider terms as of: 13 November 2026. Summary, not legal advice.");
    expect(html).toContain("(opens in a new window)");
    expect(html).toContain(">Google Gemini 2.5 Flash (default)</option>");
    expect(html).toContain(">Ollama Llama 3 (on the server)</option>");
  });
});
