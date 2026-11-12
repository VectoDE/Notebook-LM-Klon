import { type Locator, type Page, expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/**
 * Issue #329: Chat-Blasen mit Zitat-Pillen, Studio gemischt, Dialoge (unter 600 px Vollbild,
 * sonst zentriert), Umschalter mit gespeicherter Wahl, Leerzustände und Hinweis-Leiste.
 */

const WIDTHS = [390, 1440] as const;

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("kein Rahmen");
  return box;
}

/** Unter 600 px füllt der Dialog den Viewport, sonst liegt er mittig mit Rand. */
async function expectDialogLayout(page: Page, surface: Locator, width: number): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("kein Viewport");
  // Erst messen, wenn die Einblendung fertig ist
  // (nur die Einblendung der Fläche selbst; laufende Inhalte wie die Bühne zählen nicht)
  await surface.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = await boxOf(surface);
  if (width < 600) {
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(viewport.width, 0);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
  } else {
    const left = box.x;
    const right = viewport.width - box.x - box.width;
    expect(left).toBeGreaterThanOrEqual(23);
    expect(Math.abs(left - right)).toBeLessThan(2);
    const top = box.y;
    const bottom = viewport.height - box.y - box.height;
    expect(top).toBeGreaterThanOrEqual(23);
    expect(Math.abs(top - bottom)).toBeLessThan(2);
  }
}

async function chatWithCitation(page: Page): Promise<void> {
  const sse = [
    'event: token\ndata: {"delta":"D1 nutzt FTS5 [1]."}\n\n',
    'event: citations\ndata: {"citations":[{"index":1,"sourceId":"src_2","quote":"FTS5 tables with BM25 ranking"}]}\n\n',
    "event: done\ndata: {}\n\n"
  ].join("");
  await page.route("**/api/v1/notebooks/*/chat", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sse })
  );
}

