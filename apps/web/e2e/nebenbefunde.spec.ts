import { expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/**
 * Issue #311: „Beitreten / Frage stellen“ im Zustand „Bereit“ und hängender Einzug der Baumliste.
 */

test.describe("Audio: Frage stellen im Zustand „Bereit“", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("startet die Wiedergabe und öffnet sofort die Zwischenfrage", async ({ page }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-audio-tool").click();
    const badge = page.getByTestId("audio-state-badge");
    await expect(badge).toHaveText("Status: Bereit");

    await page.getByTestId("btn-audio-interject").click();
    await expect(page.getByTestId("interject-dialog")).toBeVisible();
    await expect(page.locator("#interject-question-input")).toBeFocused();
    await expect(badge).not.toHaveText("Status: Bereit");
  });

  test("Abbrechen führt zurück in die laufende Wiedergabe, Fokus zurück auf den Knopf", async ({
    page
  }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-audio-tool").click();
    const trigger = page.getByTestId("btn-audio-interject");
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("interject-dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId("audio-state-badge")).not.toHaveText("Status: Bereit");
    await expect(page.locator(".btn-play-pause")).toHaveText("Pausieren");
  });
});

test.describe("Mindmap-Baumliste: hängender Einzug", () => {
  for (const width of [360, 390, 1440]) {
    test(`Umbruch bleibt bündig zum Textanfang (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-mindmap-tool").click();
      await page.getByRole("tab", { name: /Baumliste/ }).click();

      const item = page.locator(".rn-tree-item", { hasText: "NotebookDO (In-Memory Vectors)" });
      await expect(item).toBeVisible();
      const geometry = await item.evaluate((el) => {
        const marker = el.querySelector(".rn-tree-marker") as HTMLElement;
        const text = el.querySelector(".rn-tree-text") as HTMLElement;
        const strong = el.querySelector("strong") as HTMLElement;
        const lefts = [...strong.getClientRects()].map((r) => Math.round(r.left * 10) / 10);
        return {
          markerRight: marker.getBoundingClientRect().right,
          textLeft: text.getBoundingClientRect().left,
          lineLefts: lefts,
          docWidth: document.documentElement.scrollWidth
        };
      });
      // Text beginnt rechts vom Punkt, jede Zeile (auch Folgezeilen) bündig zum Textanfang
      expect(geometry.textLeft).toBeGreaterThan(geometry.markerRight);
      for (const left of geometry.lineLefts) {
        expect(left).toBeGreaterThanOrEqual(geometry.textLeft - 0.5);
      }
      expect(geometry.docWidth).toBeLessThanOrEqual(width);
      // Klickziel bleibt mindestens 44 px hoch
      const box = await item.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
    });
  }
});
