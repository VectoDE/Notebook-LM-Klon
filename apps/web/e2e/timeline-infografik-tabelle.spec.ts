import { readFile } from "node:fs/promises";
import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems, openPanel } from "./helpers";

/** Issue #239: Timeline, Infografik und Datentabelle mit Beleg, Prüfung und Export. */

const MIGRATION =
  "D1 Migration 0002 introduces FTS5 tables with BM25 ranking for hybrid lexical and vector search.";

async function openStudio(page: Page): Promise<void> {
  await page.goto("/");
  await openPanel(page, "studio");
}

async function backToOverview(page: Page): Promise<void> {
  await page.getByTestId("btn-back-to-studio-overview").click();
}

for (const width of [1440, 390]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Timeline: Eintrag mit Zitat, Sprung zur markierten Stelle", async ({ page }) => {
      await openStudio(page);
      await page.getByTestId("btn-open-timeline-tool").click();
      const view = page.getByTestId("timeline-viewer");
      await expect(view.getByRole("heading", { name: "Timeline" })).toBeVisible();
      await expect(page.getByTestId("timeline-tl:1")).toContainText("Migration 0002");
      await expect(view.getByRole("blockquote")).toHaveText(MIGRATION);
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.getByTestId("timeline-tl:1-jump").click();
      await expect(page.getByTestId("highlighted-citation-passage")).toHaveText(MIGRATION);
    });

    test("Datentabelle: Quellenspalte, Prüfung per Tastatur, CSV ohne Abgelehntes", async ({
      page
    }) => {
      await openStudio(page);
      await page.getByTestId("btn-open-table-tool").click();
      const table = page.getByTestId("datatable");
      await expect(table.getByRole("columnheader")).toHaveText(["Component", "Role", "Quelle"]);
      await expect(table.getByRole("rowheader")).toHaveText([
        "Cloudflare Worker",
        "NotebookDO",
        "FTS5"
      ]);
      expect(await findLayoutProblems(page)).toEqual([]);

      // Ablehnen per Tastatur, Status sichtbar, Fokus bleibt auf einem Bedienelement der Zeile
      await page.getByTestId("datatable-row:2-reject").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("datatable-row:2-status")).toHaveText("Abgelehnt");
      await page.getByTestId("datatable-row:1-confirm").click();
      await expect(page.getByTestId("datatable-row:1-status")).toHaveText("Bestätigt");

      const downloadPromise = page.waitForEvent("download");
      await page.getByTestId("btn-export-table-csv").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/_tabelle\.csv$/);
      const path = await download.path();
      const csv = await readFile(path, "utf8");
      expect(csv.startsWith("﻿Component,Role,Quelle,Zitat\r\n")).toBe(true);
      expect(csv).toContain("Cloudflare Worker,single unified entry point,");
      expect(csv).not.toContain("NotebookDO");
      expect(csv).toContain("FTS5,BM25 ranking,");
    });

    test("Infografik: Bild mit Alternativtext, Export als SVG und PNG", async ({ page }) => {
      await openStudio(page);
      await page.getByTestId("btn-open-infographic-tool").click();
      const image = page.getByTestId("infographic-image");
      await expect(image).toHaveAttribute(
        "alt",
        /Vector quantization: int8; D1 migration: 0002; Ranking: BM25/
      );
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      expect(await findLayoutProblems(page)).toEqual([]);

      const svgDownload = page.waitForEvent("download");
      await page.getByTestId("btn-export-infographic-svg").click();
      const svg = await readFile(await (await svgDownload).path(), "utf8");
      expect(svg).toContain('role="img"');
      expect(svg).toContain("int8");

      const pngDownload = page.waitForEvent("download");
      await page.getByTestId("btn-export-infographic-png").click();
      const png = await readFile(await (await pngDownload).path());
      // PNG-Signatur
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

      // Abgelehnte Kennzahl fehlt in der Grafik
      await page.getByTestId("infographic-fact:1-reject").click();
      await expect(image).toHaveAttribute("alt", /D1 migration: 0002; Ranking: BM25$/);
    });
  });
}

test.describe("Parallel nutzbar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Prüfstand bleibt beim Wechsel zu anderen Werkzeugen erhalten", async ({ page }) => {
    await openStudio(page);
    await page.getByTestId("btn-open-table-tool").click();
    await page.getByTestId("datatable-row:3-reject").click();
    await backToOverview(page);
    await page.getByTestId("btn-open-quiz-tool").click();
    await backToOverview(page);
    await page.getByTestId("btn-open-timeline-tool").click();
    await page.getByTestId("timeline-tl:1-confirm").click();
    await backToOverview(page);
    await page.getByTestId("btn-open-table-tool").click();
    await expect(page.getByTestId("datatable-row:3-status")).toHaveText("Abgelehnt");
    await backToOverview(page);
    await page.getByTestId("btn-open-timeline-tool").click();
    await expect(page.getByTestId("timeline-tl:1-status")).toHaveText("Bestätigt");
  });
});

test.describe("Englische Oberfläche", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Bedientexte englisch", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await openStudio(page);
    await expect(page.getByTestId("tool-card-table")).toContainText("Data table");
    await page.getByTestId("btn-open-table-tool").click();
    await expect(page.getByTestId("datatable").getByRole("columnheader")).toHaveText([
      "Component",
      "Role",
      "Source"
    ]);
    await expect(page.getByTestId("btn-export-table-csv")).toHaveAccessibleName(
      "Download the data table as CSV"
    );
  });
});
