import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * Lokale Verarbeitung hochgeladener Quellen im Ingest-Web-Worker (Issues #87, #88, #152,
 * #153, #154): PDF, Word, Text und Bilder (OCR) werden im Browser gelesen, die Zeile zeigt
 * einen zugänglichen Fortschrittsbalken und wechselt danach auf "bereit".
 */
const fixture = (name: string) =>
  readFileSync(new URL(`../src/__tests__/fixtures/${name}`, import.meta.url));

interface StatusLog {
  statuses: string[];
  bars: Array<{ now: string | null; text: string | null; label: string | null }>;
}

/** Zeichnet Status und Fortschrittsbalken der neuen Quellzeile auf (auch kurze Zustände). */
async function recordSourceStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: StatusLog = { statuses: [], bars: [] };
    (window as unknown as { __sourceLog: StatusLog }).__sourceLog = log;
    const list = document.querySelector("[data-testid='sources-list']");
    if (!list) throw new Error("sources-list fehlt");
    const capture = () => {
      for (const item of list.querySelectorAll("li[data-testid^='source-item-src_up_']")) {
        const status = item.getAttribute("data-status") ?? "";
        if (log.statuses.at(-1) !== status) log.statuses.push(status);
        const bar = item.querySelector("[role='progressbar']");
        if (bar) {
          log.bars.push({
            now: bar.getAttribute("aria-valuenow"),
            text: bar.getAttribute("aria-valuetext"),
            label: bar.getAttribute("aria-label")
          });
        }
      }
    };
    new MutationObserver(capture).observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-status", "aria-valuenow"]
    });
  });
}

async function readLog(page: Page): Promise<StatusLog> {
  return page.evaluate(() => (window as unknown as { __sourceLog: StatusLog }).__sourceLog);
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await recordSourceStates(page);
  await page.getByTestId("file-upload-input").setInputFiles({ name, mimeType, buffer });
}

const newSource = (page: Page) => page.locator("li[data-testid^='source-item-src_up_']");

