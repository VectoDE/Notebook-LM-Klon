import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, findSmallText } from "./helpers";

/** Issue #327: vier Reiter (Quellen, Chat, Studio, Graph) und Wissensgraph-Ansicht. */

const TABS = ["sources", "chat", "studio", "graph"] as const;

/** Öffnet den Graphen: Telefon über die untere Leiste, 600–899 px oben, Desktop über Studio. */
async function openGraph(page: Page): Promise<void> {
  const bottom = page.getByTestId("tab-btn-graph");
  const top = page.getByTestId("top-tab-graph");
  if (await bottom.isVisible()) await bottom.click();
  else if (await top.isVisible()) await top.click();
  else await page.getByTestId("btn-open-graph-tool").click();
  await expect(page.getByTestId("graph-panel")).toBeVisible();
}

const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

for (const width of [360, 390, 430]) {
  test.describe(`Untere Leiste ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("vier Reiter mit Symbol und Beschriftung, 44-px-Ziele, kein waagerechtes Scrollen", async ({
      page
    }) => {
      await page.goto("/");
      const nav = page.getByTestId("mobile-bottom-nav");
      await expect(nav.getByRole("button")).toHaveCount(4);
      await expect(nav.locator(".rn-tab-label")).toHaveText(["Quellen", "Chat", "Studio", "Graph"]);
      for (const tab of TABS) {
        const button = page.getByTestId(`tab-btn-${tab}`);
        const box = await button.boundingBox();
        expect(box?.width ?? 0, tab).toBeGreaterThanOrEqual(43.5);
        expect(box?.height ?? 0, tab).toBeGreaterThanOrEqual(43.5);
        expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width, tab).toBe(true);
        await expect(button.locator("svg")).toHaveCount(1);
        await expect(button.locator(".rn-tab-label")).toBeVisible();
        await button.click();
        await expect(button).toHaveAttribute("aria-current", "true");
        await expect(page.locator(`[data-panel='${tab}']`)).toBeFocused();
        expect(await findLayoutProblems(page), tab).toEqual([]);
      }
      // Name beginnt mit der sichtbaren Beschriftung (WCAG 2.5.3)
      await expect(page.getByTestId("tab-btn-graph")).toHaveAccessibleName(
        "Graph der Begriffe und Quellen"
      );
    });

    test("Graph auf dem Telefon: eingepasst, eine Spalte, Schrift lesbar", async ({ page }) => {
      await page.goto("/");
      await openGraph(page);
      const svg = page.getByTestId("graph-svg");
      await expect(svg).toHaveAttribute("data-layout", "stack");
      // Einpassen: die ganze Breite ist sichtbar, die Fläche scrollt nicht waagerecht
      const canvas = page.getByTestId("graph-canvas");
      const fits = await canvas.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits).toBe(true);
      const zoom = Number.parseInt(
        (await page.getByTestId("graph-zoom-value").innerText()).trim(),
        10
      );
      expect(zoom).toBeGreaterThanOrEqual(75);
      expect(zoom).toBeLessThanOrEqual(100);
      expect(await findSmallText(page, 14)).toEqual([]);
      expect(await findLayoutProblems(page)).toEqual([]);
      // Chat-Reiter schließt den Graphen wieder
      await page.getByTestId("tab-btn-chat").click();
      await expect(page.getByTestId("graph-panel")).toHaveCount(0);
      await expect(page.getByTestId("chat-panel")).toBeVisible();
    });
  });
}

test.describe("Telefon 360 px in allen Designs", () => {
  test.use({ viewport: { width: 360, height: 760 } });

  for (const design of DESIGNS) {
    test(`${design}: Graph und Liste ohne Layoutfehler, Ziele mindestens 44 px`, async ({
      page
    }) => {
      await page.goto("/");
      await chooseDesign(page, design, "dark");
      await openGraph(page);
      const small = () =>
        page.getByTestId("graph-panel").evaluate((root) =>
          Array.from(root.querySelectorAll("button"))
            .map((b) => ({ b, r: b.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 1 && r.height > 1)
            .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
            .map(({ b, r }) => `${b.className}: ${Math.round(r.width)}x${r.height}`)
        );
      expect(await findLayoutProblems(page)).toEqual([]);
      expect(await small()).toEqual([]);
      await page.getByTestId("graph-tab-list").click();
      await expect(page.getByTestId("graph-list")).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);
      expect(await small()).toEqual([]);
      // Keine Inline-Stile in der Ansicht
      const inline = await page
        .getByTestId("graph-panel")
        .evaluate((root) => root.querySelectorAll("[style]").length);
      expect(inline).toBe(0);
    });
  }
});

test.describe("Graph per Tastatur", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: ein Tab-Stopp, Pfeiltasten, Eingabe zeigt Details und Quelle`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      await openGraph(page);
      const nodes = page.locator(".rn-graph-node");
      await expect(nodes).toHaveCount(8);
      await expect(page.locator(".rn-graph-node[tabindex='0']")).toHaveCount(1);

      // Tab vom Einpassen-Knopf führt direkt auf den aktiven Knoten
      await page.getByTestId("graph-fit").focus();
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe("Compute, Begriff, 2 Verbindungen");
      const focusVisible = await page.evaluate(() =>
        document.activeElement?.matches(":focus-visible")
      );
      expect(focusVisible).toBe(true);

      // Pfeil runter: nächster Knoten darunter; Ende: letzter Knoten (eine Quelle)
      await page.keyboard.press("ArrowDown");
      expect(await focusedName(page)).toBe("Single Worker (Hono), Begriff, 2 Verbindungen");
      await expect(page.locator(".rn-graph-node[tabindex='0']")).toHaveCount(1);
      await page.keyboard.press("Home");
      expect(await focusedName(page)).toMatch(/^Compute,/);
      await page.keyboard.press("End");
      expect(await focusedName(page)).toBe(
        "D1 SQLite Relational & FTS5 Hybrid Search, Quelle, 1 Verbindungen"
      );

      // Eingabe: Details mit Beziehungen, Knoten gedrückt, verbundene Kanten hervorgehoben
      await page.keyboard.press("Enter");
      const details = page.getByTestId("graph-details");
      await expect(details).toContainText("Enthält die Begriffe");
      await expect(details).toContainText("D1 SQLite Relational");
      await expect(page.locator(".rn-graph-node[aria-pressed='true']")).toHaveCount(1);
      await expect(page.locator(".rn-graph-edge[data-active='true']")).toHaveCount(1);

      // Leertaste auf einem Begriff zeigt seine Quellen als Sprungziele
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press(" ");
      await expect(details).toContainText("Single Worker (Hono)");
      await expect(details).toContainText("Kommt vor in");

      // Tab verlässt den Graphen (ein Tab-Stopp) und erreicht den Sprung zur Quelle
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("graph-details-jump-source:src_1")).toBeFocused();
      await page.keyboard.press("Enter");
      // Die Quelle öffnet sich; auf dem Telefon liegt der Fokus in den Quellen
      await expect(page.locator("[data-panel='sources']")).toBeVisible();
      if (width < 600) {
        await expect(page.getByTestId("tab-btn-sources")).toHaveAttribute("aria-current", "true");
        const inSources = await page.evaluate(
          () => document.activeElement?.closest("[data-panel='sources']") !== null
        );
        expect(inSources).toBe(true);
      }
    });
  }

  test("Reiter Grafik/Liste nach APG, Liste mit Sprung zur Quelle", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await openGraph(page);
    const visual = page.getByTestId("graph-tab-visual");
    const list = page.getByTestId("graph-tab-list");
    await visual.focus();
    await page.keyboard.press("ArrowRight");
    await expect(list).toBeFocused();
    await expect(list).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("graph-svg")).toBeHidden();
    // Zoom wirkt nur auf die Grafik: in der Liste keine toten Tab-Stopps
    await expect(page.getByTestId("graph-zoom-in")).toHaveCount(0);
    const items = page.getByTestId("graph-list").locator(".rn-graph-item");
    await expect(items).toHaveCount(8);
    await expect(items.first()).toContainText("Compute");
    await expect(items.first()).toContainText(
      "Single Worker (Hono), NotebookDO (In-Memory Vectors)"
    );
    await page.keyboard.press("Home");
    await expect(visual).toBeFocused();
    await page.keyboard.press("End");
    await expect(list).toBeFocused();

    await page.getByTestId("graph-list-jump-source:src_2").click();
    await expect(page.getByTestId("sources-panel")).toBeVisible();
  });
});

