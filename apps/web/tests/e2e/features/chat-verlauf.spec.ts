import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Issue #243: Abbruch, ehrliche Nichtantwort, Verlauf nach dem Neuladen und Markdown-Export.
 */

const ANSWER_SSE = [
  'event: token\ndata: {"delta":"D1 nutzt FTS5 [1].","chatId":"chat_e2e"}\n\n',
  'event: citations\ndata: {"citations":[{"index":1,"chunkId":"c1","sourceId":"src_2","page":4,"quote":"FTS5 tables with BM25 ranking"}],"validIndices":[1],"hallucinatedIndices":[]}\n\n',
  'event: metadata\ndata: {"aiGenerated":true,"provider":"google","model":"gemini-2.5-flash","timestamp":"2026-11-13T10:00:00.000Z"}\n\n',
  'event: done\ndata: {"chatId":"chat_e2e"}\n\n'
].join("");

test.describe("Chatverlauf", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Markdown-Export enthält Frage, Antwort und Quelle mit Seite und Zitat", async ({
    page
  }) => {
    let body: Record<string, unknown> = {};
    await page.route("**/api/v1/notebooks/*/chat", (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER_SSE });
    });
    await page.goto("/");
    await expect(page.getByTestId("btn-export-chat-md")).toHaveCount(0);

    await page.getByTestId("chat-input-field").fill("Wie sucht D1?");
    await page.getByTestId("chat-input-field").press("Enter");
    await expect(page.getByText("D1 nutzt FTS5")).toBeVisible();
    // Die Oberflächensprache geht mit, damit die Nichtantwort passt
    expect(body.language).toBe("de");

    const exportButton = page.getByRole("button", { name: /^Als Markdown sichern/ });
    await expect(exportButton).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/_Chat\.md$/);
    const file = await download.path();
    const markdown = readFileSync(file, "utf8");
    expect(markdown).toContain("## Sie\n\nWie sucht D1?");
    expect(markdown).toContain("D1 nutzt FTS5 [1].");
    expect(markdown).toMatch(/\*\*Quellen\*\*\n\n1\. .+, S\. 4: „FTS5 tables with BM25 ranking“/);
    expect(markdown).toContain("_KI-generiert: gemini-2.5-flash_");
    // Begrüßung gehört nicht in den Export
    expect(markdown.match(/## /g)).toHaveLength(2);
  });

  test("Verlauf kommt nach dem Neuladen zurück, Seite für Seite", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/api/v1/notebooks/*/chat", (route) =>
      route.fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER_SSE })
    );
    await page.route("**/api/v1/chats/*/messages*", (route) => {
      const url = new URL(route.request().url());
      requested.push(url.search);
      const before = url.searchParams.get("before");
      const json = before
        ? {
            chatId: "chat_e2e",
            messages: [{ id: "m1", chatId: "chat_e2e", role: "user", content: "Erste Frage" }],
            nextCursor: null
          }
        : {
            chatId: "chat_e2e",
            messages: [
              { id: "m2", chatId: "chat_e2e", role: "assistant", content: "Erste Antwort" }
            ],
            nextCursor: "2~m2"
          };
      return route.fulfill({ status: 200, json });
    });
    await page.goto("/");
    await page.getByTestId("chat-input-field").fill("Wie sucht D1?");
    await page.getByTestId("chat-input-field").press("Enter");
    await expect(page.getByText("D1 nutzt FTS5")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Erste Antwort")).toBeVisible();
    const log = page.getByRole("log");
    await expect(log.locator(".rn-msg").nth(1)).toContainText("Erste Frage");
    await expect(log.locator(".rn-msg").nth(2)).toContainText("Erste Antwort");
    // StrictMode startet Effekte im Dev-Server doppelt; entscheidend ist die Seitenfolge
    expect([...new Set(requested)]).toEqual(["?limit=100", "?limit=100&before=2%7Em2"]);
  });

  test("Stopp bricht die laufende Anfrage ab", async ({ page }) => {
    let aborted = false;
    await page.route("**/api/v1/notebooks/*/chat", async (route) => {
      // Antwort bleibt aus, bis der Client abbricht
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      await route
        .fulfill({ status: 200, contentType: "text/event-stream", body: ANSWER_SSE })
        .catch(() => {
          aborted = true;
        });
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("/chat")) aborted = true;
    });
    await page.goto("/");
    await page.getByTestId("chat-input-field").fill("Lange Frage");
    await page.getByTestId("chat-input-field").press("Enter");
    const stop = page.getByTestId("btn-stop-chat");
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(
      page.locator(".rn-msg-note").filter({ hasText: "Generierung abgebrochen." })
    ).toBeVisible();
    await expect(page.getByTestId("btn-send-chat")).toBeVisible();
    await expect.poll(() => aborted, { timeout: 10_000 }).toBe(true);
  });
});
