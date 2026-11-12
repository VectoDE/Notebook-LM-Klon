import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, openPanel } from "./helpers";

/**
 * Issue #294: Fokusring auf Bühne, Video und Audio, Fokus-Rückgabe nach Dialogen,
 * deutscher Audio-Status, Orb im Designakzent, Sprechername nur einmal.
 */

const STORAGE = { design: "rn_design", mode: "rn_color_mode" } as const;

async function useDesign(page: Page, design: string, mode: string): Promise<void> {
  await page.addInitScript(
    ([keys, d, m]) => {
      localStorage.setItem(keys.design, d);
      localStorage.setItem(keys.mode, m);
    },
    [STORAGE, design, mode] as const
  );
}

/** Kontrast zweier CSS-Farben (rgb/rgba, deckend angenommen) nach WCAG. */
function contrast(a: string, b: string): number {
  const lum = (css: string) => {
    const [r, g, bl] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const ch = (v = 0) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Fokussiert per Tastatur (Shift+Tab, Tab) und liest Ringfarbe, Ringbreite und Bühnengrund. */
async function ringOn(page: Page, selector: string, surface: string) {
  const target = page.locator(selector).first();
  await target.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  return target.evaluate((el, surfaceSelector) => {
    const style = getComputedStyle(el);
    const bg = getComputedStyle(el.closest(surfaceSelector) as Element).backgroundColor;
    return {
      focusVisible: el.matches(":focus-visible"),
      outline: style.outlineColor,
      width: Number.parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      bg
    };
  }, surface);
}

async function openStudioTool(page: Page, testId: string): Promise<void> {
  await openPanel(page, "studio");
  await page.getByTestId(testId).click();
}

test.describe("Fokusring auf dunklen Bühnenflächen: mind. 3:1 in allen Designs und Modi", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const design of DESIGNS) {
    for (const mode of MODES) {
      test(`${design} / ${mode}`, async ({ page }) => {
        await useDesign(page, design, mode);
        await page.goto("/");

        const results: Record<string, number> = {};
        const check = async (name: string, selector: string, surface: string) => {
          const ring = await ringOn(page, selector, surface);
          expect(ring.focusVisible, name).toBe(true);
          expect(ring.style, name).toBe("solid");
          expect(ring.width, name).toBeGreaterThanOrEqual(3);
          results[name] = contrast(ring.outline, ring.bg);
        };

        await openStudioTool(page, "btn-open-audio-tool");
        await check("audio", ".audio-player-container .btn-play-pause", ".audio-player-container");
        await page.getByTestId("btn-back-to-studio-overview").click();

        await page.getByTestId("btn-open-video-tool").click();
        await check("video", ".rn-video button", ".rn-video");
        await page.getByTestId("btn-back-to-studio-overview").click();

        await page.getByTestId("btn-open-deep-dive-stage").click();
        await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
        await check("stage", '[data-testid="btn-close-deep-dive-stage"]', ".rn-stage");

        for (const [name, ratio] of Object.entries(results)) {
          expect(ratio, `${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

test.describe("Fokus-Rückgabe nach dem Schließen", () => {
  test("1440 px: Einstellungen per Escape und per Schließen-Knopf zurück auf den Auslöser", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const trigger = page.getByTestId("btn-open-settings");

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-drawer")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByTestId("close-settings-btn").click();
    await expect(trigger).toBeFocused();
  });

  test("390 px: Einstellungen aus dem Menü-Sheet, danach Fokus auf den Menüknopf", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 860 });
    await page.goto("/");
    await page.getByTestId("btn-open-menu").click();
    await page.getByTestId("sheet-open-settings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
    await expect(page.getByTestId("nav-sheet")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-drawer")).toHaveCount(0);
    await expect(page.getByTestId("btn-open-menu")).toBeFocused();
  });

  for (const width of [390, 1440]) {
    test(`${width} px: Bühne per Escape und per Schließen-Knopf zurück auf „Bühne“`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      await openPanel(page, "studio");
      const trigger = page.getByTestId("btn-open-deep-dive-stage");

      await trigger.click();
      await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("deep-dive-stage")).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await page.getByTestId("btn-close-deep-dive-stage").click();
      await expect(trigger).toBeFocused();
    });
  }

  test("Bühne: „Frage an die Hosts“ führt den Fokus in die Zwischenfrage des Players", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    await page.getByTestId("btn-deep-dive-interject").click();
    // Seit #314 öffnet die Frage direkt
    await expect(page.locator("#interject-question-input")).toBeFocused();
  });

  test("Audio: Zwischenfrage abbrechen (Escape und Knopf) gibt den Fokus an „Beitreten“ zurück", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await openStudioTool(page, "btn-open-audio-tool");
    const trigger = page.getByTestId("btn-audio-interject");
    // Zwischenfragen gehen erst, wenn der Podcast läuft oder pausiert ist
    await page.locator(".btn-play-pause").click();

    await trigger.click();
    await expect(page.locator("#interject-question-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("interject-dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator(".btn-cancel").click();
    await expect(trigger).toBeFocused();
  });
});

test.describe("Bühne und Audio: Inhalte", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Audio-Status auf Deutsch, kein aria-label auf span", async ({ page }) => {
    await page.goto("/");
    await openStudioTool(page, "btn-open-audio-tool");
    const badge = page.getByTestId("audio-state-badge");
    await expect(badge).toHaveText("Status: Bereit");
    expect(await page.locator(".audio-player-container span[aria-label]").count()).toBe(0);
  });

  test("Sprechername steht nur einmal, Schließen-Knopf mit Symbol und 44 px", async ({ page }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    const stage = page.getByTestId("deep-dive-stage");
    await expect(stage).toBeVisible();
    const active = stage.locator('.rn-lyrics-line[data-state="active"] .rn-lyrics-speaker');
    const name = (await active.textContent())?.trim() ?? "";
    expect(name.length).toBeGreaterThan(0);
    // Sichtbar genau einmal im Bereich außerhalb der Transkriptliste
    expect(await stage.locator(".rn-stage-orb").getByText(name).count()).toBe(0);

    const close = page.getByTestId("btn-close-deep-dive-stage");
    await expect(close).toHaveAccessibleName("Bühne schließen");
    expect(await close.locator("svg").count()).toBe(1);
    const box = await close.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  });

  for (const design of ["pure", "immersive-cinema", "editorial-calm", "fusion"] as const) {
    test(`Orb nutzt den Bühnenakzent: ${design}`, async ({ page }) => {
      await useDesign(page, design, "dark");
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-deep-dive-stage").click();
      const canvas = page.getByTestId("aurora-orb-canvas");
      await expect(canvas).toBeVisible();
      const sample = await canvas.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const [r, g, b, a] = Array.from(
          c.getContext("2d")?.getImageData(c.width / 2, c.height / 2, 1, 1).data ?? []
        );
        const accent = getComputedStyle(c).getPropertyValue("--rn-color-stage-accent").trim();
        return { r, g, b, a, accent };
      });
      const hex = sample.accent.replace("#", "");
      const want = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(sample.a ?? 0).toBeGreaterThan(150);
      // Farbton des Bühnenakzents; blasse Akzente werden für den Orb kräftiger (Issue #315)
      const hsl = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 0) {
          if (max === r) h = ((g - b) / d + 6) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
        }
        return { h: h * 60, l: (max + min) / 2 };
      };
      const got = hsl([sample.r ?? 0, sample.g ?? 0, sample.b ?? 0]);
      const target = hsl(want as number[]);
      const diff = Math.abs(got.h - target.h);
      expect(Math.min(diff, 360 - diff)).toBeLessThanOrEqual(10);
      expect(got.l).toBeLessThanOrEqual(Math.max(target.l, 0.7) + 0.03);
    });
  }
});