test.describe("Desktop: Graph über das Studio", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("öffnet in der Chat-Spalte, drei Spalten bleiben, Rückweg zum Chat", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden();
    await expect(page.getByTestId("tool-card-graph")).toContainText("Wissensgraph");
    await page.getByTestId("btn-open-graph-tool").click();
    const center = page.getByTestId("panel-center-wrapper");
    await expect(center.getByTestId("graph-panel")).toBeVisible();
    await expect(page.locator("[data-panel='graph']")).toBeFocused();
    await expect(page.getByTestId("chat-panel")).toBeHidden();
    await expect(page.getByTestId("sources-panel")).toBeVisible();
    await expect(page.getByTestId("studio-panel")).toBeVisible();
    expect(await findLayoutProblems(page)).toEqual([]);

    // Zoom und Einpassen
    const value = page.getByTestId("graph-zoom-value");
    const fitted = await value.innerText();
    await page.getByTestId("graph-zoom-in").click();
    await expect(value).not.toHaveText(fitted);
    await page.getByTestId("graph-fit").click();
    await expect(value).toHaveText(fitted);

    // Entwurf im Chat bleibt erhalten, während der Graph offen ist
    await page.getByTestId("btn-close-graph").click();
    await expect(page.getByTestId("graph-panel")).toHaveCount(0);
    await expect(page.getByTestId("chat-panel")).toBeVisible();
    await expect(page.locator("[data-panel='chat']")).toBeFocused();
  });

  test("breite Mitte (Spalten eingeklappt): Graph als Spalten nebeneinander", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-open-graph-tool").click();
    await page.getByTestId("btn-collapse-sources").click();
    await page.getByTestId("btn-collapse-studio").click();
    await expect(page.getByTestId("graph-svg")).toHaveAttribute("data-layout", "columns");
    const xs = await page
      .locator(".rn-graph-node")
      .evaluateAll(
        (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().x))).size
      );
    expect(xs).toBe(3);
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

