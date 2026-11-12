import { expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

/**
 * Design endgültig, Teil 1 (Issue #328): Standarddesign, Pillenknöpfe, Karten 12 px,
 * Felder, Fokusring, gefüllte Symbole, Verläufe nur in Fusion, obere Leiste 56 px,
 * Fließtext 16 px, Bewegung mit Schalter in den Einstellungen und Zoom/Umbruch.
 */

const BUTTONS =
  ".rn-btn, .rn-icon-btn, .rn-control--button, .rn-chip, .rn-send, .rn-link-btn, .rn-seg-tab, .rn-rating, .rn-stage-btn, .rn-topnav-item";

test.describe("Standard beim Erstbesuch", () => {
  test("Pure, Farbmodus Hell ohne Vorgabe des Geräts", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-design", "pure");
    await expect(html).toHaveAttribute("data-color-mode", "light");
    expect(await page.evaluate(() => localStorage.getItem("rn_color_mode"))).toBe("system");
  });

  test("Farbmodus folgt dem System (dunkel)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-design", "pure");
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  });
});

for (const design of DESIGNS) {
  test.describe(`${design}: Grundlagen`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("Knöpfe als Pille ohne Unterstrich, Karten 12 px, Fließtext 16 px, Leiste 56 px", async ({
      page
    }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      const report = await page.evaluate((selector) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
        };
        const notPill: string[] = [];
        const underlined: string[] = [];
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (!visible(el)) continue;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const radius = Number.parseFloat(s.borderTopLeftRadius);
          // Pille: Radius mindestens halbe Höhe (Gruppen mit geteiltem Rand ausgenommen)
          if (radius + 0.5 < r.height / 2 && !el.closest(".rn-zoom")) {
            notPill.push(`${el.className} ${radius} < ${r.height / 2}`);
          }
          if (s.textDecorationLine.includes("underline")) underlined.push(el.className);
        }
        const radii = (sel: string) =>
          Array.from(document.querySelectorAll(sel))
            .filter(visible)
            .map((el) => getComputedStyle(el).borderTopLeftRadius);
        const header = document.querySelector(".workspace-header") as Element;
        return {
          notPill,
          underlined,
          tools: radii(".rn-tool"),
          panels: radii(".workspace-panel"),
          inputs: radii(".rn-search-input"),
          body: getComputedStyle(document.body).fontSize,
          message: getComputedStyle(document.querySelector(".rn-msg-body") as Element).fontSize,
          header: Math.round(header.getBoundingClientRect().height),
          logoLeft: Math.round(
            (header.querySelector("[data-testid='brand-logo']") as Element).getBoundingClientRect()
              .left
          )
        };
      }, BUTTONS);
      expect(report.notPill, "Pillenform").toEqual([]);
      expect(report.underlined, "kein Unterstrich").toEqual([]);
      if (design === "editorial-calm") {
        // Editorial: Werkzeuge als Inhaltsverzeichnis (Linien), Spalten bündig
        expect(new Set(report.panels)).toEqual(new Set(["0px"]));
      } else {
        expect(new Set(report.tools)).toEqual(new Set(["12px"]));
        expect(new Set(report.panels)).toEqual(new Set(["12px"]));
      }
      expect(report.inputs).toEqual(["12px"]);
      expect(report.body).toBe("16px");
      expect(report.message).toBe("16px");
      expect(report.header).toBe(56);
      // Logo links oben, vor allen anderen Elementen der Leiste
      expect(report.logoLeft).toBeLessThan(48);
    });

    test("Überschriften dürfen Serifen tragen, Fließtext nie", async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      const fonts = await page.evaluate(() => ({
        body: getComputedStyle(document.querySelector(".rn-msg-body") as Element).fontFamily,
        button: getComputedStyle(document.querySelector(".rn-btn") as Element).fontFamily,
        heading: getComputedStyle(document.querySelector(".rn-panel-heading h2") as Element)
          .fontFamily
      }));
      expect(fonts.body).not.toMatch(/Serif 4|Georgia/);
      expect(fonts.button).not.toMatch(/Serif 4|Georgia/);
      if (design === "editorial-calm") expect(fonts.heading).toMatch(/^"Source Serif 4/);
    });

    for (const mode of MODES) {
      test(`${mode}: Felder mit Rand und Feldfläche, Fokusring 3 px in Markenfarbe`, async ({
        page
      }) => {
        await page.goto("/");
        await chooseDesign(page, design, mode);
        const search = page.locator(".rn-search-input");
        await search.focus();
        const field = await search.evaluate((el) => {
          const s = getComputedStyle(el);
          const root = getComputedStyle(document.documentElement);
          const toRgb = (value: string) => {
            const probe = document.createElement("span");
            probe.style.color = value;
            document.body.appendChild(probe);
            const rgb = getComputedStyle(probe).color;
            probe.remove();
            return rgb;
          };
          return {
            background: s.backgroundColor,
            fieldToken: toRgb(root.getPropertyValue("--rn-color-field").trim()),
            borderWidth: s.borderTopWidth,
            borderColor: s.borderTopColor,
            borderToken: toRgb(root.getPropertyValue("--rn-color-border").trim()),
            outlineWidth: s.outlineWidth,
            outlineStyle: s.outlineStyle,
            outlineColor: s.outlineColor,
            focusToken: toRgb(root.getPropertyValue("--rn-color-focus-ring").trim())
          };
        });
        expect(field.background).toBe(field.fieldToken);
        if (mode === "light") expect(field.background).toBe("rgb(255, 255, 255)");
        expect(field.borderWidth).toBe("1px");
        expect(field.borderColor).toBe(field.borderToken);
        expect(field.outlineWidth).toBe("3px");
        expect(field.outlineStyle).toBe("solid");
        expect(field.outlineColor).toBe(field.focusToken);
      });
    }

    test("Symbole gefüllt, Verlauf nur in Fusion", async ({ page }) => {
      await page.goto("/");
      for (const mode of ["light", "dark"] as const) {
        await chooseDesign(page, design, mode);
        const result = await page.evaluate(() => {
          const thinStrokes = Array.from(document.querySelectorAll(".rn-icon path")).filter(
            (p) => p.getAttribute("stroke-width") === "1.75"
          ).length;
          const filled = Array.from(document.querySelectorAll(".rn-icon path")).filter(
            (p) => p.getAttribute("fill") === "currentColor"
          ).length;
          const gradients: string[] = [];
          for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const pseudo of [null, "::before", "::after"]) {
              const image = getComputedStyle(el, pseudo).backgroundImage;
              if (!image.includes("gradient")) continue;
              // Funktionale Ausblendung über dem Eingabefeld ist kein Farbverlauf
              if (el.classList.contains("chat-dock") && pseudo === "::before") continue;
              gradients.push(`${el.tagName.toLowerCase()}.${el.className}${pseudo ?? ""}`);
            }
          }
          return { thinStrokes, filled, gradients };
        });
        expect(result.thinStrokes).toBe(0);
        expect(result.filled).toBeGreaterThan(10);
        if (design === "fusion") {
          expect(result.gradients.length, `${design}/${mode}`).toBeGreaterThan(0);
        } else {
          expect(result.gradients, `${design}/${mode}`).toEqual([]);
        }
      }
    });

    test("Bewegung: Knopf hebt sich und Panels blenden ein", async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      const button = page.getByTestId("btn-open-mindmap-tool");
      await button.hover();
      await page.waitForTimeout(400);
      const transform = await button.evaluate((el) => getComputedStyle(el).transform);
      expect(transform).toMatch(/matrix\(1, 0, 0, 1, 0, -2\)/);
      const panel = await page.evaluate(
        () => getComputedStyle(document.querySelector(".workspace-panel") as Element).animationName
      );
      expect(panel).not.toBe("none");
    });
  });
}

