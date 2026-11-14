import { type Locator, type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, openPanel } from "./helpers";

/**
 * Issue #314: URL-Dialog modal, Zwischenfrage hält den Fokus, Bühne öffnet die Frage,
 * Name beginnt mit der sichtbaren Beschriftung (WCAG 2.5.3), Mindmap-Grafik per Tastatur,
 * Fokusring des Videoplayers gegen den Panelgrund.
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

/** Nur Buchstaben und Ziffern, klein: so vergleicht auch axe Name und sichtbaren Text. */
function letters(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Jeder Knopf im Bereich: Der zugängliche Name beginnt mit dem sichtbaren Text. */
async function expectLabelInName(scope: Locator): Promise<number> {
  const buttons = scope.getByRole("button");
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible())) continue;
    const visible = letters(await button.innerText());
    if (!visible) continue;
    const name = await button.evaluate((el) => el.getAttribute("aria-label"));
    const accessible = letters(name ?? (await button.innerText()));
    expect(accessible.startsWith(visible), `${visible} -> ${accessible}`).toBe(true);
  }
  return count;
}

async function openAudio(page: Page): Promise<void> {
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-audio-tool").click();
  await expect(page.getByTestId("btn-audio-interject")).toBeVisible();
}

for (const width of [390, 1440]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 860 } });

    test("URL-Dialog ist modal, Fokus im URL-Feld, Esc und Abbrechen geben ihn zurück", async ({
      page
    }) => {
      await page.goto("/");
      await openPanel(page, "sources");
      const trigger = page.getByTestId("btn-open-url-dialog");
      const dialog = page.getByTestId("url-import-dialog");

      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
      await expect(page.getByTestId("url-address-input")).toBeFocused();

      // Tab bleibt im Dialog (Hintergrund ist inert)
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await page.getByTestId("btn-cancel-url-dialog").click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test("Zwischenfrage: Tab bleibt in der Schublade, Esc schließt, Fokus zurück", async ({
      page
    }) => {
      await page.goto("/");
      await openAudio(page);
      const join = page.getByTestId("btn-audio-interject");
      const drawer = page.getByTestId("interject-dialog");

      await join.click();
      await expect(drawer).toBeVisible();
      await expect(page.locator("#interject-question-input")).toBeFocused();
      // Vorwärts und rückwärts über die Ränder: der Fokus verlässt die Schublade nicht
      for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await drawer.evaluate((el) => el.contains(document.activeElement)), key).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(join).toBeFocused();

      // Nach "Abbrechen" ebenfalls zurück auf den Beitreten-Knopf
      await join.click();
      await page.getByRole("button", { name: "Abbrechen (Esc)" }).click();
      await expect(drawer).toHaveCount(0);
      await expect(join).toBeFocused();
    });

    test("Bühne: „Frage an die Hosts stellen“ schließt die Bühne und öffnet die Zwischenfrage", async ({
      page
    }) => {
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-deep-dive-stage").click();
      await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
      await page.getByTestId("btn-deep-dive-interject").click();
      await expect(page.getByTestId("deep-dive-stage")).toHaveCount(0);
      await expect(page.getByTestId("interject-dialog")).toBeVisible();
      await expect(page.locator("#interject-question-input")).toBeFocused();
      await expect(page.getByTestId("audio-state-badge")).toHaveText("Status: Zwischenfrage");

      // Abbrechen führt auf den Beitreten-Knopf des Players
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("interject-dialog")).toHaveCount(0);
      await expect(page.getByTestId("btn-audio-interject")).toBeFocused();
    });

    test("Label-in-Name: Audio, Zwischenfrage, Lernkarten und Bühne", async ({ page }) => {
      await page.goto("/");
      await openAudio(page);
      const player = page.locator(".audio-player-container");
      await expectLabelInName(player);
      await expect(
        page.getByRole("button", { name: "Beitreten / Frage stellen", exact: true })
      ).toBeVisible();

      await page.getByTestId("btn-audio-interject").click();
      await expectLabelInName(player);
      await expect(page.getByRole("button", { name: "Sprechen (Mikrofon)" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Frage stellen", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByTestId("btn-back-to-studio-overview").click();
      await page.getByTestId("btn-open-flashcards-tool").click();
      await page.getByRole("button", { name: "Antwort aufdecken" }).click();
      await expectLabelInName(page.locator(".rn-ratings"));
      const again = page.getByRole("button", { name: /^Nochmal 1$/ });
      await expect(again).toHaveAccessibleDescription("Taste 1: Falsch erinnert");
      await expect(again).toHaveAttribute("aria-keyshortcuts", "1");

      await page.getByTestId("btn-back-to-studio-overview").click();
      await page.getByTestId("btn-open-deep-dive-stage").click();
      const stage = page.getByTestId("deep-dive-stage");
      await expect(stage).toBeVisible();
      expect(await expectLabelInName(stage)).toBeGreaterThan(3);
      await expect(page.getByTestId("lyrics-line-line_1")).toHaveAccessibleName(
        /^Host Lea Willkommen zum Deep Dive!/
      );
    });

    test("Mindmap-Grafik: per Tab erreichbar, benannt, Pfeiltasten verschieben die Ansicht", async ({
      page
    }) => {
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-mindmap-tool").click();
      // Auf dem Telefon startet die Mindmap seit #315 mit der Baumliste
      await page.getByRole("tab", { name: "Grafik" }).click();
      const panel = page.getByTestId("mindmap-visual-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAccessibleName("Grafik");

      await page.getByRole("button", { name: "Einpassen" }).focus();
      await page.keyboard.press("Tab");
      await expect(panel).toBeFocused();
      expect(await panel.evaluate((el) => el.matches(":focus-visible"))).toBe(true);

      const group = page.locator("[data-testid=mindmap-svg] > g");
      const before = await group.getAttribute("transform");
      const read = (t: string | null) => (t?.match(/-?[\d.]+/g) ?? []).slice(0, 2).map(Number);
      const [x0, y0] = read(before);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await expect(group).not.toHaveAttribute("transform", before ?? "");
      const [x1, y1] = read(await group.getAttribute("transform"));
      expect(x1).toBe((x0 ?? 0) - 40);
      expect(y1).toBe((y0 ?? 0) - 40);
      // Die Seite selbst scrollt dabei nicht
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      // Baumliste unberührt: Grafikpanel verborgen und kein Tab-Stopp mehr
      await page.getByRole("tab", { name: "Baumliste", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole("tree")).toBeVisible();
    });
  });
}

test.describe("Fokusring um den Videoplayer: mind. 3:1 gegen den Panelgrund", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const design of DESIGNS) {
    for (const mode of MODES) {
      test(`${design} / ${mode}`, async ({ page }) => {
        await useDesign(page, design, mode);
        await page.goto("/");
        await openPanel(page, "studio");
        await page.getByTestId("btn-open-video-tool").click();
        const player = page.getByTestId("video-overview-player");
        // Der Player lädt erst auf Absicht nach (Issue #350), nicht mehr im Leerlauf
        await expect(player).toBeVisible();
        await page.getByTestId("btn-back-to-studio-overview").focus();
        // Großzügige Grenze: unter Last (CI) liegen mehr Bedienelemente vor dem Player.
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press("Tab");
          if (await player.evaluate((el) => el === document.activeElement)) break;
        }
        await expect(player).toBeFocused();
        const ring = await player.evaluate((el) => {
          const style = getComputedStyle(el);
          // Grund außerhalb des Players: erster deckender Hintergrund darüber
          let node = el.parentElement;
          let bg = "rgb(255, 255, 255)";
          while (node) {
            const c = getComputedStyle(node).backgroundColor;
            const alpha = c.startsWith("rgba") ? Number(c.split(",")[3]?.replace(")", "")) : 1;
            if (c !== "transparent" && alpha > 0.95) {
              bg = c;
              break;
            }
            node = node.parentElement;
          }
          return {
            visible: el.matches(":focus-visible"),
            color: style.outlineColor,
            width: Number.parseFloat(style.outlineWidth),
            offset: Number.parseFloat(style.outlineOffset),
            bg
          };
        });
        expect(ring.visible).toBe(true);
        expect(ring.width).toBeGreaterThanOrEqual(3);
        expect(ring.offset).toBeGreaterThanOrEqual(0);
        const ratio = contrast(ring.color, ring.bg);
        expect(ratio, `${ring.color} auf ${ring.bg}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          3
        );
      });
    }
  }
});
