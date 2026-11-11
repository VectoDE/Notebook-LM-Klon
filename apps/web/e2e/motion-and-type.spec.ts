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

  test("andere Designs bleiben ruhig", async ({ page }) => {
    await page.goto("/");
    for (const design of ["pure", "editorial-calm", "fusion"]) {
      await chooseDesign(page, design, "light");
      const name = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".workspace-shell") as Element, "::before")
            .animationName
      );
      expect(name).toBe("none");
    }
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