test.describe("Bewegung reduzieren: Schalter in den Einstellungen und Systemwert", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Schalter in den Einstellungen wirkt und ist mit der Darstellung verbunden", async ({
    page
  }) => {
    await page.goto("/");
    await page.getByTestId("btn-open-settings").click();
    const drawer = page.getByTestId("settings-drawer");
    const toggle = drawer.getByRole("checkbox", { name: "Bewegung reduzieren" });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
    await expect(drawer.getByTestId("settings-reduce-motion-toggle-system")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("btn-open-appearance").click();
    await expect(
      page.getByTestId("appearance-menu").getByTestId("reduce-motion-toggle")
    ).toBeChecked();
    // Knöpfe heben sich nicht mehr
    await page.keyboard.press("Escape");
    const button = page.getByTestId("btn-open-mindmap-tool");
    await button.hover();
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  });

  test.describe("mit Systemwert prefers-reduced-motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("Hinweis am Schalter, keine Anhebung", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("btn-open-settings").click();
      const hint = page.getByTestId("settings-reduce-motion-toggle-system");
      await expect(hint).toHaveText(
        "Ihr Gerät ist auf weniger Bewegung eingestellt. Animationen sind deshalb bereits aus."
      );
      await page.keyboard.press("Escape");
      const button = page.getByTestId("btn-open-mindmap-tool");
      await button.hover();
      expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    });
  });
});

/**
 * Zoom und Umbruch: 400 % Zoom (WCAG 1.4.10) entspricht 320 x 256 CSS-Pixeln; 200 %
 * Textgröße (WCAG 1.4.4) als Wurzelschrift 200 % bei 1280 x 800. Kein horizontales
 * Scrollen, nichts ragt heraus, nichts wird abgeschnitten.
 */
for (const design of DESIGNS) {
  test(`${design}: 400 % Zoom (320 x 256) ohne horizontales Scrollen und Verlust`, async ({
    page
  }) => {
    await page.addInitScript((d) => localStorage.setItem("rn_design", d), design);
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto("/");
    expect(await findLayoutProblems(page), "Start").toEqual([]);
    for (const tab of ["sources", "chat", "studio"] as const) {
      await openPanel(page, tab);
      await page.waitForTimeout(150);
      expect(await findLayoutProblems(page), tab).toEqual([]);
    }
  });

  test(`${design}: 200 % Text bei 1280 x 800 ohne horizontales Scrollen und Verlust`, async ({
    page
  }) => {
    await page.addInitScript((d) => {
      localStorage.setItem("rn_design", d);
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = "200%";
      });
    }, design);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
      "32px"
    );
    expect(await findLayoutProblems(page), "Start").toEqual([]);
    await page.getByTestId("btn-open-mindmap-tool").click();
    await page.waitForTimeout(150);
    expect(await findLayoutProblems(page), "Mindmap").toEqual([]);
  });
}
