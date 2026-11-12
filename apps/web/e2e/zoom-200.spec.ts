import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

/**
 * WCAG 2.2 SC 1.4.4 (Text vergrößern): Bei 200 % Browser-Zoom halbiert sich der
 * CSS-Viewport. 1280 x 800 bei 200 % entspricht 640 x 400 CSS-Pixeln mit
 * Gerätepixelverhältnis 2. Geprüft: kein horizontaler Seiten-Scroll, nichts ragt aus
 * dem Viewport, kein abgeschnittener Inhalt; in allen vier Designs und allen Ansichten.
 */
const ZOOM_200 = [
  { name: "1280x800", width: 640, height: 400 },
  { name: "1366x768", width: 683, height: 384 },
  { name: "1920x1080", width: 960, height: 540 }
] as const;

for (const screen of ZOOM_200) {
  test.describe(`Zoom 200 % auf ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: 2 });

    for (const design of DESIGNS) {
      test(`${design}: ohne horizontalen Scroll und ohne abgeschnittene Inhalte`, async ({
        page
      }) => {
        await page.goto("/");
        await chooseDesign(page, design, "light");

        const views: { label: string; open: () => Promise<void> }[] = [
          { label: "Start", open: async () => {} }
        ];
        if (screen.width < 900) {
          for (const tab of ["sources", "chat", "studio"] as const) {
            views.push({
              label: `Reiter ${tab}`,
              open: () => openPanel(page, tab)
            });
          }
        }
        views.push({
          label: "Studio Mindmap",
          open: async () => {
            // Ab 900 px führt der Sprunglink ins Studio und klappt es bei Bedarf aus
            await openPanel(page, "studio");
            await page.getByTestId("btn-open-mindmap-tool").click();
          }
        });

        for (const view of views) {
          await view.open();
          await page.waitForTimeout(150);
          const problems = await findLayoutProblems(page);
          expect(problems, `${design} / ${view.label}`).toEqual([]);
        }
      });
    }
  });
}
