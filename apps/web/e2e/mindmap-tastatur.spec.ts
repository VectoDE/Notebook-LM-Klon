import { type Page, expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/** Issue #296: Mindmap per Tastatur bedienbar (APG Tree View und Tabs). */

async function openMindmap(page: Page): Promise<void> {
  await page.goto("/");
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-mindmap-tool").click();
  await expect(page.locator(".rn-mindmap")).toBeVisible();
}

/** Beschriftung des fokussierten Elements (erster Textknoten, ohne Quellenangabe). */
function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(
    () => document.activeElement?.querySelector("strong")?.textContent ?? "(kein Eintrag)"
  );
}

test.describe("Mindmap per Tastatur", () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test("Reiter: Pfeiltasten, Pos1/Ende, automatische Aktivierung", async ({ page }) => {
    await openMindmap(page);
    const tabs = page.getByRole("tablist", { name: "Ansicht" }).getByRole("tab");
    await expect(tabs).toHaveText(["Grafik", "Baumliste"]);
    const grafik = page.getByRole("tab", { name: "Grafik", exact: true });
    const liste = page.getByRole("tab", { name: "Baumliste", exact: true });
    await expect(grafik).toHaveAttribute("tabindex", "0");
    await expect(liste).toHaveAttribute("tabindex", "-1");

    await grafik.focus();
    await page.keyboard.press("ArrowRight");
    await expect(liste).toBeFocused();
    await expect(liste).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tree")).toBeVisible();
    await expect(page.getByTestId("mindmap-svg")).toBeHidden();

    await page.keyboard.press("ArrowRight");
    await expect(grafik).toBeFocused();
    await expect(grafik).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(liste).toBeFocused();
    await page.keyboard.press("Home");
    await expect(grafik).toBeFocused();
    await page.keyboard.press("End");
    await expect(liste).toBeFocused();
    await expect(liste).toHaveAttribute("aria-controls", /tree-panel$/);
  });

  test("Baumliste: ein Tab-Stopp, Fokus folgt den Pfeiltasten", async ({ page }) => {
    await openMindmap(page);
    await page.getByRole("tab", { name: "Baumliste", exact: true }).click();
    const tree = page.getByRole("tree");
    const items = tree.getByRole("treeitem");
    await expect(items).toHaveCount(7);
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

    // Tab vom Reiter führt direkt auf den aktiven Eintrag (Ein-/Ausklapp-Knöpfe überspringen)
    await page.keyboard.press("Tab");
    expect(await focusedLabel(page)).toBe("Cloudflare Edge Stack");
    await expect(items.first()).toHaveAttribute("aria-level", "1");

    await page.keyboard.press("ArrowDown");
    expect(await focusedLabel(page)).toBe("Compute");
    const compute = items.nth(1);
    await expect(compute).toHaveAttribute("aria-level", "2");
    await expect(compute).toHaveAttribute("aria-setsize", "2");
    await expect(compute).toHaveAttribute("aria-posinset", "1");
    await expect(compute).toHaveAttribute("aria-expanded", "true");
    await expect(compute).toHaveAttribute("tabindex", "0");
    await expect(items.first()).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("ArrowRight");
    expect(await focusedLabel(page)).toBe("Single Worker (Hono)");
    await page.keyboard.press("ArrowDown");
    expect(await focusedLabel(page)).toBe("NotebookDO (In-Memory Vectors)");
    await expect(page.locator(":focus")).toHaveAttribute("aria-posinset", "2");

    // Pfeil links auf einem Blatt: zum Elternknoten
    await page.keyboard.press("ArrowLeft");
    expect(await focusedLabel(page)).toBe("Compute");
    // Pfeil links auf offenem Zweig: zuklappen, Fokus bleibt
    await page.keyboard.press("ArrowLeft");
    await expect(compute).toHaveAttribute("aria-expanded", "false");
    await expect(items).toHaveCount(5);
    expect(await focusedLabel(page)).toBe("Compute");
    // Nochmals links: Wurzel
    await page.keyboard.press("ArrowLeft");
    expect(await focusedLabel(page)).toBe("Cloudflare Edge Stack");
    // Pfeil rechts auf eingeklapptem Zweig klappt auf
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect(compute).toHaveAttribute("aria-expanded", "true");
    expect(await focusedLabel(page)).toBe("Compute");

    await page.keyboard.press("End");
    expect(await focusedLabel(page)).toBe("int8 Quantized Vectors");
    await page.keyboard.press("Home");
    expect(await focusedLabel(page)).toBe("Cloudflare Edge Stack");
    await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

    // Shift+Tab verlässt den Baum in einem Schritt
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("tab", { name: "Baumliste", exact: true })).toBeFocused();
  });

  test("Grafik: für Hilfstechnik ausgeblendet, nicht fokussierbar, Hinweis auf die Liste", async ({
    page
  }) => {
    await openMindmap(page);
    const svg = page.getByTestId("mindmap-svg");
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    const focusable = await svg.evaluate(
      (el) =>
        el.querySelectorAll("[tabindex], a, button, [aria-label], [role]").length +
        (el.getAttribute("tabindex") ? 1 : 0)
    );
    expect(focusable).toBe(0);
    const panel = page.getByRole("tabpanel", { name: "Grafik" });
    await expect(panel).toHaveAccessibleDescription(/Reiter Baumliste/);
    // Die Knoten tauchen im Barrierefreiheitsbaum nicht auf
    await expect(page.getByRole("img", { name: /Mindmap-Grafik/ })).toHaveCount(0);
    // Tab springt vom Reiter nicht in einzelne SVG-Knoten
    await page.getByRole("tab", { name: "Grafik", exact: true }).focus();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      const inSvg = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("svg[data-testid='mindmap-svg']"))
      );
      expect(inSvg).toBe(false);
    }
  });

  test("Knöpfe: sichtbarer Text ist der Name", async ({ page }) => {
    await openMindmap(page);
    await expect(page.getByRole("button", { name: "Einpassen", exact: true })).toHaveText(
      "Einpassen"
    );
    await expect(page.getByRole("button", { name: "Vergrößern", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verkleinern", exact: true })).toBeVisible();
  });
});

for (const width of [360, 390]) {
  test(`${width} px: Reiterbeschriftung einzeilig, Ziele mindestens 44 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await openMindmap(page);
    const tabs = page.getByRole("tab");
    for (let i = 0; i < 2; i += 1) {
      const m = await tabs.nth(i).evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        const box = el.getBoundingClientRect();
        return { lines: lines.size, w: box.width, h: box.height, sw: el.scrollWidth };
      });
      expect(m.lines, `Reiter ${i}`).toBe(1);
      expect(m.h).toBeGreaterThanOrEqual(43.5);
      expect(m.w).toBeGreaterThanOrEqual(43.5);
      expect(m.sw).toBeLessThanOrEqual(Math.ceil(m.w));
    }
  });
}
