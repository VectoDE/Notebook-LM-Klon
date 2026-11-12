import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, openPanel } from "./helpers";

/**
 * Leerzustände groß (Issue #356): Zeichnung 240 bis 320 px breit, auf schmalen Flächen
 * (400 % Zoom = 320 CSS-px, 200 % = 640 CSS-px) ohne waagerechtes Scrollen (WCAG 1.4.10).
 */
const sizes = [
  { name: "Desktop", width: 1440, height: 900, minArt: 240, titleInView: true },
  { name: "Zoom 200 %", width: 640, height: 400, minArt: 200, titleInView: true },
  { name: "Zoom 400 %", width: 320, height: 256, minArt: 200, titleInView: false }
] as const;

for (const size of sizes) {
  test.describe(`Leerzustände ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const design of DESIGNS) {
      test(`${design}: Zeichnung groß, kein waagerechtes Scrollen`, async ({ page }) => {
        await page.goto("/");
        await chooseDesign(page, design, "light");
        const check = async (testId: string): Promise<void> => {
          const art = page.getByTestId(testId).locator("svg.rn-empty-art");
          await expect(art).toBeVisible();
          const box = await art.boundingBox();
          expect(box?.width ?? 0, `${design} ${testId}`).toBeGreaterThanOrEqual(size.minArt);
          expect(box?.width ?? 0, `${design} ${testId}`).toBeLessThanOrEqual(320);
          const scroll = await page.evaluate(() => ({
            doc: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
            vw: document.documentElement.clientWidth
          }));
          expect(scroll.doc, `${design} ${testId}`).toBeLessThanOrEqual(scroll.vw);
          expect(scroll.body, `${design} ${testId}`).toBeLessThanOrEqual(scroll.vw);
        };
        // Quellen-Filter ohne Treffer
        await openPanel(page, "sources");
        await page.getByTestId("sources-filter-input").fill("zzz");
        await check("no-sources-message");
        // Studio ohne ausgewählte Quelle
        await page.getByTestId("sources-filter-input").fill("");
        await page.getByTestId("select-all-sources-checkbox").uncheck();
        await openPanel(page, "studio");
        await check("studio-empty-state");
        // Überschrift ohne Scrollen sichtbar, nicht von der unteren Leiste verdeckt. Bei 400 %
        // (256 px Höhe) braucht das Studio schon vor #356 senkrechtes Scrollen, das ist nach
        // WCAG 1.4.10 zulässig.
        if (size.titleInView) {
          const title = await page
            .getByTestId("studio-empty-state")
            .locator(".rn-empty-title")
            .boundingBox();
          const nav = page.locator(".mobile-bottom-nav");
          const limit = (await nav.isVisible())
            ? ((await nav.boundingBox())?.y ?? size.height)
            : size.height;
          // mindestens 8 px Luft zur unteren Leiste
          expect(
            (title?.y ?? 0) + (title?.height ?? 0),
            `${design}: Überschrift sichtbar`
          ).toBeLessThanOrEqual(limit - 8);
        }
      });
    }
  });
}
