import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers";

/**
 * Einstellungen einheitlich und verständlich (Issue #299): gleiche Namen an allen Stellen,
 * Abschnittstitel in Satzschreibung, Hinweise, BYOK in Vorbereitung, einheitliche
 * Schließen-Knöpfe und Farbmodus "Automatisch (wie Gerät)".
 */

const MODE_NAMES = ["Automatisch (wie Gerät)", "Hell", "Dunkel", "Hoher Kontrast (AAA)"];

async function openSettings(page: Page, width: number) {
  if (width < 600) {
    await page.getByTestId("btn-open-menu").click();
    await page.getByTestId("sheet-open-settings").click();
  } else {
    await page.getByTestId("btn-open-settings").click();
  }
  const drawer = page.getByTestId("settings-drawer");
  await expect(drawer).toBeVisible();
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return drawer;
}

/** Sichtbare Namen der Farbmodi in einem Container. */
function modeNames(page: Page, container: string) {
  return page
    .getByTestId(container)
    .locator(".rn-segment:has([data-testid^='mode-option-'])")
    .allInnerTexts();
}

for (const width of [390, 1440]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
    });

    test("Einstellungen: Titel, Abschnitte, Hinweise und BYOK", async ({ page }) => {
      const drawer = await openSettings(page, width);
      await expect(page.getByRole("dialog", { name: "Einstellungen" })).toBeVisible();
      await expect(drawer).not.toContainText("Arbeitsbereich");
      await expect(drawer).not.toContainText("Compliance");

      // Abschnittstitel: Satzschreibung, gleiche Größe und Stärke
      const titles = await drawer.locator(".rn-drawer-section-title").evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el);
          return {
            text: el.textContent ?? "",
            t: s.textTransform,
            size: s.fontSize,
            w: s.fontWeight
          };
        })
      );
      expect(titles.map((x) => x.text)).toEqual([
        "Darstellung",
        "Sprache",
        "KI-Modell",
        "Eigene API-Schlüssel (BYOK)In Vorbereitung",
        "EU AI Act"
      ]);
      expect(new Set(titles.map((x) => x.t))).toEqual(new Set(["none"]));
      expect(new Set(titles.map((x) => `${x.size}/${x.w}`)).size).toBe(1);

      // Hinweise, wann eine Einstellung greift und wo sie gespeichert ist
      await expect(drawer).toContainText("Gilt für neue Antworten.");
      await expect(drawer).toContainText(
        "Design und Farbschema werden auf diesem Gerät gespeichert."
      );
      await expect(drawer).toContainText(
        "Gilt für die Oberfläche und wird auf diesem Gerät gespeichert."
      );

      // BYOK: als in Vorbereitung gekennzeichnet, kein vorgetäuschtes Bedienelement
      const byok = drawer.locator("section", { has: page.locator("#byok-section-title") });
      await expect(byok.getByTestId("byok-status")).toHaveText("In Vorbereitung");
      await expect(byok.locator("input, button, select, textarea")).toHaveCount(0);
      const byokText = (await byok.locator(".rn-drawer-text").innerText()).trim();
      expect(byokText.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2);

      expect(await modeNames(page, "settings-drawer")).toEqual(MODE_NAMES);
      expect(await findLayoutProblems(page)).toEqual([]);
    });

    test("Schließen-Knöpfe: gleiches Symbol, Name, Position und mindestens 44 px", async ({
      page
    }) => {
      const drawer = await openSettings(page, width);
      const close = page.getByRole("button", { name: "Einstellungen schließen" });
      await expect(close).toHaveClass(/rn-dialog-close/);
      const box = await close.boundingBox();
      const panel = await drawer.locator(".rn-drawer-head").boundingBox();
      expect(box && panel).toBeTruthy();
      if (!box || !panel) return;
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      // rechts oben im Kopf
      expect(panel.x + panel.width - (box.x + box.width)).toBeLessThan(32);
      await expect(close.locator("svg")).toHaveCount(1);
      await close.click();
      await expect(drawer).toBeHidden();

      if (width < 600) {
        await page.getByTestId("btn-open-menu").click();
        const sheetClose = page.getByRole("button", { name: "Menü schließen" });
        await expect(sheetClose).toHaveClass(/rn-dialog-close/);
        const s = await sheetClose.boundingBox();
        expect(s?.width).toBeGreaterThanOrEqual(43.5);
        expect(s?.height).toBeGreaterThanOrEqual(43.5);
        expect(Math.abs((s?.x ?? 0) + (s?.width ?? 0) - (box.x + box.width))).toBeLessThan(2);
      }
    });

    test("gleiche Namen für Farbmodi im Menü und in den Einstellungen", async ({ page }) => {
      if (width < 600) {
        await page.getByTestId("btn-open-menu").click();
        const sheet = page.getByTestId("nav-sheet");
        await expect(sheet).toBeVisible();
        expect(await modeNames(page, "nav-sheet")).toEqual(MODE_NAMES);
        await expect(sheet.locator(".rn-sheet-section").first()).toHaveCSS(
          "text-transform",
          "none"
        );
        await expect(sheet).toContainText(
          "Design und Farbschema werden auf diesem Gerät gespeichert."
        );
        expect(await findLayoutProblems(page)).toEqual([]);
      } else {
        await page.getByTestId("btn-open-appearance").click();
        await expect(page.getByTestId("appearance-menu")).toBeVisible();
        expect(await modeNames(page, "appearance-menu")).toEqual(MODE_NAMES);
        expect(await findLayoutProblems(page)).toEqual([]);
      }
    });
  });
}

test.describe("Farbmodus Automatisch (wie Gerät)", () => {
  test("ist Standard und folgt dem Gerät live, feste Wahl bleibt", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-color-mode", "dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-color-mode", "light");
    await page.emulateMedia({ colorScheme: "light", contrast: "more" });
    await expect(html).toHaveAttribute("data-color-mode", "aaa-contrast");
    await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
    await expect(html).toHaveAttribute("data-color-mode", "dark");

    const drawer = await openSettings(page, 1440);
    await expect(drawer.getByTestId("mode-option-system")).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("rn_color_mode"))).toBe("system");

    // Feste Wahl: Gerät ändert nichts mehr, Wahl übersteht Neuladen
    await drawer.getByTestId("mode-option-light").check();
    await expect(html).toHaveAttribute("data-color-mode", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute("data-color-mode", "light");
    await page.reload();
    await expect(html).toHaveAttribute("data-color-mode", "light");

    // Zurück auf Automatisch: übernimmt sofort den Gerätemodus
    const again = await openSettings(page, 1440);
    await again.getByTestId("mode-option-system").check();
    await expect(html).toHaveAttribute("data-color-mode", "dark");
    expect(await page.evaluate(() => localStorage.getItem("rn_color_mode"))).toBe("system");
  });
});
