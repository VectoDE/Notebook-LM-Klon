import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers";

/** Issue #238: Beziehungsgraph (Personen, Organisationen, Themen) mit Beleg, Filter und Prüfung. */

async function openEntityGraph(page: Page): Promise<void> {
  await page.goto("/");
  const bottom = page.getByTestId("tab-btn-graph");
  const top = page.getByTestId("top-tab-graph");
  if (await bottom.isVisible()) await bottom.click();
  else if (await top.isVisible()) await top.click();
  else await page.getByTestId("btn-open-graph-tool").click();
  await page.getByTestId("graph-mode-entities").click();
  await expect(page.getByTestId("entity-graph")).toBeVisible();
}

const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

test.describe("Desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Grafik: Spalten je Art, Tastatur, Details mit Zitat und Sprung zur Stelle", async ({
    page
  }) => {
    await openEntityGraph(page);
    await expect(page.getByTestId("graph-mode-entities")).toHaveAttribute("aria-pressed", "true");
    // In der schmalen Chat-Spalte untereinander, mit breiter Mitte als Spalten je Art.
    await expect(page.getByTestId("entity-graph-svg")).toHaveAttribute("data-layout", "stack");
    await page.getByTestId("btn-collapse-sources").click();
    await page.getByTestId("btn-collapse-studio").click();
    await expect(page.getByTestId("entity-graph-svg")).toHaveAttribute("data-layout", "columns");
    await expect(page.locator(".rn-eg-node")).toHaveCount(9);

    const first = page.getByTestId("entity-node-organization:cloudflare");
    await first.focus();
    expect(await focusedName(page)).toBe("Cloudflare, Organisation, Bestätigt, 1 Beziehungen");
    await page.keyboard.press("ArrowRight");
    expect(await focusedName(page)).toContain("Cloudflare Worker, Thema");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const details = page.getByTestId("entity-graph-details");
    await expect(details.getByRole("blockquote")).toHaveText(
      "FTS5 tables with BM25 ranking for hybrid lexical and vector search."
    );
    expect(await findLayoutProblems(page)).toEqual([]);
    // Der Sprung klappt die Quellenspalte wieder auf; geprüft wird die markierte Stelle
    await details.getByRole("button", { name: /Zitat in der Quelle/ }).click();
    await expect(page.getByTestId("highlighted-citation-passage")).toHaveText(
      "FTS5 tables with BM25 ranking for hybrid lexical and vector search."
    );
  });

  test("Zoom und Einpassen", async ({ page }) => {
    await openEntityGraph(page);
    const value = page.getByTestId("entity-zoom-value");
    const before = await value.textContent();
    await page.getByTestId("entity-zoom-in").click();
    await expect(value).not.toHaveText(before ?? "");
    await page.getByTestId("entity-fit").click();
    await expect(value).toHaveText(before ?? "");
  });

  test("Filter nach Art und Prüfstatus wirken auf Grafik und Liste", async ({ page }) => {
    await openEntityGraph(page);
    await page.getByTestId("entity-filter-topic").uncheck();
    await expect(page.locator(".rn-eg-node")).toHaveCount(1);
    await page.getByTestId("entity-filter-topic").check();
    await page.getByTestId("entity-filter-status").selectOption("confirmed");
    // Bestätigt: Cloudflare, Cloudflare Worker, NotebookDO, D1 und die Enden bestätigter Kanten
    await expect(page.locator(".rn-eg-node")).toHaveCount(5);
    await page.getByTestId("entity-filter-status").selectOption("rejected");
    await expect(page.getByTestId("entity-graph-empty")).toBeVisible();
  });

  test("Liste: bestätigen, ablehnen, wiederherstellen und berichtigen per Tastatur", async ({
    page
  }) => {
    await openEntityGraph(page);
    await page.getByTestId("entity-tab-visual").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("entity-graph-list")).toBeVisible();

    await page.getByTestId("entity-item-topic:fts5-confirm").click();
    await expect(page.getByTestId("entity-item-topic:fts5")).toHaveAttribute(
      "data-status",
      "confirmed"
    );
    await expect(page.getByTestId("entity-graph-live")).toHaveText("Bestätigt: FTS5");

    await page.getByTestId("entity-relation-edge:5-reject").click();
    await expect(page.getByTestId("entity-relation-edge:5")).toHaveCount(0);
    await page.getByTestId("entity-filter-status").selectOption("rejected");
    await page.getByTestId("entity-relation-edge:5-restore").click();
    await page.getByTestId("entity-filter-status").selectOption("open");
    await expect(page.getByTestId("entity-relation-edge:5")).toHaveAttribute(
      "data-status",
      "suggested"
    );

    await page.getByTestId("entity-item-topic:d1-edit").click();
    const input = page.getByTestId("entity-item-topic:d1-form").getByRole("textbox");
    await expect(input).toBeFocused();
    await input.fill("Cloudflare D1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("entity-item-topic:d1")).toContainText("Cloudflare D1");
    await expect(page.getByTestId("entity-graph-live")).toHaveText("Berichtigt: Cloudflare D1");

    await page.getByTestId("entity-relation-edge:4-edit").click();
    const relation = page.getByTestId("entity-relation-edge:4-form").getByRole("textbox");
    await relation.fill("legt an");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("entity-relation-edge:4")).toContainText("– legt an →");
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

test.describe("Telefon 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("eine Spalte, keine Layoutprobleme, Sprung zur Stelle aus der Liste", async ({ page }) => {
    await openEntityGraph(page);
    await expect(page.getByTestId("entity-graph-svg")).toHaveAttribute("data-layout", "stack");
    expect(await findLayoutProblems(page)).toEqual([]);
    await page.getByTestId("entity-tab-list").click();
    await page.getByTestId("entity-relation-jump-edge:1").click();
    await expect(page.getByTestId("highlighted-citation-passage")).toHaveText(
      "Cloudflare Worker serves as the single unified entry point."
    );
  });
});

test.describe("Englische Oberfläche", () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: "en-US" });

  test("Bedientexte englisch", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    const bottom = page.getByTestId("btn-open-graph-tool");
    if (await bottom.isVisible()) await bottom.click();
    else await page.getByTestId("top-tab-graph").click();
    await page.getByTestId("graph-mode-entities").click();
    await expect(page.getByTestId("graph-mode-entities")).toHaveText(
      "People, organizations, topics"
    );
    await expect(page.getByTestId("entity-graph-sub")).toHaveText(
      "9 entries, 6 relations, 9 to review"
    );
  });
});