test.describe("Quellen lokal verarbeiten", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  // Erster Aufruf lädt PDF.js, mammoth bzw. Tesseract samt Sprachdaten nach
  test.setTimeout(180_000);
  test.beforeEach(({ page }) => {
    page.on("console", (m) => {
      if (process.env.E2E_DEBUG) console.log(`[console] ${m.type()} ${m.text()}`);
    });
    page.on("pageerror", (e) => {
      if (process.env.E2E_DEBUG) console.log(`[pageerror] ${e.message}`);
    });
    page.on("worker", (w) => {
      if (process.env.E2E_DEBUG) console.log(`[worker] ${w.url()}`);
    });
  });

  test("PDF: Fortschritt processing → ready, Text aller Seiten in der Vorschau", async ({
    page
  }) => {
    await page.goto("/");
    await upload(page, "drei-seiten.pdf", "application/pdf", fixture("three-pages.pdf"));
    const item = newSource(page);
    await expect(item).toHaveAttribute("data-status", "ready", { timeout: 60_000 });

    const log = await readLog(page);
    expect(log.statuses).toEqual(["processing", "ready"]);
    expect(log.bars.length).toBeGreaterThan(0);
    expect(log.bars[0]?.label).toBe("Verarbeitung von drei-seiten");
    expect(log.bars.some((b) => b.text?.startsWith("PDF wird ausgelesen"))).toBe(true);
    await expect(item.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByTestId("toast-text")).toContainText("Quelle hinzugefügt: drei-seiten");

    await item.getByRole("button", { name: "Quelle drei-seiten ansehen" }).click();
    const content = page.getByTestId("inspector-source-content");
    await expect(content).toContainText("Seite eins: Einleitung");
    await expect(content).toContainText("Seite drei: Zusammenfassung und Ausblick.");
  });

  test("Word (DOCX): Überschriften, Listen und Tabelle landen im Volltext", async ({ page }) => {
    await page.goto("/");
    await upload(
      page,
      "bericht.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fixture("structured.docx")
    );
    const item = newSource(page);
    await expect(item).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
    const log = await readLog(page);
    expect(log.statuses).toEqual(["processing", "ready"]);
    expect(log.bars.some((b) => b.text?.startsWith("Word-Datei wird ausgelesen"))).toBe(true);
    // Nach der Verarbeitung ist die Quelle für den Chat ausgewählt
    await expect(item.getByRole("checkbox")).toBeChecked();

    await item.getByRole("button", { name: "Quelle bericht ansehen" }).click();
    const content = page.getByTestId("inspector-source-content");
    await expect(content).toContainText("# Projektbericht Quellen");
    await expect(content).toContainText("1. Datei hochladen");
    await expect(content).toContainText("| DOCX | mammoth & Co |");
  });

  test("Bild (OCR): Texterkennung mit Fortschritt, alle Dateien von der eigenen Origin", async ({
    page,
    baseURL
  }) => {
    const ownOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
    const foreign: string[] = [];
    const ocrFiles: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      const local = ["blob:", "data:"].includes(url.protocol) || url.origin === ownOrigin;
      if (!local) foreign.push(request.url());
      if (url.pathname.startsWith("/ocr/")) ocrFiles.push(url.pathname);
    });
    await page.goto("/");
    await upload(page, "schild.png", "image/png", fixture("ocr-text.png"));
    const item = newSource(page);
    await expect(item).toHaveAttribute("data-status", "ready", { timeout: 120_000 });

    const log = await readLog(page);
    expect(log.statuses).toEqual(["processing", "ready"]);
    const ocrBars = log.bars.filter((b) => b.text?.startsWith("Texterkennung läuft"));
    expect(ocrBars.length).toBeGreaterThan(1);
    const values = log.bars.map((b) => Number(b.now));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] as number);
    }

    await item.getByRole("button", { name: "Quelle schild ansehen" }).click();
    await expect(page.getByTestId("inspector-source-content")).toContainText(
      "Quellen lesen im Browser"
    );
    expect(foreign).toEqual([]);
    expect(ocrFiles).toEqual(
      expect.arrayContaining([
        "/ocr/worker.min.js",
        "/ocr/lang/deu.traineddata.gz",
        "/ocr/lang/eng.traineddata.gz"
      ])
    );
  });

  test("Unlesbares Bild und unbekanntes Format: Fehler in der Zeile, kein Balken", async ({
    page
  }) => {
    await page.goto("/");
    await upload(page, "leer.png", "image/png", fixture("ocr-blank.png"));
    const item = newSource(page);
    await expect(item).toHaveAttribute("data-status", "error", { timeout: 120_000 });
    await expect(item).toContainText("Kein lesbarer Text gefunden.");
    await expect(item.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByTestId("toast-text")).toContainText("Quelle nicht hinzugefügt: leer");

    await page.getByTestId("file-upload-input").setInputFiles({
      name: "film.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("x")
    });
    await expect(page.getByText("Dieses Dateiformat wird nicht unterstützt.")).toBeVisible({
      timeout: 30_000
    });
  });

  test("Text-Datei wird bereit, Fortschritt auf Englisch beschriftet", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-open-settings").click();
    await page.getByTestId("settings-drawer").getByTestId("lang-option-en").check();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-drawer")).toBeHidden();

    await upload(page, "notes.txt", "text/plain", Buffer.from("Plain notes for the notebook."));
    const item = newSource(page);
    await expect(item).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
    const log = await readLog(page);
    expect(log.statuses).toEqual(["processing", "ready"]);
    expect(log.bars.every((b) => b.label === "Processing notes")).toBe(true);
    expect(log.bars.every((b) => /^(Reading file|Splitting text): \d+%$/.test(b.text ?? ""))).toBe(
      true
    );
    await expect(page.getByTestId("sources-count-badge")).toHaveText("3 sources");
    await expect(page.getByTestId("toast-text")).toContainText("Source added: notes");
  });
});
