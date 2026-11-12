import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, findLayoutProblems, openPanel } from "./helpers";

/**
 * Barrierefreiheit Runde 3 (Issue #323): sichtbarer Audio-Fehler, eigene Meldung im
 * URL-Dialog, Sprachauszeichnung, Scrollen bei reduzierter Bewegung, Fokus auf benannte
 * Regionen und kompakter Kopf bei geringer Höhe.
 */

const INTERJECT = "**/api/v1/notebooks/*/audio-interject";

const ANSWER = {
  notebookId: "nb_active",
  question: "Was ist D1?",
  currentTimeMs: 0,
  turns: [{ speaker: "host1", speakerName: "Alex", text: "D1 ist die SQLite-Datenbank." }],
  fullAnswer: "D1 ist die SQLite-Datenbank.",
  citations: [],
  speechSynthesis: { mode: "dialogue", estimatedDurationMs: 1000, cues: [] },
  aiMetadata: {
    aiGenerated: true,
    provider: "test",
    model: "test",
    latencyMs: 1,
    timestamp: "2026-01-01T00:00:00.000Z"
  }
};

async function askHosts(page: Page, question = "Was ist D1?"): Promise<void> {
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-audio-tool").click();
  await page.getByTestId("btn-audio-interject").click();
  await page.locator("#interject-question-input").fill(question);
  await page.locator("#interject-question-input").press("Enter");
}

test.describe("Audio-Player: Fehler sichtbar (#323 A1)", () => {
  for (const width of [1440, 390]) {
    test(`${width} px: Fehlerkasten, Plakette und Erneut versuchen`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      let calls = 0;
      await page.route(INTERJECT, (route) => {
        calls++;
        return calls === 1
          ? route.fulfill({ status: 404, body: "" })
          : route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(ANSWER)
            });
      });
      await page.goto("/");
      await askHosts(page);

      const alert = page.getByTestId("audio-error");
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute("role", "alert");
      await expect(alert).toContainText("Die Hosts konnten nicht antworten.");
      await expect(page.getByTestId("audio-error-detail")).toHaveText(
        /Technische Angabe: HTTP 404/
      );
      await expect(page.getByTestId("audio-state-badge")).toHaveText("Status: Fehler");
      await expect(page.getByTestId("a11y-live-status")).toHaveText("Status: Fehler");
      const retry = page.getByTestId("btn-retry-audio");
      await expect(retry).toBeFocused();
      const box = await retry.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      expect(await findLayoutProblems(page)).toEqual([]);

      // Erneut versuchen stellt dieselbe Frage noch einmal
      await retry.press("Enter");
      await expect(page.getByTestId("host-answer-stage")).toBeVisible();
      await expect(page.getByTestId("audio-error")).toHaveCount(0);
      await expect(page.getByTestId("audio-state-badge")).not.toHaveText("Status: Fehler");
      expect(calls).toBe(2);
    });
  }

  test("Englisch: Texte aus dem Katalog", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(INTERJECT, (route) => route.abort("failed"));
    await page.goto("/");
    await askHosts(page, "What is D1?");
    await expect(page.getByTestId("audio-error")).toContainText("The hosts could not answer.");
    await expect(page.getByTestId("audio-state-badge")).toHaveText("Status: Error");
    await expect(page.getByTestId("btn-retry-audio")).toHaveText("Try again");
  });

  test("Abspielen räumt den Fehler weg", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route(INTERJECT, (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto("/");
    await askHosts(page);
    await expect(page.getByTestId("audio-error")).toBeVisible();
    await page.locator(".btn-play-pause").click();
    await expect(page.getByTestId("audio-error")).toHaveCount(0);
  });
});

