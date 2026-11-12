import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, openPanel } from "./helpers";

test.describe("Typografie: Silbentrennung, Stufung, Schatten, Scroll-Verlauf", () => {
  test("Editorial Calm trennt nur Fließtext, nie Überschriften, Beschreibungen und Knöpfe", async ({
    page
  }) => {
    await page.goto("/");
    await chooseDesign(page, "editorial-calm", "light");
    await openPanel(page, "studio");
    const hyphens = await page.evaluate(() => {
      const get = (selector: string): string[] =>
        Array.from(document.querySelectorAll(selector)).map((el) => getComputedStyle(el).hyphens);
      return {
        headings: get("h1, h2, h3"),
        toolDesc: get(".rn-tool-desc"),
        buttons: get("button"),
        prose: get(".rn-msg-body, .rn-summary-text")
      };
    });
    for (const key of ["headings", "toolDesc", "buttons"] as const) {
      expect(hyphens[key].length, key).toBeGreaterThan(0);
      expect(new Set(hyphens[key]), key).toEqual(new Set(["manual"]));
    }
    expect(hyphens.prose).toContain("auto");
  });

  test("Stufung: Titel > Untertitel > Text > Meta, nie unter 14 px", async ({ page }) => {
    await page.goto("/");
    for (const design of DESIGNS) {
      await chooseDesign(page, design, "light");
      await openPanel(page, "studio");
      const sizes = await page.evaluate(() => {
        const px = (selector: string): number => {
          const el = document.querySelector(selector) as Element;
          return Number.parseFloat(getComputedStyle(el).fontSize);
        };
        return {
          title: px(".rn-panel-heading h2"),
          subtitle: px(".rn-tool-title"),
          text: px(".rn-tool-desc"),
          meta: px(".rn-panel-sub")
        };
      });
      expect(sizes.title, design).toBeGreaterThan(sizes.subtitle);
      expect(sizes.subtitle, design).toBeGreaterThan(sizes.text);
      expect(sizes.text, design).toBeGreaterThan(sizes.meta);
      expect(sizes.meta, design).toBeGreaterThanOrEqual(14);
    }
  });

  test("Fusion: Panelkopf größer als in den anderen Designs, ohne !important", async ({ page }) => {
    await page.goto("/");
    const read = (): Promise<number> =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector(".rn-panel-heading h2") as Element).fontSize
        )
      );
    await chooseDesign(page, "fusion", "light");
    expect(await read()).toBe(26);
    await chooseDesign(page, "pure", "light");
    expect(await read()).toBeLessThan(26);
  });

  test("Popover-Schatten kommt aus dem Token, AAA-Kontrast ist flach", async ({ page }) => {
    await page.goto("/");
    await chooseDesign(page, "pure", "light");
    const token = (name: string): Promise<string> =>
      page.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name
      );
    expect(await token("--rn-shadow-popover")).toContain("rgba(");
    await chooseDesign(page, "pure", "aaa-contrast");
    expect(await token("--rn-shadow-popover")).toBe("none");
    expect(await token("--rn-shadow-dialog")).toBe("none");
  });

  test("Scroll-Verlauf: Rand blendet erst bei Überlauf ein und folgt der Scrollposition", async ({
    page
  }) => {
    await page.goto("/");
    await chooseDesign(page, "pure", "light");
    const readings = await page.evaluate(async () => {
      const el = document.querySelector(".chat-log") as HTMLElement;
      const filler = document.createElement("div");
      filler.style.height = "2400px";
      el.appendChild(filler);
      const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 150));
      const read = (): string[] => {
        const c = getComputedStyle(el);
        return [c.getPropertyValue("--rn-fade-top"), c.getPropertyValue("--rn-fade-bottom")];
      };
      await wait();
      const start = read();
      el.scrollTop = 600;
      await wait();
      const middle = read();
      el.scrollTop = el.scrollHeight;
      await wait();
      return { start, middle, end: read() };
    });
    expect(readings.start).toEqual(["0px", "28px"]);
    expect(readings.middle).toEqual(["28px", "28px"]);
    expect(readings.end).toEqual(["28px", "0px"]);
  });

  test.describe("mit prefers-reduced-motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("kein Scroll-Verlauf, keine Maske", async ({ page }) => {
      await page.goto("/");
      const mask = await page.evaluate(
        () => getComputedStyle(document.querySelector(".chat-log") as Element).maskImage
      );
      expect(mask).toBe("none");
    });
  });
});