for (const width of WIDTHS) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test("Dialoge: URL, Teilen, Einstellungen, Bühne und Zwischenfrage", async ({ page }) => {
      await page.goto("/");

      // URL-Dialog
      await openPanel(page, "sources");
      const urlTrigger = page.getByTestId("btn-open-url-dialog");
      await urlTrigger.click();
      const urlDialog = page.getByTestId("url-import-dialog");
      await expectDialogLayout(page, urlDialog.locator(".rn-dialog-card"), width);
      await page.keyboard.press("Escape");
      await expect(urlDialog).toHaveCount(0);
      await expect(urlTrigger).toBeFocused();

      // Teilen
      if (width < 600) {
        await page.getByTestId("btn-open-menu").click();
        await page.getByTestId("sheet-open-share").click();
      } else {
        await page.getByTestId("btn-open-share").click();
      }
      const share = page.getByTestId("share-dialog");
      await expectDialogLayout(page, share.locator(".rn-dialog-card"), width);
      await page.keyboard.press("Escape");
      await expect(share).toBeHidden();

      // Einstellungen
      if (width < 600) {
        await page.getByTestId("btn-open-menu").click();
        await page.getByTestId("sheet-open-settings").click();
      } else {
        await page.getByTestId("btn-open-settings").click();
      }
      const drawer = page.getByTestId("settings-drawer");
      await expect(drawer).toBeVisible();
      await expectDialogLayout(page, drawer, width);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();

      // Bühne
      await openPanel(page, "studio");
      const stageTrigger = page.getByTestId("btn-open-deep-dive-stage");
      await stageTrigger.click();
      const stage = page.getByTestId("deep-dive-stage");
      await expect(stage).toBeVisible();
      await expectDialogLayout(page, stage, width);
      await page.keyboard.press("Escape");
      await expect(stage).toHaveCount(0);
      await expect(stageTrigger).toBeFocused();

      // Zwischenfrage: modal, Fokus im Feld, Tab bleibt drin, Esc gibt den Fokus zurück
      await page.getByTestId("btn-open-audio-tool").click();
      const join = page.getByTestId("btn-audio-interject");
      await join.click();
      const interject = page.getByTestId("interject-dialog");
      await expect(interject).toBeVisible();
      await expect(page.locator("#interject-question-input")).toBeFocused();
      expect(await interject.evaluate((el) => el.matches(":modal"))).toBe(true);
      await expectDialogLayout(page, interject, width);
      for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await interject.evaluate((el) => el.contains(document.activeElement)), key).toBe(
          true
        );
      }
      await page.keyboard.press("Escape");
      await expect(interject).toHaveCount(0);
      await expect(join).toBeFocused();
    });

    test("Quellen: Liste oder Karten, Wahl bleibt nach dem Neuladen", async ({ page }) => {
      await page.goto("/");
      await openPanel(page, "sources");
      const list = page.getByTestId("sources-panel").locator("ul.rn-sources");
      await expect(list).toHaveAttribute("data-view", "list");
      await page.getByTestId("sources-view-toggle-cards").check({ force: true });
      await expect(list).toHaveAttribute("data-view", "cards");
      // In der schmalen Quellenspalte einspaltig, Titel ungekürzt (Issue #335)
      const cards = await list.locator(":scope > li").evaluateAll((items) =>
        items.map((el) => {
          const r = el.getBoundingClientRect();
          const title = el.querySelector(".rn-source-title") as HTMLElement;
          return {
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            listWidth: (el.parentElement as HTMLElement).clientWidth,
            titleCut:
              title.scrollHeight > title.clientHeight + 1 ||
              title.scrollWidth > title.clientWidth + 1
          };
        })
      );
      expect(cards.length).toBeGreaterThan(1);
      for (const [i, card] of cards.entries()) {
        expect(card.width).toBeGreaterThan(card.listWidth - 2);
        expect(card.titleCut).toBe(false);
        if (i > 0) expect(card.top).toBeGreaterThanOrEqual(cards[i - 1]?.bottom ?? 0);
      }

      // Vorschau öffnen: die Liste wird nicht gestaucht, jede Karte bleibt ganz sichtbar hoch
      const visibleHeights = () =>
        list.evaluate((el) => {
          const items = [...el.children].map((li) => li.getBoundingClientRect().height);
          // Gestaucht hieße: die Liste ist niedriger als ihre Karten und schneidet sie ab
          return { items, clipped: el.scrollHeight > el.clientHeight + 1 };
        });
      const before = await visibleHeights();
      await list.locator("[data-testid^='btn-inspect-source-']").first().click();
      await expect(page.getByTestId("source-inspector-drawer")).toBeInViewport();
      const after = await visibleHeights();
      expect(after.clipped).toBe(false);
      expect(after.items.length).toBe(before.items.length);
      for (const [i, h] of after.items.entries()) {
        expect(h).toBeCloseTo(before.items[i] ?? 0, 0);
      }
      await page.getByTestId("btn-close-inspector").click();

      await page.reload();
      await openPanel(page, "sources");
      await expect(page.getByTestId("sources-view-toggle-cards")).toBeChecked();
      await expect(list).toHaveAttribute("data-view", "cards");

      // Tastatur: Pfeiltaste wechselt zurück auf die Liste
      await page.getByTestId("sources-view-toggle-cards").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(list).toHaveAttribute("data-view", "list");
      const stored = await page.evaluate(() => localStorage.getItem("rn_sources_view"));
      expect(stored).toBe("list");
    });

    test("Leerzustände: Filter ohne Treffer und Studio ohne Auswahl", async ({ page }) => {
      await page.goto("/");
      await openPanel(page, "sources");
      const filter = page.getByTestId("sources-filter-input");
      await filter.fill("zzz");
      const empty = page.getByTestId("no-sources-message");
      await expect(empty).toContainText("Kein Treffer");
      await expect(empty.locator("svg.rn-empty-art")).toHaveAttribute("aria-hidden", "true");
      await page.getByTestId("btn-clear-sources-filter").click();
      await expect(filter).toHaveValue("");
      await expect(filter).toBeFocused();

      await page.getByTestId("select-all-sources-checkbox").uncheck();
      await openPanel(page, "studio");
      const studioEmpty = page.getByTestId("studio-empty-state");
      await expect(studioEmpty).toBeVisible();
      await expect(studioEmpty.locator("svg")).toHaveAttribute("aria-hidden", "true");
    });

    test("Quiz-Auswertung: Tabelle oder Karten, Wahl bleibt erhalten", async ({ page }) => {
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-quiz-tool").click();
      const panel = page.getByTestId("studio-panel");
      await panel.locator(".rn-quiz-option").first().click();
      await panel.getByRole("button", { name: "Weiter" }).click();
      await panel.locator(".rn-quiz-option").nth(2).click();
      await panel.getByRole("button", { name: /abschließen/ }).click();

      const expected = width < 600 ? "cards" : "table";
      const other = expected === "cards" ? "table" : "cards";
      await expect(page.getByTestId(`quiz-results-${expected}`)).toBeVisible();
      await page.getByTestId(`quiz-results-view-toggle-${other}`).check({ force: true });
      await expect(page.getByTestId(`quiz-results-${other}`)).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("rn_quiz_results_view"))).toBe(other);
      // Kein horizontales Scrollen, auch nicht in der Tabelle
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      expect(overflow).toBe(false);
    });

    test("Chat: Blasen, Pille mit Namen, breiter als hoch, mindestens 24 px", async ({ page }) => {
      await chatWithCitation(page);
      await page.goto("/");
      await openPanel(page, "chat");
      // Begrüßung statt Leerzustand: nie beides zugleich (Issue #335)
      await expect(page.locator(".rn-msg--assistant").first()).toBeVisible();
      await expect(page.getByTestId("chat-empty-state")).toHaveCount(0);
      await page.getByTestId("chat-input-field").fill("Welche Suche?");
      await page.getByTestId("chat-input-field").press("Enter");
      const pill = page.getByTestId("citation-pill-1").last();
      await expect(pill).toBeVisible();
      await expect(page.getByTestId("chat-empty-state")).toHaveCount(0);
      await expect(pill).toHaveAccessibleName(/1/);
      const size = await boxOf(pill);
      expect(size.height).toBeGreaterThanOrEqual(24);
      expect(size.width).toBeGreaterThanOrEqual(24);
      // Pille statt Kreis: breiter als hoch (Issue #335)
      expect(size.width).toBeGreaterThan(size.height);
      // Frage und Antwort stehen in Blasen mit eigenem Hintergrund
      const bubbles = await page
        .locator(".rn-msg--user .rn-msg-body, .rn-msg--user, .rn-msg--assistant")
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      expect(bubbles.some((bg) => bg !== "rgba(0, 0, 0, 0)")).toBe(true);
    });
  });
}

