import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

for (const width of [390, 1440]) {
  test.describe(`Bedienziele im Chat ${width} px`, () => {
    test.use({ viewport: { width, height: 860 } });

    for (const design of DESIGNS) {
      test(`${design}: Knöpfe mindestens 44 px, Zitat-Pillen mit 44-px-Trefferfläche`, async ({
        page
      }) => {
        await page.goto("/");
        await chooseDesign(page, design, "light");
        await openPanel(page, "chat");
        const chat = page.getByTestId("chat-panel");
        await expect(chat).toBeVisible();

        const small = await chat.evaluate((root) =>
          Array.from(root.querySelectorAll("button"))
            .filter((b) => !b.classList.contains("rn-cite"))
            .map((b) => ({ b, r: b.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 1 && r.height > 1)
            .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
            .map(({ b, r }) => `${b.getAttribute("data-testid")}: ${r.width}x${r.height}`)
        );
        expect(small).toEqual([]);

        // Klick 20 px über und unter der Pillenmitte trifft noch die Pille (statt Fließtext)
        const hits = await chat.evaluate((root) =>
          Array.from(root.querySelectorAll<HTMLElement>(".rn-cite")).map((pill) => {
            const r = pill.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return [cy - 20, cy + 20].every((y) => {
              if (y < 0 || y > window.innerHeight) return true;
              const hit = document.elementFromPoint(cx, y);
              // Liegt dort ein anderes Bedienelement (z. B. Eingabefeld), gehört die Fläche ihm
              if (
                hit &&
                hit !== pill &&
                hit.closest("input, textarea, select, a, button") &&
                !pill.contains(hit)
              ) {
                return true;
              }
              return hit === pill || pill.contains(hit);
            });
          })
        );
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(Boolean)).toBe(true);
        expect(await findLayoutProblems(page)).toEqual([]);
      });
    }
  });
}
