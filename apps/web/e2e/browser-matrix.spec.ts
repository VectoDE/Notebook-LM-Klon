import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, findSmallText } from "./helpers";

/**
 * Browser- und Geräte-Matrix (Issue #255). Läuft in allen Matrix-Projekten (Desktop-Browser,
 * Kanäle und Touch-Geräte in Hoch- und Querformat, siehe playwright.config.ts). Geprüft wird
 * je Design: Darstellung umschalten, keine Schrift unter 14 px, kein Layoutfehler.
 * Zoom steht in browser-zoom.spec.ts, Touch in browser-touch.spec.ts.
 */

test.describe("Darstellung je Design", () => {
  for (const design of DESIGNS) {
    test(`${design}: Hell und Dunkel ohne Layoutfehler, Schrift mindestens 14 px`, async ({
      page
    }) => {
      await page.goto("/");
      for (const mode of ["light", "dark"] as const) {
        await chooseDesign(page, design, mode);
        await page.mouse.move(0, 0);
        expect(await findSmallText(page, 14), `${design}/${mode}`).toEqual([]);
        expect(await findLayoutProblems(page), `${design}/${mode}`).toEqual([]);
        // Seitentext ist mindestens 16 px groß
        const body = await page.evaluate(() =>
          Number.parseFloat(getComputedStyle(document.body).fontSize)
        );
        expect(body).toBeGreaterThanOrEqual(16);
      }
    });
  }
});
