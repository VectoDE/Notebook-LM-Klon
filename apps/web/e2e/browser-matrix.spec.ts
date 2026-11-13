import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, findSmallText, openPanel } from "./helpers";

/**
 * Browser- und Touch-Matrix (Issue #255). Läuft in allen Playwright-Projekten:
 * Chromium, Firefox, WebKit (Safari-Engine) sowie Pixel 7 und iPhone 13 (Touch).
 * Geprüft wird je Design: Darstellung umschalten, keine Schrift unter 14 px, kein
 * Layoutfehler; am Desktop zusätzlich 200 % Zoom ohne horizontalen Scroll, auf Touch-
 * Geräten Bedienung per Tippen und Ziele von mindestens 44 x 44 px.
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

test.describe("Zoom 200 % (Desktop-Browser)", () => {
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

  for (const design of DESIGNS) {
    test(`${design}: kein horizontaler Scroll, alle Bereiche erreichbar`, async ({
      page
    }, testInfo) => {
      test.skip(Boolean(testInfo.project.use.isMobile), "Zoom wird am Desktop geprüft");
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

test.describe("Touch", () => {
  test("Tippen auf die untere Leiste wechselt den Bereich, Ziele mindestens 44 px", async ({
    page
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "nur auf Touch-Geräten");
    await page.goto("/");
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    for (const tab of ["sources", "studio", "chat"] as const) {
      await page.getByTestId(`tab-btn-${tab}`).tap();
      await expect(page.getByTestId(`tab-btn-${tab}`)).toHaveAttribute("aria-current", "true");
      await expect(page.locator(`[data-panel='${tab}']`)).toBeVisible();
    }
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          "[data-testid='workspace-header'] button, [data-testid='mobile-bottom-nav'] button"
        )
      )
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 1 && (r.width < 44 || r.height < 44))
        .map(({ el, r }) => `${el.getAttribute("data-testid")}: ${r.width}x${r.height}`)
    );
    expect(small).toEqual([]);

    // Menü per Tippen öffnen und mit dem Schließen-Knopf bzw. Escape schließen
    await page.getByTestId("btn-open-menu").tap();
    await expect(page.getByTestId("nav-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-sheet")).toBeHidden();
  });
});