test.describe("URL-Dialog: eigene Fehlermeldung (#323 A3)", () => {
  for (const width of [1440, 390]) {
    test(`${width} px: aria-invalid, aria-describedby, Fokus bleibt im Feld`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      await page.goto("/");
      await openPanel(page, "sources");
      await page.getByTestId("btn-open-url-dialog").click();
      const input = page.getByTestId("url-address-input");
      await expect(input).toBeFocused();
      await expect(input).not.toHaveAttribute("aria-invalid", "true");

      // Leer absenden
      await page.getByTestId("btn-submit-url-dialog").click();
      const error = page.getByTestId("url-address-error");
      await expect(error).toHaveText("Bitte geben Sie eine URL ein.");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();
      const describedBy = await input.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/URL/);
      await expect(input).toHaveAccessibleDescription("Bitte geben Sie eine URL ein.");

      // Ungültige Adresse: Meldung nennt das erwartete Format
      await input.fill("kein link");
      await input.press("Enter");
      await expect(error).toContainText("https://");
      await expect(input).toBeFocused();
      // Die native Prüfung greift nicht (noValidate), der Dialog bleibt offen
      expect(await input.evaluate((el) => (el as HTMLInputElement).form?.noValidate)).toBe(true);
      await expect(page.getByTestId("url-import-dialog")).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);

      // Korrektur: Meldung verschwindet, Import gelingt
      await input.fill("https://example.org/artikel");
      await expect(error).toHaveCount(0);
      await expect(input).not.toHaveAttribute("aria-invalid", "true");
      await page.getByTestId("btn-submit-url-dialog").click();
      await expect(page.getByTestId("url-import-dialog")).toHaveCount(0);
      await expect(page.getByTestId("sources-list")).toContainText("https://example.org/artikel");
    });
  }

  test("Englisch und erneutes Öffnen ohne alte Meldung", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("btn-open-url-dialog").click();
    await page.getByTestId("url-address-input").fill("example");
    await page.getByTestId("btn-submit-url-dialog").click();
    await expect(page.getByTestId("url-address-error")).toContainText(
      "This address is not a valid URL"
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("btn-open-url-dialog").click();
    await expect(page.getByTestId("url-address-error")).toHaveCount(0);
  });
});

test.describe("Sprachauszeichnung (#323 A2/N14)", () => {
  test("Deutsch: englische Quellentitel und Volltexte tragen lang=en", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator(".rn-source-title").first()).toHaveAttribute("lang", "en");
    await page.getByTestId("btn-inspect-source-src_1").click();
    await expect(page.getByTestId("inspector-source-content")).toHaveAttribute("lang", "en");
    await page.getByTestId("btn-open-mindmap-tool").click();
    await expect(page.locator(".rn-tree-text").first()).toHaveAttribute("lang", "en");
  });

  test("Englisch: deutsche Inhalte tragen lang=de, Bedientexte sind englisch", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".rn-summary-text")).toHaveAttribute("lang", "de");
    await page.getByTestId("btn-open-flashcards-tool").click();
    await expect(page.locator(".rn-flashcard-text")).toHaveAttribute("lang", "de");
    await page.getByRole("button", { name: /All tools|Alle Werkzeuge/ }).click();
    await page.getByTestId("btn-open-quiz-tool").click();
    await expect(page.locator(".rn-quiz-question")).toHaveAttribute("lang", "de");

    // Kein deutscher Text ohne lang=de auf der englischen Oberfläche
    const untagged = await page.evaluate(() => {
      const de =
        /\b(Quellen|Datei|hochladen|auswählen|Frage|Werkzeuge|Vorlesen|Zusammenfassung|Welcher|Was|Dieses|wird|und|der|die|das)\b/u;
      const hits: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        const text = n.textContent?.trim() ?? "";
        if (!el || !text || !el.checkVisibility()) continue;
        if (el.closest("[lang]")?.getAttribute("lang")?.startsWith("en") && de.test(text)) {
          hits.push(text.slice(0, 60));
        }
      }
      return hits;
    });
    expect(untagged).toEqual([]);
  });
});

