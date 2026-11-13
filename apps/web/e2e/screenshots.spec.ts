import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, findLayoutProblems, findSmallText } from "./helpers";

/**
 * Bildbelege für die Sichtprüfung (Issues #251, #278, #280): je Design und Farbmodus ein
 * Bild am Desktop (1440 x 900) und am Telefon (375 x 812), dazu der mobile Kopf bei 320
 * und 414 px sowie die Ansicht bei 200 % Zoom. Die Bilder liegen unter
 * test-results/screenshots/ und werden in CI als Artefakt hochgeladen, nicht ins Repo.
 * Jede Aufnahme prüft nebenbei: keine Schrift unter 14 px, kein Layoutfehler.
 */

const SHOT_DIR = resolve(import.meta.dirname, "../test-results/screenshots");

const VIEWS = [
  { name: "desktop-1440", width: 1440, height: 900, scale: 1 },
  { name: "telefon-375", width: 375, height: 812, scale: 1 }
] as const;

for (const design of DESIGNS) {
  test(`${design}: Bilder je Farbmodus, Desktop und Telefon`, async ({ page }) => {
    test.setTimeout(300_000);
    for (const view of VIEWS) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto("/");
      for (const mode of MODES) {
        await chooseDesign(page, design, mode);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(350);
        expect(await findSmallText(page, 14), `${design}/${mode}/${view.name}`).toEqual([]);
        expect(await findLayoutProblems(page), `${design}/${mode}/${view.name}`).toEqual([]);
        await page.screenshot({ path: resolve(SHOT_DIR, `${design}-${mode}-${view.name}.png`) });
      }
    }
  });
}

for (const view of [
  { name: "kopf-320", width: 320, height: 700, scale: 1 },
  { name: "kopf-414", width: 414, height: 800, scale: 1 },
  { name: "zoom-200-1280x800", width: 640, height: 400, scale: 2 }
]) {
  test.describe(`Kopf ${view.name}`, () => {
    test.use({ deviceScaleFactor: view.scale });
    test(`${view.name}: alle Designs`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.goto("/");
      for (const design of DESIGNS) {
        await chooseDesign(page, design, "light");
        await page.mouse.move(0, 0);
        await page.waitForTimeout(350);
        expect(await findLayoutProblems(page), `${design}/${view.name}`).toEqual([]);
        await page.getByTestId("workspace-header").screenshot({
          path: resolve(SHOT_DIR, `${design}-${view.name}-kopf.png`)
        });
      }
    });
  });
}
