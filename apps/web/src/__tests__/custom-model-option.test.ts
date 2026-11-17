/**
 * „Eigener Endpunkt“ in der Modellauswahl (Entscheidung F249, Issue #247).
 *
 * Die Option erscheint immer, ist aber erst wählbar, wenn ein Endpunkt eingerichtet ist. Sonst
 * erklärt ein Hinweis den Weg und verlinkt den Abschnitt „Eigener Endpunkt“. Der Chat schickt
 * dann `model: "custom"` an den Server.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeProvider, type ThemeProviderProps, TRANSLATIONS } from "@/hooks/useTheme.js";
import { MODEL_DATA_POLICIES, policyFor, STATUS_KEYS } from "@/services/llm/model-data-policy.js";
import {
  CUSTOM_MODEL_ID,
  isModelSelectable,
  MODEL_IDS,
  readStoredModel,
  storeModel
} from "@/theme/theme-preferences.js";
import { SettingsDrawer } from "../SettingsDrawer.js";

const EASY = JSON.parse(
  readFileSync(new URL("../i18n/locales/de-x-ls.json", import.meta.url), "utf8")
) as Record<string, string>;

const KEYS = [
  "modelCustom",
  "modelCustomSetup",
  "modelCustomSetupLink",
  "policyStatusOperator",
  "policyCustom"
];

function render(
  props: { activeModel?: string; customEndpointConfigured?: boolean },
  language: "de" | "en" = "de"
): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { defaultLanguage: language } as ThemeProviderProps,
      createElement(SettingsDrawer, { isOpen: true, onClose: () => {}, ...props })
    )
  );
}

describe("Modellauswahl: Eigener Endpunkt (F249)", () => {
  it("führt custom als wählbares Modell und speichert die Wahl", () => {
    expect(CUSTOM_MODEL_ID).toBe("custom");
    expect(MODEL_IDS).toContain("custom");
    const values: Record<string, string> = {};
    const store = {
      getItem: (k: string) => values[k] ?? null,
      setItem: (k: string, v: string) => {
        values[k] = v;
      }
    };
    storeModel(store, "custom");
    expect(readStoredModel(store)).toBe("custom");
  });

  it("ist nur mit eingerichtetem Endpunkt wählbar", () => {
    expect(isModelSelectable("custom", false)).toBe(false);
    expect(isModelSelectable("custom", true)).toBe(true);
    expect(isModelSelectable("gemini-2.5-flash", false)).toBe(true);
  });

  it("hat Texte in Deutsch, Englisch und Leichter Sprache", () => {
    for (const key of KEYS) {
      expect(TRANSLATIONS.de[key], `de.${key}`).toBeTruthy();
      expect(TRANSLATIONS.en[key], `en.${key}`).toBeTruthy();
      expect(EASY[key], `de-x-ls.${key}`).toBeTruthy();
    }
    expect(STATUS_KEYS.operator).toBe("policyStatusOperator");
  });

  it("nennt beim Datenschutz den Betreiber des Endpunkts statt einer Anbieterquelle", () => {
    const policy = policyFor("custom");
    expect(policy).toBe(MODEL_DATA_POLICIES.custom);
    expect(policy).toMatchObject({ status: "operator", connection: "connected", sources: [] });
  });

  it("ohne Endpunkt: Option deaktiviert, Hinweis mit Link zum Abschnitt", () => {
    const html = render({ activeModel: "gemini-2.5-flash" });
    expect(html).toContain(
      '<option value="custom" disabled="">Eigener Endpunkt (OpenAI-kompatibel)</option>'
    );
    expect(html).toContain('id="settings-model-custom-hint"');
    expect(html).toContain('href="#custom-endpoint-title"');
    expect(html).toContain(
      'aria-describedby="settings-model-hint settings-model-custom-hint settings-model-policy"'
    );
  });

  it("mit Endpunkt: Option wählbar, kein Einrichtungshinweis, Datenschutz zum Betreiber", () => {
    const html = render({ activeModel: "custom", customEndpointConfigured: true });
    expect(html).toContain(
      '<option value="custom" selected="">Eigener Endpunkt (OpenAI-kompatibel)</option>'
    );
    expect(html).not.toContain('id="settings-model-custom-hint"');
    expect(html).toContain('data-status="operator"');
    expect(html).toContain("Hängt vom Betreiber des Endpunkts ab");
    expect(html).not.toContain("rn-model-policy-sources");
    expect(html).toContain('aria-describedby="settings-model-hint settings-model-policy"');
  });

  it("übersetzt Option und Hinweis ins Englische", () => {
    const html = render({ activeModel: "gemini-2.5-flash" }, "en");
    expect(html).toContain(">Own endpoint (OpenAI-compatible)</option>");
    expect(html).toContain("Set up your own endpoint");
  });
});
