import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

/** Sichtbare Knöpfe in einem Bereich, die kleiner als 44 x 44 px sind. */
async function smallButtons(page: Page, testId: string): Promise<string[]> {
  return page.getByTestId(testId).evaluate((root) =>
    Array.from(root.querySelectorAll("button, select, .rn-quiz-option, .rn-segment, .rn-choice"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 1 && r.height > 1)
      // 0,5 px Spielraum für Subpixel-Rundung während laufender Einblendungen
      .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
      .map(({ el, r }) => `${el.className || el.tagName}: ${Math.round(r.width)}x${r.height}`)
  );
}

/** Werkzeugansichten nutzen Klassen statt Inline-Stile (ausgenommen dynamische Werte). */
async function inlineStyles(page: Page): Promise<string[]> {
  return page.getByTestId("studio-tool-view").evaluate((root) =>
    Array.from(root.querySelectorAll("[style]"))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.getAttribute("style")}`)
      .filter((s) => !/margin-inline-start|^canvas/.test(s))
  );
}

const TOOLS = [
  { id: "mindmap", open: "btn-open-mindmap-tool", root: ".rn-mindmap" },
  { id: "quiz", open: "btn-open-quiz-tool", root: ".rn-quiz" },
  { id: "lernkarten", open: "btn-open-flashcards-tool", root: ".rn-cards" },
  { id: "video", open: "btn-open-video-tool", root: ".rn-video" },
  { id: "audio", open: "btn-open-audio-tool", root: ".audio-player-container" }
] as const;

for (const width of [360, 390, 430, 1440]) {
  test.describe(`Werkzeuge ${width} px`, () => {
    test.use({ viewport: { width, height: 860 } });

    for (const design of DESIGNS) {
      test(`${design}: Werkzeugansichten ohne Inline-Stile, Layoutfehler und kleine Ziele`, async ({
        page
      }) => {
        await page.goto("/");
        await chooseDesign(page, design, "dark");
        for (const tool of TOOLS) {
          await openPanel(page, "studio");
          await page.getByTestId(tool.open).click();
          await expect(page.locator(tool.root)).toBeVisible();
          // Einblendungen (z. B. Cinema mit Skalierung) erst ausklingen lassen, dann messen
          await page.getByTestId("studio-tool-view").evaluate((el) =>
            Promise.all(
              el
                .getAnimations({ subtree: true })
                .filter(
                  (anim) => anim.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY
                )
                .map((anim) => anim.finished)
            )
          );
          expect(await inlineStyles(page), tool.id).toEqual([]);
          expect(await findLayoutProblems(page), tool.id).toEqual([]);
          expect(await smallButtons(page, "studio-tool-view"), tool.id).toEqual([]);
          await page.getByTestId("btn-back-to-studio-overview").click();
        }
      });
    }
  });
}

test.describe("Studio auf dem Telefon", () => {
  test.use({ viewport: { width: 390, height: 860 } });

  test("Werkzeuge als Liste: eine Fläche, Einträge ohne eigenen Kartenrahmen", async ({ page }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    const list = page.getByTestId("studio-tools-grid");
    await expect(list).toBeVisible();
    const look = await list.evaluate((ul) => {
      const items = Array.from(ul.querySelectorAll(".rn-tool"));
      const gap = getComputedStyle(ul).rowGap;
      return {
        gap,
        radii: items.map((el) => getComputedStyle(el).borderTopLeftRadius),
        dividers: items.slice(1).map((el) => getComputedStyle(el).borderTopWidth)
      };
    });
    expect(look.gap).toBe("0px");
    expect(new Set(look.radii)).toEqual(new Set(["0px"]));
    expect(new Set(look.dividers)).toEqual(new Set(["1px"]));
  });
});

test.describe("Einstellungen", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: modal, Fokusfalle, Escape und Auswahl wirkt`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      if (width < 600) {
        await page.getByTestId("btn-open-menu").click();
        await page.getByTestId("sheet-open-settings").click();
      } else {
        await page.getByTestId("btn-open-settings").click();
      }
      const drawer = page.getByTestId("settings-drawer");
      await expect(drawer).toBeVisible();
      await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      expect(await findLayoutProblems(page)).toEqual([]);
      expect(await smallButtons(page, "settings-drawer")).toEqual([]);
      for (let i = 0; i < 20; i += 1) {
        await page.keyboard.press("Tab");
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await drawer.getByTestId("theme-option-editorial-calm").check();
      await expect(page.locator("html")).toHaveAttribute("data-design", "editorial-calm");
      await drawer.getByTestId("lang-option-en").check();
      await expect(page.getByRole("dialog", { name: /Settings/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    });
  }
});

test.describe("Deep-Dive-Bühne", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: Vollbild, nur Bühnenfarben, Escape schließt`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-deep-dive-stage").click();
      const stage = page.getByTestId("deep-dive-stage");
      await expect(stage).toBeVisible();
      await stage.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const box = await stage.boundingBox();
      expect(box?.width).toBeCloseTo(width, 0);
      expect(box?.height).toBeCloseTo(860, 0);
      expect(await findLayoutProblems(page)).toEqual([]);
      expect(await smallButtons(page, "deep-dive-stage")).toEqual([]);
      // Fuß und Transkript überlappen sich nicht
      const overlap = await stage.evaluate((el) => {
        const body = el.querySelector(".rn-stage-body")?.getBoundingClientRect();
        const foot = el.querySelector(".rn-stage-foot")?.getBoundingClientRect();
        return body && foot ? body.bottom > foot.top + 1 : true;
      });
      expect(overlap).toBe(false);
      await page.keyboard.press("Escape");
      await expect(stage).toBeHidden();
    });
  }
});

test.describe("Panelwechsel", () => {
  test.use({ viewport: { width: 390, height: 860 } });

  test("blendet das neue Panel ein", async ({ page }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    const names = await page
      .locator(".workspace-panel.panel-active")
      .evaluate((el) => el.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(names).toContain("rn-panel-in");
  });

  test("ohne Bewegung bei prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await openPanel(page, "studio");
    const count = await page
      .locator(".workspace-panel.panel-active")
      .evaluate((el) => el.getAnimations().length);
    expect(count).toBe(0);
  });
});

test.describe("Studio-Kopf", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: Notebook-Titel steht in jeder Werkzeugansicht genau einmal`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      for (const open of [
        "btn-open-mindmap-tool",
        "btn-open-quiz-tool",
        "btn-open-flashcards-tool",
        "btn-open-audio-tool"
      ]) {
        await openPanel(page, "studio");
        await page.getByTestId(open).click();
        const titles = page
          .getByTestId("studio-panel")
          .getByText("Cloudflare Edge Stack Architecture", { exact: true });
        await expect(titles, open).toHaveCount(1);
        await page.getByTestId("btn-back-to-studio-overview").click();
      }
    });
  }
});
