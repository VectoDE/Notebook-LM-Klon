import { expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, findSmallText } from "./helpers";

test.describe("Immersive Cinema: Bewegungssprache", () => {
  test("Hintergrund, Kopf und Panels sind animiert", async ({ page }) => {
    await page.goto("/");
    await chooseDesign(page, "immersive-cinema", "dark");
    const names = await page.evaluate(() => ({
      background: getComputedStyle(
        document.querySelector(".workspace-shell") as Element,
        "::before"
      ).animationName,
      sweep: getComputedStyle(document.querySelector(".workspace-header") as Element, "::after")
        .animationName,
      panel: getComputedStyle(document.querySelector(".workspace-panel") as Element).animationName
    }));
    expect(names).toEqual({
      background: "rn-cinema-drift",
      sweep: "rn-cinema-sweep",
      panel: "rn-cinema-rise"
    });
  });

  test.describe("mit prefers-reduced-motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("keine Animation", async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, "immersive-cinema", "dark");
      const names = await page.evaluate(() => [
        getComputedStyle(document.querySelector(".workspace-shell") as Element, "::before")
          .animationName,
        getComputedStyle(document.querySelector(".workspace-header") as Element, "::after")
          .animationName,
        getComputedStyle(document.querySelector(".workspace-panel") as Element).animationName,
        getComputedStyle(document.querySelector(".workspace-header") as Element).animationName
      ]);
      expect(names).toEqual(["none", "none", "none", "none"]);
    });
  });

  test("Atmosphäre je Design: Fusion fließt, Pure und Editorial ruhen, AAA flach", async ({
    page
  }) => {
    await page.goto("/");
    const read = () =>
      page.evaluate(() => {
        const shell = document.querySelector(".workspace-shell") as Element;
        const header = document.querySelector(".workspace-header") as Element;
        return {
          background: getComputedStyle(shell, "::before").animationName,
          line: getComputedStyle(header, "::after").animationName,
          font: getComputedStyle(document.body).fontFamily.split(",")[0]
        };
      });
    const expected: Record<string, { background: string; line: string; font: string }> = {
      pure: { background: "none", line: "none", font: '"Inter Variable"' },
      "editorial-calm": { background: "none", line: "none", font: '"Source Serif 4 Variable"' },
      fusion: { background: "rn-fusion-flow", line: "rn-fusion-line", font: '"Geist Variable"' },
      "immersive-cinema": {
        background: "rn-cinema-drift",
        line: "rn-cinema-sweep",
        font: '"Space Grotesk Variable"'
      }
    };
    for (const [design, want] of Object.entries(expected)) {
      await chooseDesign(page, design, "light");
      expect(await read(), design).toEqual(want);
      await chooseDesign(page, design, "aaa-contrast");
      expect((await read()).background, `${design} AAA`).toBe("none");
    }
  });

  test.describe("alle Designs mit prefers-reduced-motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("keine Animation in keinem Design", async ({ page }) => {
      await page.goto("/");
      for (const design of DESIGNS) {
        await chooseDesign(page, design, "dark");
        const names = await page.evaluate(() => [
          getComputedStyle(document.querySelector(".workspace-shell") as Element, "::before")
            .animationName,
          getComputedStyle(document.querySelector(".workspace-header") as Element, "::after")
            .animationName,
          getComputedStyle(document.querySelector(".workspace-panel") as Element).animationName
        ]);
        expect(names, design).toEqual(["none", "none", "none"]);
      }
    });
  });
});

test.describe("Schriftgröße im gerenderten DOM mindestens 14 px", () => {
  for (const design of DESIGNS) {
    test(design, async ({ page }) => {
      await page.goto("/");
      for (const mode of MODES) {
        await chooseDesign(page, design, mode);
        expect(await findSmallText(page, 14), `${design}/${mode} Start`).toEqual([]);
      }
      await page.getByTestId("btn-open-mindmap-tool").click();
      expect(await findSmallText(page, 14), `${design} Mindmap`).toEqual([]);
    });
  }
});

test("Cinema: Arbeitsfläche bleibt an ihrem Platz (kein verdeckter Scroll der Shell)", async ({
  page
}) => {
  await page.goto("/");
  await chooseDesign(page, "immersive-cinema", "dark");
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => {
    const shell = document.querySelector(".workspace-shell") as HTMLElement;
    const header = document.querySelector(".workspace-header") as HTMLElement;
    return {
      shellScrollTop: shell.scrollTop,
      shellScrollable: shell.scrollHeight - shell.clientHeight,
      headerTop: Math.round(header.getBoundingClientRect().top)
    };
  });
  expect(state).toEqual({ shellScrollTop: 0, shellScrollable: 0, headerTop: 0 });
});
