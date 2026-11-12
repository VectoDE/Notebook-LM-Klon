import { expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, openPanel } from "./helpers";

/**
 * Navigation und Landmarks: Sprunglink, Kopfzeile außerhalb von main, aria-current an den
 * Bereichsumschaltern, Name-in-Label (WCAG 2.5.3), Menü-Sheet ohne Dopplung der unteren
 * Leiste und Live-Transkript bei reduzierter Bewegung.
 */

test.describe("Sprunglink und Landmarks", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Tab + Enter springt auf main (#workspace-main)", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByTestId("skip-link");
    // Außerhalb des Bildes, solange er keinen Fokus hat
    expect((await skip.boundingBox())?.y ?? 0).toBeLessThan(0);

    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toHaveText("Zum Inhalt springen");
    // Bei Fokus sichtbar und im Bild
    const box = await skip.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box?.height).toBeGreaterThanOrEqual(43.5);

    await page.keyboard.press("Enter");
    const main = page.locator("main#workspace-main");
    await expect(main).toBeFocused();
    await expect(main).toHaveAttribute("tabindex", "-1");
    // Der nächste Tab landet im Inhalt, nicht wieder in der Kopfzeile
    await page.keyboard.press("Tab");
    expect(await main.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test("banner liegt außerhalb von main, es gibt genau ein main", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
    expect(
      await page.getByRole("banner").evaluate((el) => Boolean(el.closest("main, [role='main']")))
    ).toBe(false);
    // Sprunglink steht vor der Kopfzeile
    expect(
      await page.evaluate(() => {
        const skip = document.querySelector("[data-testid='skip-link']");
        const header = document.querySelector("header");
        return Boolean(
          skip && header && skip.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING
        );
      })
    ).toBe(true);
  });

  test("Panel-Umschalter nutzen aria-current=true, nie page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("top-tab-chat")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("top-tab-studio").click();
    await expect(page.getByTestId("top-tab-studio")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("top-tab-chat")).not.toHaveAttribute("aria-current");
    await expect(page.locator("[aria-current='page']")).toHaveCount(0);
  });
});

for (const design of DESIGNS) {
  test.describe(`Telefon 390 px, ${design}`, () => {
    test.use({ viewport: { width: 390, height: 860 } });

    test("Name der Knöpfe beginnt mit der sichtbaren Beschriftung", async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      for (const tab of ["sources", "chat", "studio"] as const) {
        const button = page.getByTestId(`tab-btn-${tab}`);
        const visible = (await button.locator(".rn-tab-label").innerText()).trim();
        const name = await button.evaluate((el) => {
          const label = el.getAttribute("aria-label");
          if (label) return label;
          const text = Array.from(el.childNodes)
            .map((node) =>
              node instanceof Element && node.getAttribute("aria-hidden") === "true"
                ? ""
                : (node.textContent ?? "")
            )
            .join("");
          return text.replace(/\s+/g, " ").trim();
        });
        expect(name.startsWith(visible), `${tab}: "${name}" beginnt nicht mit "${visible}"`).toBe(
          true
        );
      }
      // Quellen nennt zusätzlich die Anzahl
      await expect(page.getByRole("button", { name: "Quellen (2)" })).toBeVisible();
    });

    test("Menü-Sheet wiederholt die untere Leiste nicht", async ({ page }) => {
      await page.goto("/");
      await chooseDesign(page, design, "light");
      await page.getByTestId("btn-open-menu").click();
      const sheet = page.getByTestId("nav-sheet");
      await expect(sheet).toBeVisible();
      for (const tab of ["sources", "chat", "studio"]) {
        await expect(page.getByTestId(`sheet-tab-${tab}`)).toHaveCount(0);
      }
      // Kein zweites "Bereiche"-Navigationsfeld im Sheet
      await expect(sheet.getByRole("navigation")).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: /^(Quellen|Chat|Studio)/ })).toHaveCount(0);
      // Behalten: Einstellungen, Darstellung, Schließen
      await expect(page.getByTestId("sheet-open-settings")).toBeVisible();
      await expect(sheet.getByTestId(`theme-option-${design}`)).toBeVisible();
      await expect(page.getByTestId("btn-close-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      // Bereichswechsel läuft über die untere Leiste
      await openPanel(page, "studio");
      await expect(page.getByTestId("tab-btn-studio")).toHaveAttribute("aria-current", "true");
    });
  });
}

test.describe("Live-Transkript und Bewegung", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Merkt sich alle scrollTo-Aufrufe der Transkript-Liste. */
  async function recordLyricsScroll(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      const w = window as unknown as { __lyricsBehaviors: string[] };
      w.__lyricsBehaviors = [];
      const original = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
        const options = args[0] as ScrollToOptions | undefined;
        if (this.classList.contains("rn-lyrics")) {
          w.__lyricsBehaviors.push(String(options?.behavior));
        }
        return (original as (...a: unknown[]) => void).apply(this, args);
      };
    });
  }

  async function seekToThirdLine(page: import("@playwright/test").Page) {
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
    const lines = page.locator("[data-testid^='lyrics-line-']");
    expect(await lines.count()).toBeGreaterThan(2);
    await lines.nth(2).click();
    await expect(lines.nth(2)).toHaveAttribute("aria-current", "location");
  }

  test("reduzierte Bewegung: scrollTo ohne Animation (auto)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordLyricsScroll(page);
    await page.goto("/");
    await seekToThirdLine(page);
    const behaviors = await page.evaluate(
      () => (window as unknown as { __lyricsBehaviors: string[] }).__lyricsBehaviors
    );
    expect(behaviors.length).toBeGreaterThanOrEqual(2);
    expect(behaviors.every((b) => b === "auto")).toBe(true);
  });

  test("normale Bewegung: scrollTo weich (smooth) bei jedem Zeilenwechsel", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await recordLyricsScroll(page);
    await page.goto("/");
    await seekToThirdLine(page);
    const behaviors = await page.evaluate(
      () => (window as unknown as { __lyricsBehaviors: string[] }).__lyricsBehaviors
    );
    // Beim Öffnen (Startzeile) und nach dem Sprung zur dritten Zeile
    expect(behaviors.length).toBeGreaterThanOrEqual(2);
    expect(behaviors.every((b) => b === "smooth")).toBe(true);
  });
});
