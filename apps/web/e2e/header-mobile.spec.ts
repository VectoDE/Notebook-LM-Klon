import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems } from "./helpers";

/** Sichtbare Bedienziele im Kopf und in der unteren Leiste: mindestens 44 x 44 px. */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "[data-testid='workspace-header'] button, [data-testid='mobile-bottom-nav'] button"
      )
    )
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 1 && r.height > 1)
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ el, r }) => `${el.getAttribute("data-testid")}: ${r.width}x${r.height}`)
  );
}

/** Kopf in genau einer Zeile: alle sichtbaren Kinder liegen auf derselben Höhe. */
async function headerRows(page: Page): Promise<number> {
  return page.getByTestId("workspace-header").evaluate((el) => {
    const boxes = Array.from(el.children)
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => a.top - b.top);
    let count = 0;
    let rowBottom = Number.NEGATIVE_INFINITY;
    for (const r of boxes) {
      if (r.top >= rowBottom - 1) {
        count += 1;
        rowBottom = r.bottom;
      } else {
        rowBottom = Math.max(rowBottom, r.bottom);
      }
    }
    return count;
  });
}

/** Liegt der Fokus im Element mit dieser Test-ID? */
const focusInside = (page: Page, testId: string) =>
  page.evaluate(
    (id) =>
      Boolean(document.querySelector(`[data-testid='${id}']`)?.contains(document.activeElement)),
    testId
  );

for (const width of [320, 360, 390, 430, 480, 599]) {
  test.describe(`Telefon ${width} px`, () => {
    test.use({ viewport: { width, height: 760 } });

    for (const design of DESIGNS) {
      test(`${design}: Kopf mit Logo und Menü, Reiter unten`, async ({ page }) => {
        await page.goto("/");
        await chooseDesign(page, design, "aaa-contrast");
        expect(await headerRows(page)).toBe(1);
        await expect(page.getByTestId("top-nav")).toBeHidden();
        await expect(page.getByTestId("btn-open-menu")).toBeVisible();
        await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
        expect(await smallTargets(page)).toEqual([]);
        expect(await findLayoutProblems(page)).toEqual([]);

        // Untere Leiste setzt aria-current
        await page.getByTestId("tab-btn-studio").click();
        await expect(page.getByTestId("tab-btn-studio")).toHaveAttribute("aria-current", "true");
        await expect(page.getByTestId("tab-btn-chat")).not.toHaveAttribute("aria-current", "true");
      });
    }

    test("Menü-Sheet: Vollbild, Fokusfalle, Escape und Fokus zurück", async ({ page }) => {
      await page.goto("/");
      const trigger = page.getByTestId("btn-open-menu");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.click();
      const sheet = page.getByTestId("nav-sheet");
      await expect(sheet).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      // Nach der Einblendung deckt das Sheet den ganzen Bildschirm
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const box = await sheet.boundingBox();
      expect(box?.x).toBeCloseTo(0, 0);
      expect(box?.y).toBeCloseTo(0, 0);
      expect(box?.width).toBeCloseTo(width, 0);
      expect(box?.height).toBeCloseTo(760, 0);
      expect(await focusInside(page, "nav-sheet")).toBe(true);

      // Tab und Umschalt+Tab verlassen das Sheet nie
      for (let i = 0; i < 25; i += 1) {
        await page.keyboard.press("Tab");
        expect(await focusInside(page, "nav-sheet")).toBe(true);
      }
      for (let i = 0; i < 25; i += 1) {
        await page.keyboard.press("Shift+Tab");
        expect(await focusInside(page, "nav-sheet")).toBe(true);
      }
      expect(await findLayoutProblems(page)).toEqual([]);
      const small = await sheet.evaluate((el) =>
        Array.from(el.querySelectorAll("button, .rn-control, .rn-segment, .rn-choice"))
          .map((b) => ({ b, r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 1 && (r.height < 44 || r.width < 44))
          .map(({ b, r }) => `${b.className}: ${r.width}x${r.height}`)
      );
      expect(small).toEqual([]);

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(trigger).toBeFocused();

      // Einstellungen aus dem Sheet öffnen
      await trigger.click();
      await page.getByTestId("sheet-open-settings").click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("dialog", { name: /Einstellungen/ })).toBeVisible();
    });
  });
}

for (const width of [600, 768, 1024, 1440]) {
  test.describe(`Desktop ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Reiterleiste und Darstellungsmenü", async ({ page }) => {
      await page.goto("/");
      expect(await headerRows(page)).toBe(1);
      // Marke, Reiter und Darstellung überlappen sich nicht
      const overlaps = await page.getByTestId("workspace-header").evaluate((el) => {
        const boxes = Array.from(el.children)
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0);
        return boxes.some((a, i) =>
          boxes.slice(i + 1).some((b) => a.right > b.left + 1 && b.right > a.left + 1)
        );
      });
      expect(overlaps).toBe(false);
      await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden();
      await expect(page.getByTestId("btn-open-menu")).toBeHidden();
      expect(await smallTargets(page)).toEqual([]);
      expect(await findLayoutProblems(page)).toEqual([]);

      await expect(page.getByTestId("top-tab-chat")).toHaveAttribute("aria-current", "true");
      await page.getByTestId("top-tab-studio").click();
      await expect(page.getByTestId("top-tab-studio")).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId("top-tab-chat")).not.toHaveAttribute("aria-current", "true");
      await expect(page.locator("[data-panel='studio']")).toBeVisible();

      // Menü per Tastatur: öffnen, Fokus hinein, Escape schließt, Fokus zurück
      const trigger = page.getByTestId("btn-open-appearance");
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByTestId("appearance-menu");
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(await focusInside(page, "appearance-menu")).toBe(true);
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        expect(await focusInside(page, "appearance-menu")).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();

      // Klick außerhalb schließt
      await trigger.click();
      await expect(menu).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);
      // Punkt sicher außerhalb des Menüs: links davon, auf halber Höhe
      const menuBox = await menu.boundingBox();
      await page.mouse.click(
        Math.round((menuBox?.x ?? width) / 2),
        Math.round((menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2)
      );
      await expect(menu).toBeHidden();

      // Auswahl wirkt sofort
      await chooseDesign(page, "editorial-calm", "dark");
      await expect(page.locator("html")).toHaveAttribute("data-design", "editorial-calm");

      // Einstellungen aus der Reiterleiste
      await page.getByTestId("btn-open-settings").click();
      await expect(page.getByRole("dialog", { name: /Einstellungen/ })).toBeVisible();
    });
  });
}
