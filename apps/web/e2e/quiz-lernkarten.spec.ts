import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, openPanel } from "./helpers";

async function openTool(page: Page, testId: string): Promise<void> {
  await page.goto("/");
  await openPanel(page, "studio");
  await page.getByTestId(testId).click();
}

test.describe("Quiz: Ansagen und Zustände", () => {
  test("Fragewechsel wird angesagt und der Fokus springt auf die neue Frage", async ({ page }) => {
    await openTool(page, "btn-open-quiz-tool");
    const announcement = page.getByTestId("a11y-quiz-announcement");
    await expect(announcement).toHaveAttribute("aria-live", "polite");
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(announcement).toHaveText("Frage 2 von 2");
    await expect(page.locator(".rn-quiz-fieldset")).toBeFocused();
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(announcement).toHaveText("Frage 1 von 2");
    await expect(page.locator(".rn-quiz-fieldset")).toBeFocused();
  });

  test("zwischen Frage und Antworten liegt ein Abstand", async ({ page }) => {
    await openTool(page, "btn-open-quiz-tool");
    const gap = await page.evaluate(() => {
      const legend = document.querySelector(".rn-quiz-question")?.getBoundingClientRect();
      const options = document.querySelector(".rn-quiz-options")?.getBoundingClientRect();
      return legend && options ? options.top - legend.bottom : -1;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
  });

  test("Quellen-Knopf: sichtbare Beschriftung steht im zugänglichen Namen", async ({ page }) => {
    await openTool(page, "btn-open-quiz-tool");
    await page.locator(".rn-quiz-option").first().click();
    const button = page.locator(".rn-quiz-explanation .rn-link-btn");
    const visible = ((await button.textContent()) ?? "").trim();
    expect(visible.length).toBeGreaterThan(0);
    await expect(button).toHaveAccessibleName(visible);
  });
});

interface StateProbe {
  readonly border: string;
  readonly text: number;
  readonly ui: number;
  readonly icon: boolean;
}

for (const design of DESIGNS) {
  for (const mode of MODES) {
    test(`Quiz ${design}/${mode}: richtig und falsch gewinnen gegen die Auswahl, mit Symbol und Kontrast`, async ({
      page
    }) => {
      await page.goto("/");
      await chooseDesign(page, design, mode);
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-quiz-tool").click();
      const options = page.locator(".rn-quiz-option");
      // Erst eine Antwort wählen; ist sie richtig, eine zweite wählen, damit "falsch" sichtbar wird
      await options.nth(0).click();
      if ((await options.nth(0).getAttribute("data-state")) === "correct") {
        await options.nth(1).click();
      }
      await expect(page.locator('.rn-quiz-option[data-state="wrong"]')).toHaveCount(1);
      await expect(page.locator('.rn-quiz-option[data-state="correct"]')).toHaveCount(1);

      // Farbübergänge und Einblendungen ausklingen lassen, bevor Farben gemessen werden
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            // Scroll-getriebene Animationen (Scroll-Verlauf) enden nie und bleiben außen vor
            .filter((a) => a.timeline === document.timeline)
            .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
            .map((a) => a.finished)
        )
      );
      const probe = await page.evaluate(() => {
        const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lin = (v: number) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        const lum = (c: number[]) =>
          0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
        const ratio = (a: string, b: string) => {
          const [l1 = 0, l2 = 0] = [lum(parse(a)), lum(parse(b))].sort((x, y) => y - x);
          return (l1 + 0.05) / (l2 + 0.05);
        };
        const panel = getComputedStyle(
          document.querySelector(".rn-quiz-card") as Element
        ).backgroundColor;
        const out: Record<string, StateProbe> = {};
        for (const el of Array.from(document.querySelectorAll(".rn-quiz-option"))) {
          const state = el.getAttribute("data-state") ?? "";
          if (state !== "correct" && state !== "wrong") continue;
          const s = getComputedStyle(el);
          out[state] = {
            border: s.borderTopColor,
            text: ratio(s.color, s.backgroundColor),
            ui: ratio(s.borderTopColor, panel),
            icon: el.querySelector(".rn-quiz-flag svg") !== null
          };
        }
        return out;
      });
      const ok = probe.correct as StateProbe;
      const bad = probe.wrong as StateProbe;
      expect(ok.icon).toBe(true);
      expect(bad.icon).toBe(true);
      expect(ok.text).toBeGreaterThanOrEqual(7);
      expect(bad.text).toBeGreaterThanOrEqual(7);
      expect(ok.ui).toBeGreaterThanOrEqual(3);
      expect(bad.ui).toBeGreaterThanOrEqual(3);
      // Weder Primärrand der Auswahl noch gleiche Farbe für beide Zustände
      expect(bad.border).not.toBe(ok.border);
      const primary = await page.evaluate(() => {
        const probeEl = document.createElement("span");
        probeEl.style.color = "var(--rn-color-primary)";
        document.body.append(probeEl);
        const c = getComputedStyle(probeEl).color;
        probeEl.remove();
        return c;
      });
      expect(bad.border).not.toBe(primary);
    });
  }
}

test.describe("Lernkarten: Klartext, Zustände, Namen", () => {
  test("Meta in Klartext statt Intervall und Reps", async ({ page }) => {
    await openTool(page, "btn-open-flashcards-tool");
    const card = page.getByTestId("flashcard-card");
    await expect(card).toContainText("Nächste Wiederholung: heute · 0 Wiederholungen");
    await expect(card).not.toContainText("Reps");
  });

  test("deaktivierte Bewertungsknöpfe ohne Strichrand, aktiv nach dem Umdrehen", async ({
    page
  }) => {
    await openTool(page, "btn-open-flashcards-tool");
    const rating = page.locator(".rn-rating").first();
    await expect(rating).toBeDisabled();
    await expect(rating).toHaveCSS("border-top-style", "solid");
    await page.getByRole("button", { name: /Antwort aufdecken/ }).click();
    await expect(rating).toBeEnabled();
  });

  test("sichtbare Beschriftung steht am Anfang des zugänglichen Namens", async ({ page }) => {
    await openTool(page, "btn-open-flashcards-tool");
    const foot = page.locator(".rn-flashcard-foot button");
    for (let i = 0; i < (await foot.count()); i++) {
      const visible = ((await foot.nth(i).textContent()) ?? "").trim();
      await expect(foot.nth(i)).toHaveAccessibleName(visible);
    }
    const nav = page.getByRole("navigation", { name: "Kartenauswahl" }).locator("button");
    for (let i = 0; i < (await nav.count()); i++) {
      const visible = ((await nav.nth(i).textContent()) ?? "").trim();
      const name = (await nav.nth(i).getAttribute("aria-label")) ?? "";
      expect(name.startsWith(visible)).toBe(true);
    }
  });

  test("Knopfreihen laufen bündig mit den Bewertungsspalten", async ({ page }) => {
    await openTool(page, "btn-open-flashcards-tool");
    const edges = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      const ratings = box(".rn-ratings");
      const nav = box(".rn-cards nav");
      return { r: [ratings?.left, ratings?.right], n: [nav?.left, nav?.right] };
    });
    expect(edges.n).toEqual(edges.r);
  });
});