test.describe("Hinweis-Leiste", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("role=status, Schließen, Pause bei Zeiger, verschwindet nach rund 5 s", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    const region = page.getByTestId("toast-region");
    await expect(region).toHaveRole("status");
    await expect(region).toBeEmpty();

    await page.getByTestId("btn-open-url-dialog").click();
    await page.getByTestId("url-address-input").fill("https://example.org/bericht");
    await page.getByTestId("btn-submit-url-dialog").click();
    const toast = page.getByTestId("toast");
    await expect(page.getByTestId("toast-text")).toContainText("Quelle hinzugefügt");

    // Zeiger auf der Leiste hält die Zeit an
    await toast.hover();
    await page.clock.runFor(8000);
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 5);
    await page.clock.runFor(4000);
    await expect(toast).toBeVisible();
    await page.clock.runFor(1500);
    await expect(toast).toHaveCount(0);

    // Neuer Hinweis, per Knopf schließen
    await page.getByTestId("btn-open-url-dialog").click();
    await page.getByTestId("url-address-input").fill("https://example.org/zweiter");
    await page.getByTestId("btn-submit-url-dialog").click();
    const close = page.getByTestId("btn-close-toast");
    await expect(close).toHaveAccessibleName("Hinweis schließen");
    const size = await boxOf(close);
    expect(size.height).toBeGreaterThanOrEqual(43.5);
    await close.click();
    await expect(toast).toHaveCount(0);
  });

  test("reduzierte Bewegung: keine Animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByTestId("btn-open-url-dialog").click();
    await page.getByTestId("url-address-input").fill("https://example.org/bericht");
    await page.getByTestId("btn-submit-url-dialog").click();
    const name = await page
      .getByTestId("toast")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe("none");
  });

  test("englische Oberfläche: Hinweise und Leerzustände ohne deutschen Rest", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    await expect(page.getByTestId("chat-empty-state")).toHaveCount(0);
    await page.getByTestId("btn-open-url-dialog").click();
    await page.getByTestId("url-address-input").fill("https://example.org/report");
    await page.getByTestId("btn-submit-url-dialog").click();
    await expect(page.getByTestId("toast-text")).toContainText("Source added");
    await expect(page.getByTestId("btn-close-toast")).toHaveAccessibleName("Dismiss notice");
    await expect(page.getByTestId("sources-view-toggle")).toContainText("List");
    await expect(page.getByTestId("sources-view-toggle")).toContainText("Cards");
    await page.getByTestId("sources-filter-input").fill("zzz");
    await expect(page.getByTestId("no-sources-message")).toContainText("No match");
    const german = /\b(Quelle|Keine|Noch|Treffer|Ansicht|Liste|Karten|schließen)\b/;
    for (const id of ["toast-region", "no-sources-message", "sources-view-toggle"]) {
      expect(await page.getByTestId(id).innerText(), id).not.toMatch(german);
    }
  });
});
