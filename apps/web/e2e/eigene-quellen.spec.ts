import { type Page, expect, test } from "@playwright/test";
import { buildDocx } from "../src/__tests__/zip-fixture";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * P6: eigene Quellen hochladen. Der echte Ingest-Worker liest TXT, Markdown und PDF im
 * Browser; die Worker-Routen des Servers sind hier nachgestellt. Geprüft wird die ganze
 * Kette der Oberfläche bis zur Chat-Anfrage mit der neuen Quelle.
 */

/** Kleinstes PDF mit einer Textzeile (PDF.js baut die Querverweise selbst nach). */
const PDF_WITH_TEXT = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R",
  "/Resources << /Font << /F1 5 0 R >> >> >> endobj",
  "4 0 obj << /Length 58 >> stream",
  "BT /F1 18 Tf 72 700 Td (Der Rhein fliesst durch Koeln.) Tj ET",
  "endstream endobj",
  "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF"
].join("\n");

interface ServerLog {
  inits: Array<Record<string, unknown>>;
  chunks: Array<{
    sourceId: string;
    body: { chunks: Array<{ text: string }>; markReady: boolean };
  }>;
  chat: Record<string, unknown> | null;
}

/** Stellt die Worker-Routen nach; die Quelle bekommt eine ID aus dem Dateinamen. */
async function mockWorker(page: Page, initStatus = 201): Promise<ServerLog> {
  const log: ServerLog = { inits: [], chunks: [], chat: null };
  await page.route("**/api/v1/notebooks/*/sources", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    log.inits.push(body);
    if (initStatus !== 201) {
      return route.fulfill({
        status: initStatus,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: initStatus, code: "UNAUTHORIZED" })
      });
    }
    const sourceId = `srv_${String(body.filename).replace(/\W/g, "_")}`;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sourceId,
        mode: "worker-upload",
        uploadUrl: `/api/v1/sources/${sourceId}/upload`
      })
    });
  });
  await page.route("**/api/v1/sources/*/upload", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"uploaded"}' })
  );
  await page.route("**/api/v1/sources/*/upload/complete", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"ready"}' })
  );
  await page.route("**/api/v1/sources/*/chunks", (route) => {
    const sourceId = route.request().url().split("/").at(-2) ?? "";
    log.chunks.push({ sourceId, body: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"success":true}'
    });
  });
  await page.route("**/api/v1/notebooks/*/chat", (route) => {
    log.chat = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'event: token\ndata: {"delta":"Durch Dresden [1].","chatId":"chat_p6"}\n\n',
        'event: citations\ndata: {"citations":[{"index":1,"chunkId":"c1","sourceId":"srv_elbe_md","quote":"Die Elbe"}],"validIndices":[1],"hallucinatedIndices":[]}\n\n',
        'event: done\ndata: {"chatId":"chat_p6"}\n\n'
      ].join("")
    });
  });
  return log;
}

