import { expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/**
 * Bedienung per Tippen auf Touch-Geräten, Telefon und Tablet in Hoch- und Querformat
 * (Issue #255). Je nach Breite gibt es eine untere Leiste (unter 600 px), Reiter unter dem
 * Kopf (600 bis 899 px) oder alle Spalten nebeneinander (ab 900 px, Issue #325).
 */

test.describe("Touch", () => {
  test("Tippen wechselt den Bereich, Bedienziele mindestens 44 px", async ({ page }) => {
    await page.goto("/");

    const bottom = page.getByTestId("mobile-bottom-nav");
    const topTabs = page.getByTestId("top-tab-sources");
    if (await bottom.isVisible()) {
      for (const tab of ["sources", "studio", "chat"] as const) {
        await page.getByTestId(`tab-btn-${tab}`).tap();
        await expect(page.getByTestId(`tab-btn-${tab}`)).toHaveAttribute("aria-current", "true");
        await expect(page.locator(`[data-panel='${tab}']`)).toBeVisible();
      }
    } else if (await topTabs.isVisible()) {
      for (const tab of ["sources", "studio", "chat"] as const) {
        await page.getByTestId(`top-tab-${tab}`).tap();
        await expect(page.locator(`[data-panel='${tab}']`)).toBeVisible();
      }
    } else {
      // Ab 900 px sind die Spalten die Navigation; der Sprunglink klappt sie bei Bedarf aus.
      for (const tab of ["sources", "studio", "chat"] as const) {
        await openPanel(page, tab);
        await expect(page.locator(`[data-panel='${tab}']`)).toBeVisible();
      }
    }

    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          "[data-testid='workspace-header'] button, [data-testid='mobile-bottom-nav'] button, [data-testid^='top-tab-']"
        )
      )
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 1 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${el.getAttribute("data-testid")}: ${r.width}x${r.height}`)
    );
    expect(small).toEqual([]);

    // Menü per Tippen öffnen (nur wo es das Menü-Sheet gibt) und mit Escape schließen
    const menu = page.getByTestId("btn-open-menu");
    if (await menu.isVisible()) {
      await menu.tap();
      await expect(page.getByTestId("nav-sheet")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("nav-sheet")).toBeHidden();
    } else {
      await page.getByTestId("btn-open-appearance").tap();
      await expect(page.getByTestId("appearance-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("appearance-menu")).toBeHidden();
    }
  });
});
