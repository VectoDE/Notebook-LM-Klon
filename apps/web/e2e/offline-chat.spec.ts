import { type Page, expect, test } from "@playwright/test";

/**
 * Offline-Chat mit lokalem Modell (Issue #346) im echten Browser. Netz-Unterbrechung über
 * context.setOffline(true). Die WebLLM-Anbindung (src/local-llm-webllm.ts) wird durch ein
 * Modul im Test ersetzt: In CI wird nie ein echtes Modell geladen, WebGPU wird simuliert.
 */

const FAKE_RUNTIME = `
const KEY = "__fake_llm_cached";
const state = (window.__fakeLlm ??= { created: 0, deleted: 0, last: null });
export default {
  isModelCached: async () => localStorage.getItem(KEY) === "1",
  createEngine: async (onProgress) => {
    state.created++;
    onProgress({ progress: 0.4, text: "Lade" });
    await new Promise((r) => setTimeout(r, 150));
    onProgress({ progress: 1, text: "Fertig" });
    localStorage.setItem(KEY, "1");
    return {
      async *stream(messages) {
        state.last = messages;
        for (const part of ["Lokal: ", "D1 nutzt ", "FTS5 [1]."]) {
          await new Promise((r) => setTimeout(r, 20));
          yield part;
        }
      },
      unload: async () => {}
    };
  },
  deleteModel: async () => {
    state.deleted++;
    localStorage.removeItem(KEY);
  }
};
`;

const SERVER_SSE = [
  'event: token\ndata: {"delta":"Server: D1 nutzt FTS5 [1].","chatId":"chat_e2e"}\n\n',
  'event: citations\ndata: {"citations":[{"index":1,"chunkId":"c1","sourceId":"src_2","quote":"FTS5"}],"validIndices":[1],"hallucinatedIndices":[]}\n\n',
  'event: done\ndata: {"chatId":"chat_e2e"}\n\n'
].join("");

async function setup(
  page: Page,
  options: { webgpu: boolean }
): Promise<{ chatCalls: () => number }> {
  let chatCalls = 0;
  await page.addInitScript((webgpu) => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: webgpu ? { requestAdapter: async () => ({}) } : undefined
    });
  }, options.webgpu);
  await page.route("**/src/local-llm-webllm.ts*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: FAKE_RUNTIME })
  );
  await page.route("**/api/v1/notebooks/*/chat", (route) => {
    chatCalls++;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: SERVER_SSE });
  });
  return { chatCalls: () => chatCalls };
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByTestId("chat-input-field").fill(question);
  await page.getByTestId("chat-input-field").press("Enter");
}

/** Offline-Teil nachladen (Knopf im Start-Bundle), danach steht die volle Steuerung da. */
async function openOfflineChat(page: Page): Promise<void> {
  await page.getByTestId("btn-offline-chat-setup").click();
  await expect(page.getByTestId("offline-chat-control")).toBeVisible();
}

async function loadModel(page: Page): Promise<void> {
  await openOfflineChat(page);
  await page.getByTestId("btn-local-model-load").click();
  const dialog = page.getByTestId("local-model-consent");
  await expect(dialog).toBeVisible();
  await page.getByTestId("btn-local-consent-confirm").click();
  await expect(page.getByTestId("local-model-ready")).toHaveText("Offline-Modell bereit");
}