test.describe("Eigene Quellen hochladen (P6)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Markdown und PDF werden gelesen, indexiert und im Chat mitgeschickt", async ({ page }) => {
    const log = await mockWorker(page);
    await page.goto("/");

    await page.getByTestId("file-upload-input").setInputFiles([
      // Ohne Browser-Typ wie unter Windows: erkannt an der Endung
      {
        name: "elbe.md",
        mimeType: "",
        buffer: Buffer.from("# Flüsse\n\nDie Elbe fließt durch Dresden.")
      },
      { name: "rhein.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF_WITH_TEXT) }
    ]);

    await expect(page.getByTestId("source-item-srv_elbe_md")).toBeVisible();
    await expect(page.getByTestId("source-item-srv_rhein_pdf")).toBeVisible();
    await expect(page.getByTestId("sources-count-badge")).toHaveText("4 Quellen");
    await expect(page.locator("[data-testid^='source-status-']")).toHaveCount(0);
    await expect(page.getByTestId("source-checkbox-srv_rhein_pdf")).toBeChecked();

    expect(log.inits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "elbe.md", mimeType: "text/markdown" }),
        expect.objectContaining({ filename: "rhein.pdf", mimeType: "application/pdf" })
      ])
    );
    const pdfChunks = log.chunks.find((c) => c.sourceId === "srv_rhein_pdf");
    expect(pdfChunks?.body.markReady).toBe(true);
    expect(pdfChunks?.body.chunks.map((c) => c.text).join(" ")).toContain("Rhein");
    const mdChunks = log.chunks.find((c) => c.sourceId === "srv_elbe_md");
    expect(mdChunks?.body.chunks.map((c) => c.text).join(" ")).toContain("Die Elbe");

    // Volltext steht in der Vorschau
    await page.getByTestId("btn-inspect-source-srv_elbe_md").click();
    await expect(page.getByTestId("inspector-source-content")).toContainText(
      "Die Elbe fließt durch Dresden."
    );

    await page.getByTestId("chat-input-field").fill("Wo fließt die Elbe?");
    await page.getByTestId("chat-input-field").press("Enter");
    // Auf die Antwort begrenzt: die geöffnete Vorschau enthält denselben Satz
    await expect(
      page.locator("[data-testid^='message-content-']").getByText("Durch Dresden")
    ).toBeVisible();
    expect(log.chat?.sourceIds).toEqual(expect.arrayContaining(["srv_elbe_md", "srv_rhein_pdf"]));
  });

  test("Word-Datei (.docx) wird im Worker mit mammoth gelesen und indexiert", async ({ page }) => {
    const log = await mockWorker(page);
    await page.goto("/");

    await page.getByTestId("file-upload-input").setInputFiles({
      name: "weser.docx",
      mimeType: DOCX_MIME,
      buffer: Buffer.from(buildDocx(["Die Weser fließt durch Bremen.", "Zweiter Absatz."]))
    });

    await expect(page.getByTestId("source-item-srv_weser_docx")).toBeVisible();
    await expect(page.locator("[data-testid^='source-status-']")).toHaveCount(0);
    expect(log.inits).toEqual([
      expect.objectContaining({ filename: "weser.docx", mimeType: DOCX_MIME })
    ]);
    const chunks = log.chunks.find((c) => c.sourceId === "srv_weser_docx");
    expect(chunks?.body.chunks.map((c) => c.text).join(" ")).toContain("Die Weser fließt");

    await page.getByTestId("btn-inspect-source-srv_weser_docx").click();
    await expect(page.getByTestId("inspector-source-content")).toContainText("Zweiter Absatz.");
  });

  test("Zip-Bombe als .docx wird abgelehnt, ohne den Server zu belasten", async ({ page }) => {
    const log = await mockWorker(page);
    await page.goto("/");

    await page.getByTestId("file-upload-input").setInputFiles({
      name: "bombe.docx",
      mimeType: DOCX_MIME,
      buffer: Buffer.from(buildDocx(["A".repeat(20 * 1024 * 1024)]))
    });

    const status = page.locator("[data-testid^='source-status-']");
    await expect(status).toHaveAttribute("data-status", "error");
    await expect(status).toContainText("ungewöhnlich aufgebaut");
    expect(log.inits).toHaveLength(0);
  });

  test("ohne Anmeldung bleibt die Datei mit Grund sichtbar und geht nicht in den Chat", async ({
    page
  }) => {
    const log = await mockWorker(page, 401);
    await page.goto("/");

    await page
      .getByTestId("file-upload-input")
      .setInputFiles({ name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("Notiz") });

    const status = page.locator("[data-testid^='source-status-']");
    await expect(status).toHaveAttribute("data-status", "error");
    await expect(page.locator("[data-testid^='source-checkbox-src_up_']")).toBeDisabled();
    expect(log.chunks).toHaveLength(0);

    await page.getByTestId("chat-input-field").fill("Was steht in der Notiz?");
    await page.getByTestId("chat-input-field").press("Enter");
    await expect.poll(() => log.chat).not.toBeNull();
    const ids = (log.chat?.sourceIds as string[] | undefined) ?? [];
    expect(ids.some((id) => id.startsWith("src_up_"))).toBe(false);
  });
});
