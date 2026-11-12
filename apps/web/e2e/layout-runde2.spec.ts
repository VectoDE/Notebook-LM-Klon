import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, openPanel } from "./helpers";

/**
 * Layout-Regressionen aus Runde 2 (#313): Studio-Liste auf dem Telefon, Lernkarte und
 * Quellentitel. Die Designs werden vor dem Laden gesetzt, damit jeder Fall nur die Ansicht prüft.
 */
async function start(page: Page, design: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.addInitScript((d: string) => {
    localStorage.setItem("rn_design", d);
    localStorage.setItem("rn_color_mode", "light");
  }, design);
  await page.goto("/");
  await page.waitForFunction((d) => document.documentElement.dataset.design === d, design);
  // Zeilenzahlen hängen von der geladenen Schrift ab
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const PHONES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 320, height: 256 }
] as const;

for (const design of DESIGNS) {
  test.describe(`Studio-Liste auf dem Telefon, ${design}`, () => {
    for (const { width, height } of PHONES) {
      test(`${width}x${height}: alle Werkzeuge erreichbar, nichts abgeschnitten`, async ({
        page
      }) => {
        await start(page, design, width, height);
        await openPanel(page, "studio");
        const list = page.getByTestId("studio-tools-grid");
        await expect(list).toBeVisible();

        // Die Liste behält ihre volle Höhe, kein Container schneidet sie ab
        const clipped = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(clipped, "Liste gestaucht oder abgeschnitten").toBeLessThanOrEqual(1);

        // Die letzte Werkzeugkarte lässt sich bis zu ihrer Aktion scrollen und trifft den Knopf
        const lastButton = page
          .locator("[data-testid^=tool-card-]")
          .last()
          .locator(".rn-tool-primary");
        await lastButton.scrollIntoViewIfNeeded();
        await expect(lastButton).toBeVisible();
        const hit = await lastButton.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            reachable: top === el || el.contains(top),
            inView: r.top >= 0 && r.bottom <= window.innerHeight
          };
        });
        expect(hit.reachable, "letzter Knopf verdeckt").toBe(true);
        expect(hit.inView, "letzter Knopf nach dem Scrollen nicht im Sichtfenster").toBe(true);
      });
    }

    test("Werkzeugbeschreibungen ohne Line-Clamp und ohne abgeschnittenen Text", async ({
      page
    }) => {
      await start(page, design, 390, 844);
      await openPanel(page, "studio");
      const problems = await page.locator(".rn-tool-desc").evaluateAll((els) =>
        els
          .map((el) => {
            const cs = getComputedStyle(el);
            return {
              clamp: cs.getPropertyValue("-webkit-line-clamp"),
              display: cs.display,
              cut: el.scrollHeight - el.clientHeight
            };
          })
          .filter((p) => (p.clamp !== "none" && p.clamp !== "") || p.cut > 1)
      );
      expect(problems).toEqual([]);
    });
  });
}

const CARD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 }
] as const;

for (const design of DESIGNS) {
  for (const { width, height } of CARD_VIEWPORTS) {
    test(`Lernkarte ${design} ${width}x${height}: kein Überlauf, Quellen-Knopf nicht verdeckt`, async ({
      page
    }) => {
      await start(page, design, width, height);
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-flashcards-tool").click();
      await page.getByRole("button", { name: "Antwort aufdecken" }).click();

      const card = page.locator(".rn-flashcard");
      const sourceButton = card.locator(".rn-link-btn");
      await sourceButton.scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const c = document.querySelector(".rn-flashcard") as HTMLElement;
        const b = c.querySelector(".rn-link-btn") as HTMLElement;
        const ratings = document.querySelector(".rn-ratings") as HTMLElement;
        const cr = c.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return {
          overflow: c.scrollHeight - c.clientHeight,
          // Der Fokusring ragt 2 px plus 2 px Abstand über den Knopf hinaus
          bottomGap: cr.bottom - br.bottom,
          aboveRatings: ratings.getBoundingClientRect().top - br.bottom,
          reachable: top === b || b.contains(top)
        };
      });
      expect(m.overflow, "Kartentext läuft über").toBeLessThanOrEqual(1);
      expect(m.bottomGap, "Knopf ragt aus der Karte").toBeGreaterThanOrEqual(0);
      expect(m.aboveRatings, "Knopf liegt unter der Bewertungsleiste").toBeGreaterThanOrEqual(4);
      expect(m.reachable, "Knopf wird überdeckt").toBe(true);
    });
  }
}

const SOURCE_WIDTHS = [900, 1024, 1100, 1440] as const;

for (const design of DESIGNS) {
  for (const width of SOURCE_WIDTHS) {
    test(`Quellentitel ${design} ${width}px: keine Wortbrüche`, async ({ page }) => {
      await start(page, design, width, 900);
      const titles = page.locator(".rn-source-title");
      await expect(titles.first()).toBeVisible();
      const broken = await titles.evaluateAll((els) => {
        const result: string[] = [];
        for (const el of els) {
          const node = el.firstChild;
          if (!node || node.nodeType !== Node.TEXT_NODE) continue;
          const text = node.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index ?? 0);
            range.setEnd(node, (match.index ?? 0) + match[0].length);
            const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (tops.size > 1) result.push(match[0]);
          }
        }
        return result;
      });
      expect(broken, "Wort über mehrere Zeilen gebrochen").toEqual([]);
    });
  }

  test(`Quellentitel ${design} 1024px: höchstens zwei Zeilen`, async ({ page }) => {
    await start(page, design, 1024, 768);
    const lines = await page.locator(".rn-source-title").evaluateAll((els) =>
      els.map((el) => {
        const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      })
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const n of lines) expect(n).toBeLessThanOrEqual(2);
  });
}