test.describe("Offline-Chat mit lokalem Modell", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lädt erst nach Zustimmung, antwortet offline lokal und online wieder vom Server", async ({
    page,
    context
  }) => {
    const server = await setup(page, { webgpu: true });
    const offlineModules: string[] = [];
    page.on("request", (request) => {
      if (/offline-chat-ui|local-llm/.test(request.url())) offlineModules.push(request.url());
    });
    await page.goto("/");
    const mode = page.getByTestId("chat-mode");
    await expect(mode).toHaveAttribute("data-mode", "online");
    await expect(mode).toHaveText("Online");
    // Ohne frühere Zustimmung lädt die Startseite nichts vom Offline-Teil
    await page.waitForLoadState("networkidle");
    expect(offlineModules).toEqual([]);

    await openOfflineChat(page);
    await expect(mode).toHaveText("Online · Antworten vom Server mit geprüften Zitaten");
    // Laufzeit (WebLLM) erst mit Zustimmung
    expect(offlineModules.some((url) => url.includes("local-llm-webllm"))).toBe(false);

    // Größe steht vor dem Laden da; Abbrechen lädt nichts
    await expect(page.getByTestId("btn-local-model-load")).toHaveText(
      "Offline-Modell laden (0,9 GB)"
    );
    await page.getByTestId("btn-local-model-load").click();
    await expect(page.getByTestId("local-consent-size")).toContainText("rund 0,9 GB");
    await page.getByTestId("btn-local-consent-cancel").click();
    await expect(page.getByTestId("local-model-consent")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as { __fakeLlm?: unknown }).__fakeLlm)
    ).toBeUndefined();

    await page.getByTestId("btn-local-model-load").click();
    await page.getByTestId("btn-local-consent-confirm").click();
    await expect(page.getByTestId("local-model-ready")).toHaveText("Offline-Modell bereit");

    // Netz weg: Modus wechselt sichtbar und wird angesagt (output = Rolle status)
    await context.setOffline(true);
    await expect(mode).toHaveAttribute("data-mode", "offline-local");
    await expect(
      page.getByRole("status").filter({ hasText: "Offline · das lokale Modell" })
    ).toHaveCount(1);

    await ask(page, "Wie nutzt D1 die FTS5-Suche?");
    const answer = page.locator("article.rn-msg--assistant").last();
    await expect(answer).toContainText("Lokal: D1 nutzt FTS5.");
    // Keine erfundenen Zitat-Pillen, ehrlicher Hinweis, verwendete Auszüge als Sprungziele
    await expect(answer.getByTestId("citation-pill-1")).toHaveCount(0);
    await expect(answer).toContainText("Zitate lassen sich offline nicht prüfen");
    await expect(answer).toContainText("KI-generiert · Qwen2.5 1.5B (lokal)");
    await expect(answer.getByTestId("offline-passage-1")).toBeVisible();
    const sent = await page.evaluate(
      () =>
        (window as { __fakeLlm?: { last: { role: string; content: string }[] } }).__fakeLlm?.last
    );
    expect(sent?.[0]?.content).toContain("FTS5");
    expect(sent?.at(-1)).toEqual({ role: "user", content: "Wie nutzt D1 die FTS5-Suche?" });
    expect(server.chatCalls()).toBe(0);

    await answer.getByTestId("offline-passage-1").click();
    await expect(page.locator("[data-panel='sources']")).toBeVisible();

    // Netz zurück: wieder Server-Chat mit geprüften Zitaten
    await context.setOffline(false);
    await expect(mode).toHaveAttribute("data-mode", "online");
    await ask(page, "Und online?");
    await expect(page.getByText("Server: D1 nutzt FTS5")).toBeVisible();
    expect(server.chatCalls()).toBe(1);
  });

  test("offline ohne geladenes Modell: klare Meldung, kein Download", async ({ page, context }) => {
    await setup(page, { webgpu: true });
    await page.goto("/");
    await expect(page.getByTestId("chat-mode")).toHaveAttribute("data-mode", "online");
    await context.setOffline(true);
    await expect(page.getByTestId("chat-mode")).toHaveAttribute("data-mode", "offline-no-model");
    await expect(page.getByTestId("chat-mode")).toHaveText("Offline · kein lokales Modell geladen");
    await expect(page.getByTestId("btn-offline-chat-setup")).toBeDisabled();
    await ask(page, "Geht das ohne Netz?");
    await expect(page.getByRole("alert").filter({ hasText: "noch nicht geladen" })).toBeVisible();
    expect(
      await page.evaluate(() => (window as { __fakeLlm?: unknown }).__fakeLlm)
    ).toBeUndefined();
  });

  test("offline nach dem Einrichten, aber ohne Modell: Ladeknopf gesperrt, gleiche Meldung", async ({
    page,
    context
  }) => {
    await setup(page, { webgpu: true });
    await page.goto("/");
    await openOfflineChat(page);
    await context.setOffline(true);
    await expect(page.getByTestId("chat-mode")).toHaveAttribute("data-mode", "offline-no-model");
    await expect(page.getByTestId("btn-local-model-load")).toBeDisabled();
    await ask(page, "Und jetzt?");
    await expect(page.getByRole("alert").filter({ hasText: "noch nicht geladen" })).toBeVisible();
  });

  test("ohne WebGPU: Hinweis und klare Meldung offline", async ({ page, context }) => {
    await setup(page, { webgpu: false });
    await page.goto("/");
    await openOfflineChat(page);
    await expect(page.getByTestId("local-model-unsupported")).toContainText("braucht WebGPU");
    await expect(page.getByTestId("btn-local-model-load")).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByTestId("chat-mode")).toHaveAttribute("data-mode", "offline-unsupported");
    await ask(page, "Hallo?");
    await expect(
      page.getByRole("alert").filter({ hasText: "unterstützt kein WebGPU" })
    ).toBeVisible();
  });

  test("Server nicht erreichbar: lokales Modell springt ein", async ({ page }) => {
    await setup(page, { webgpu: true });
    await page.goto("/");
    await loadModel(page);
    await page.unroute("**/api/v1/notebooks/*/chat");
    await page.route("**/api/v1/notebooks/*/chat", (route) => route.abort("connectionrefused"));
    await ask(page, "Was ist FTS5?");
    await expect(
      page.getByText("Server nicht erreichbar, das lokale Modell antwortet.")
    ).toBeVisible();
    await expect(page.locator("article.rn-msg--assistant").last()).toContainText("Lokal: D1 nutzt");
  });

  test("gespeichertes Modell kommt nach dem Neuladen aus dem Cache, ohne neue Zustimmung", async ({
    page,
    context
  }) => {
    await setup(page, { webgpu: true });
    await page.goto("/");
    await loadModel(page);
    await page.reload();
    await expect(page.getByTestId("local-model-ready")).toHaveText("Offline-Modell gespeichert");
    await context.setOffline(true);
    await expect(page.getByTestId("chat-mode")).toHaveAttribute("data-mode", "offline-local");
    await ask(page, "Wie sucht D1?");
    await expect(page.locator("article.rn-msg--assistant").last()).toContainText("Lokal: D1 nutzt");
    await expect(page.getByTestId("local-model-consent")).toHaveCount(0);

    // Entfernen räumt den Cache
    await context.setOffline(false);
    await page.getByTestId("btn-local-model-remove").click();
    await expect(page.getByTestId("btn-local-model-load")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("rn_local_model"))).toBeNull();
  });
});
