import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems } from "./helpers";

/** Mobiler Kopf: höchstens zwei Zeilen, nichts ragt heraus, Bedienziele mindestens 44 px. */
for (const width of [320, 360, 390, 430, 480, 599]) {
  test.describe(`Kopfzeile bei ${width} px`, () => {
    test.use({ viewport: { width, height: 760 } });

    for (const design of DESIGNS) {
      test(`${design}: höchstens zwei Zeilen`, async ({ page }) => {
        await page.goto("/");
        await chooseDesign(page, design, "aaa-contrast");
        await page.getByTestId("role-switcher-select").selectOption("editor");
        const header = page.getByTestId("workspace-header");
        // Zeilen = Gruppen von Kindern, die sich vertikal überlappen
        const rows = await header.evaluate((el) => {
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
        expect(rows).toBeLessThanOrEqual(2);

        const controls = header.locator("select, button");
        for (const control of await controls.all()) {
          const box = await control.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        expect(await findLayoutProblems(page)).toEqual([]);

        // Gewählter Text in jedem Auswahlfeld passt vollständig hinein (Pfeil 20 px)
        const truncated = await header.evaluate((el) => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
          const out: string[] = [];
          for (const select of Array.from(el.querySelectorAll("select"))) {
            const s = getComputedStyle(select);
            ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
            const text = select.selectedOptions[0]?.textContent?.trim() ?? "";
            const needed =
              ctx.measureText(text).width +
              Number.parseFloat(s.paddingLeft) +
              Number.parseFloat(s.paddingRight) +
              20;
            if (needed > select.clientWidth + 1) {
              out.push(`${text}: ${Math.ceil(needed)} > ${select.clientWidth}`);
            }
          }
          return out;
        });
        expect(truncated).toEqual([]);
      });
    }
  });
}
