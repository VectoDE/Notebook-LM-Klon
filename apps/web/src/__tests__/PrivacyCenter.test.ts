import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalFooter, PrivacyCenter } from "../PrivacyCenter.js";
import { CONSENT_STORAGE_KEY, CONSENT_VERSION } from "../consent.js";
import { privacyTexts } from "../privacy-texts.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

function storageWith(value: string | null): Storage {
  return {
    getItem: (key: string) => (key === CONSENT_STORAGE_KEY ? value : null),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0
  };
}

function render(
  optionalServicesConfigured: boolean,
  stored: string | null,
  language?: "de" | "en"
): string {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { defaultLanguage: language } as ThemeProviderProps,
      createElement(PrivacyCenter, { optionalServicesConfigured, storage: storageWith(stored) })
    )
  );
}

const CHOICE_PATTERN =
  /<button type="button" class="([^"]+)"[^>]*data-testid="consent-(accept-all|necessary-only|customize)"[^>]*>([^<]+)</g;

describe("Einwilligungsbanner (Issue #261)", () => {
  it("zeigt drei gleichwertige Knöpfe in fester Reihenfolge, wenn eine Entscheidung fehlt", () => {
    const html = render(true, null);
    expect(html).toContain('data-testid="consent-banner"');
    expect(html).toMatch(/<section[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);

    const buttons = [...html.matchAll(CHOICE_PATTERN)];
    expect(buttons.map((m) => m[2])).toEqual(["accept-all", "necessary-only", "customize"]);
    expect(new Set(buttons.map((m) => m[1]))).toEqual(new Set(["rn-btn rn-consent-choice"]));
    expect(buttons.map((m) => m[3])).toEqual(["Alle akzeptieren", "Nur notwendige", "Anpassen"]);
    // keine Hervorhebung: keine primäre Variante, kein Autofokus
    expect(html).not.toContain("rn-btn--primary");
    expect(html).not.toContain("autofocus");
  });

  it("zeigt kein Banner ohne optionalen Dienst oder nach getroffener Entscheidung", () => {
    const decided = JSON.stringify({
      version: CONSENT_VERSION,
      analytics: false,
      decidedAt: "2026-11-13T00:00:00.000Z"
    });
    expect(render(false, null)).not.toContain("consent-banner");
    expect(render(true, decided)).not.toContain("consent-banner");
    // Statusmeldung für Screenreader ist immer vorhanden
    expect(render(false, null)).toContain('aria-live="polite"');
  });

  it("spricht Englisch, wenn die Oberfläche englisch ist", () => {
    const html = render(true, null, "en");
    expect([...html.matchAll(CHOICE_PATTERN)].map((m) => m[3])).toEqual([
      "Accept all",
      "Necessary only",
      "Customize"
    ]);
  });
});

describe("Fußzeile mit Widerruf (Issue #261)", () => {
  it("bietet Datenschutz und Cookie-Einstellungen als Knöpfe", () => {
    const html = renderToStaticMarkup(createElement(LegalFooter));
    expect(html).toContain('<footer class="rn-legal-footer" aria-label="Rechtliches"');
    expect(html).toContain('data-testid="footer-privacy"');
    expect(html).toContain('data-testid="footer-cookie-settings"');
    expect(html).toContain("Cookie-Einstellungen");
  });
});

describe("Datenschutztexte (Issues #258, #259, #261, #262)", () => {
  it("haben in Deutsch und Englisch dieselbe Struktur und keine leeren Texte", () => {
    const de = privacyTexts("de");
    const en = privacyTexts("en");
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    expect(en.noticeSections.length).toBe(de.noticeSections.length);
    for (const texts of [de, en]) {
      for (const [key, value] of Object.entries(texts)) {
        if (typeof value === "string") expect(value.trim().length, key).toBeGreaterThan(0);
      }
      for (const section of texts.noticeSections) {
        expect(section.heading.length).toBeGreaterThan(0);
        expect(section.body.length).toBeGreaterThan(0);
      }
    }
  });

  it("nennen Löschfrist, Audit-Frist und die cookielose Zählung", () => {
    const all = JSON.stringify(privacyTexts("de"));
    expect(all).toContain("30 Tage");
    expect(all).toContain("90 Tagen");
    expect(all).toContain("Kein Cookie, keine IP-Adresse");
  });
});
