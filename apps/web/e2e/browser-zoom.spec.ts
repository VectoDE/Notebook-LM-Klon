import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

/** Zoom 200 % in Desktop-Browsern und Kanälen (Issue #255). */

test.describe("Zoom 200 %", () => {
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

  for (const design of DESIGNS) {
    test(`${design}: kein horizontaler Scroll, alle Bereiche erreichbar`, async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      for (const panel of ["sources", "chat", "studio"] as const) {
        await openPanel(page, panel);
        const scroll = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth
        }));
        expect(scroll.scroll, `${design}/${panel}`).toBeLessThanOrEqual(scroll.client);
        expect(await findLayoutProblems(page), `${design}/${panel}`).toEqual([]);
      }
    });
  }
});