test.describe("600 bis 899 px", () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test("Reiterleiste oben mit Graph", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByTestId("top-nav");
    await expect(nav.getByRole("button")).toHaveCount(4);
    await page.getByTestId("top-tab-graph").click();
    await expect(page.getByTestId("top-tab-graph")).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-panel='graph']")).toBeFocused();
    // Kein Rückweg-Knopf: der Chat ist ein eigener Reiter
    await expect(page.getByTestId("btn-close-graph")).toHaveCount(0);
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

test.describe("Reduzierte Bewegung", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  test("keine Einblendung und keine Übergänge im Graphen", async ({ page }) => {
    await page.goto("/");
    await openGraph(page);
    const timing = await page.getByTestId("graph-panel").evaluate((root) => ({
      running: root
        .getAnimations({ subtree: true })
        .filter((a) => (a.effect?.getComputedTiming().duration as number) > 1).length,
      edge: getComputedStyle(root.querySelector(".rn-graph-edge") as Element).transitionDuration,
      box: getComputedStyle(root.querySelector(".rn-graph-box") as Element).transitionDuration
    }));
    expect(timing.running).toBe(0);
    expect(Number.parseFloat(timing.edge)).toBeLessThan(0.01);
    expect(Number.parseFloat(timing.box)).toBeLessThan(0.01);
  });
});

test.describe("Englisch", () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: "en-US" });

  test("Reiter und Ansicht übersetzt", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    await expect(page.getByTestId("tab-btn-graph")).toHaveAccessibleName(
      "Graph of concepts and sources"
    );
    await openGraph(page);
    await expect(page.getByTestId("graph-panel")).toContainText("Knowledge graph");
    await expect(page.getByTestId("graph-panel")).toContainText("6 concepts, 2 sources, 8 links");
  });
});
