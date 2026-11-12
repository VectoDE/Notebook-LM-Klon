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