test.describe("Zitat-Sprung bei reduzierter Bewegung (#323 A4)", () => {
  for (const reduce of [true, false]) {
    test(`reducedMotion=${reduce}: scrollIntoView ${reduce ? "ohne" : "mit"} Animation`, async ({
      page
    }) => {
      await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        const calls: string[] = [];
        (window as unknown as { __scrolls: string[] }).__scrolls = calls;
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
          if (this.getAttribute("data-testid") === "highlighted-citation-passage") {
            calls.push(typeof arg === "object" ? String(arg.behavior) : String(arg));
          }
          return original.call(this, arg);
        };
      });
      const sse = [
        'event: token\ndata: {"delta":"BM25 sortiert die Treffer [1]."}\n\n',
        'event: citations\ndata: {"citations":[{"index":1,"sourceId":"src_2","quote":"FTS5 tables with BM25 ranking"}]}\n\n',
        "event: done\ndata: {}\n\n"
      ].join("");
      await page.route("**/api/v1/notebooks/*/chat", (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: sse })
      );
      await page.goto("/");
      await page.getByTestId("chat-input-field").fill("Wie wird sortiert?");
      await page.getByTestId("chat-input-field").press("Enter");
      // Erst klicken, wenn die Antwort mit ihrer Zitat-Pille da ist (sonst trifft last() die
      // Pille der Begrüßung, die auf eine andere Quelle zeigt)
      await expect(page.getByTestId("citation-pill-1")).toHaveCount(2);
      await page.getByTestId("citation-pill-1").last().click();
      await expect(page.getByTestId("highlighted-citation-passage")).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls))
        .toEqual([reduce ? "auto" : "smooth"]);
    });
  }
});

test.describe("Fokus der Navigation auf benannte Regionen (#323 A5)", () => {
  test("1440 px: Sprunglinks fokussieren die Region mit Namen und Fokusring", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const names = {
      sources: "Quellen-Panel",
      chat: "Wissens- und Chat-Panel",
      studio: "Studio-Panel"
    };
    // Ab 900 px gibt es keine Reiter mehr (Issue #325), die Sprunglinks führen in die Spalten
    for (const [tab, name] of Object.entries(names)) {
      await page.getByTestId(`skip-link-${tab}`).focus();
      await page.keyboard.press("Enter");
      const region = page.getByRole("region", { name, exact: true });
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute("data-panel", tab);
      await expect(region).not.toHaveAttribute("data-flash", /.*/);
    }
    // Die Layout-Wrapper sind keine Fokusziele mehr
    await expect(page.getByTestId("panel-left-wrapper")).not.toHaveAttribute("tabindex", /.*/);
  });

  test("390 px: untere Leiste fokussiert die Region", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByTestId("tab-btn-studio").click();
    await expect(page.getByRole("region", { name: "Studio-Panel", exact: true })).toBeFocused();
  });
});

test.describe("Geringe Höhe (#323 A6)", () => {
  async function measure(page: Page) {
    return page.evaluate(() => {
      const box = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el || getComputedStyle(el).display === "none") return { top: 0, height: 0 };
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      };
      return {
        header: box("workspace-header"),
        main: box("workspace-3panel-container"),
        nav: box("mobile-bottom-nav"),
        scroll: document.documentElement.scrollHeight - innerHeight
      };
    });
  }

  for (const design of DESIGNS) {
    test(`${design}, 320 x 256: Kopf und Leiste kompakt, nichts überdeckt`, async ({ page }) => {
      await page.addInitScript((d) => localStorage.setItem("rn_design", d), design);
      await page.setViewportSize({ width: 320, height: 256 });
      await page.goto("/");
      const m = await measure(page);
      expect(m.header.height).toBeLessThanOrEqual(50);
      expect(m.nav.height).toBeLessThanOrEqual(53);
      // Vorher 123 px Arbeitsfläche (52 % für Kopf und Leiste)
      expect(m.main.height).toBeGreaterThanOrEqual(150);
      // Fest am Platz: Arbeitsfläche endet an der Leiste, die Seite scrollt nicht
      expect(m.main.top + m.main.height).toBeLessThanOrEqual(m.nav.top + 1);
      expect(m.scroll).toBeLessThanOrEqual(0);
      for (const tab of ["sources", "chat", "studio"] as const) {
        const button = page.getByTestId(`tab-btn-${tab}`);
        expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(43.5);
        await button.click();
        expect(await findLayoutProblems(page)).toEqual([]);
      }
      await expect(page.getByTestId("btn-open-menu")).toBeVisible();
    });
  }

  test("normale Höhen bleiben unverändert", async ({ page }) => {
    for (const [width, height, header, nav] of [
      [390, 844, 61, 72],
      [1440, 900, 64, 0]
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const m = await measure(page);
      expect(m.header.height, `${width}x${height}`).toBe(header);
      expect(m.nav.height, `${width}x${height}`).toBe(nav);
    }
  });
});
