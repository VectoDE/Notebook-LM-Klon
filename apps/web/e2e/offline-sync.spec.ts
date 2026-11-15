import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import * as Y from "yjs";
import { findLayoutProblems } from "./helpers.js";

/**
 * Offline-Bearbeiten mit Synchronisation (Issue #347) im echten Browser. Der Server ist ein
 * Yjs-Stub im Testprozess (wie das NotebookDO: Updates zusammenführen, Diff per
 * Zustandsvektor). Offline schaltet context.setOffline(true).
 */
const MATERIAL = Buffer.from(new Uint8Array(32).map((_, i) => 200 - i)).toString("base64url");
const DOC_URL = "**/api/v1/notebooks/nb_active/doc**";

interface FakeServer {
  state: Uint8Array | null;
  posts: number;
  failPosts: boolean;
  title(): unknown;
  apply(update: Uint8Array): void;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function startServer(context: BrowserContext): Promise<FakeServer> {
  const server: FakeServer = {
    state: null,
    posts: 0,
    failPosts: false,
    title() {
      const doc = new Y.Doc();
      if (this.state) Y.applyUpdate(doc, this.state);
      return doc.getMap("meta").get("title");
    },
    apply(update) {
      this.state = this.state ? Y.mergeUpdates([this.state, update]) : update;
    }
  };
  await context.route("**/api/v1/auth/local-key", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 1, keyMaterial: MATERIAL })
    })
  );
  await context.route(DOC_URL, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      if (server.failPosts) {
        return route.fulfill({ status: 503, contentType: "application/problem+json", body: "{}" });
      }
      const { update } = request.postDataJSON() as { update: string };
      server.posts++;
      server.apply(new Uint8Array(Buffer.from(update, "base64url")));
      return route.fulfill({ contentType: "application/json", body: '{"stateVector":"AA"}' });
    }
    const sv = new URL(request.url()).searchParams.get("sv");
    const state = server.state ?? Y.encodeStateAsUpdate(new Y.Doc());
    const update = sv ? Y.diffUpdate(state, new Uint8Array(Buffer.from(sv, "base64url"))) : state;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ update: b64(update), stateVector: "AA" })
    });
  });
  return server;
}

async function rename(page: Page, title: string): Promise<void> {
  await page.getByTestId("notebook-title-button").click();
  const input = page.getByTestId("notebook-title-input");
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByTestId("notebook-title-button")).toContainText(title);
}

/** Alle Rohwerte der lokalen Datenbank als Text. */
async function rawDump(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open("rn-local-v1");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["records"], "readonly");
          const all = tx.objectStore("records").getAll();
          tx.oncomplete = () => {
            const decoder = new TextDecoder();
            const parts = (all.result as Record<string, unknown>[]).flatMap((rec) =>
              Object.values(rec).map((v) =>
                v instanceof Uint8Array ? decoder.decode(v) : String(v)
              )
            );
            db.close();
            resolve(parts.join("|"));
          };
        };
      })
  );
}

test.describe("Offline-Bearbeiten mit Synchronisation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("offline umbenennen, verschlüsselt puffern, bei Verbindung senden", async ({
    page,
    context
  }) => {
    const server = await startServer(context);
    await page.goto("/");
    const status = page.getByTestId("sync-status");
    await expect(status.locator(".rn-sync-text")).toHaveText("Alles synchronisiert");
    await expect(status).toHaveRole("status");

    await context.setOffline(true);
    await rename(page, "Offline geschriebener Titel");
    await expect(status.locator(".rn-sync-text")).toHaveText(
      "Offline · 1 Änderung lokal gesichert"
    );
    await expect(status).toHaveAttribute("data-state", "offline");

    const dump = await rawDump(page);
    expect(dump).toContain("outbox:nb_active");
    expect(dump).not.toContain("Offline geschriebener Titel");
    expect(server.posts).toBe(0);

    await context.setOffline(false);
    await expect(status.locator(".rn-sync-text")).toHaveText("Alles synchronisiert");
    expect(server.title()).toBe("Offline geschriebener Titel");
    expect(await page.evaluate(() => localStorage.getItem("rn_notebook_titles"))).toBeNull();
  });

  test("Konflikt: Änderung eines anderen Geräts während offline, beide enden gleich", async ({
    page,
    context
  }) => {
    const server = await startServer(context);
    await page.goto("/");
    const status = page.getByTestId("sync-status");
    await expect(status.locator(".rn-sync-text")).toHaveText("Alles synchronisiert");

    await context.setOffline(true);
    await rename(page, "Titel vom Browser");
    // Ein anderes Gerät ändert inzwischen denselben Titel und ein weiteres Feld
    const other = new Y.Doc();
    other.getMap("meta").set("title", "Titel vom Tablet");
    other.getMap("meta").set("note", "nur Tablet");
    server.apply(Y.encodeStateAsUpdate(other));

    await context.setOffline(false);
    await expect(status.locator(".rn-sync-text")).toHaveText("Alles synchronisiert");
    const serverTitle = server.title() as string;
    expect(["Titel vom Browser", "Titel vom Tablet"]).toContain(serverTitle);
    await expect(page.getByTestId("notebook-title-button")).toContainText(serverTitle);
  });

  test("wartende Änderung überlebt Neuladen und wird danach gesendet", async ({
    page,
    context
  }) => {
    const server = await startServer(context);
    server.failPosts = true;
    await page.goto("/");
    const status = page.getByTestId("sync-status");
    await expect(status.locator(".rn-sync-text")).toHaveText("Alles synchronisiert");

    await rename(page, "Titel vor dem Neuladen");
    await expect(status.locator(".rn-sync-text")).toHaveText(
      "Synchronisierung fehlgeschlagen · 1 Änderung lokal gesichert"
    );
    await expect(status).toHaveAttribute("data-state", "error");

    server.failPosts = false;
    await page.reload();
    await expect(page.getByTestId("sync-status").locator(".rn-sync-text")).toHaveText(
      "Alles synchronisiert"
    );
    expect(server.title()).toBe("Titel vor dem Neuladen");
    await expect(page.getByTestId("notebook-title-button")).toContainText("Titel vor dem Neuladen");
  });

  test("ohne Sitzung kein Status und bisheriges Speichern", async ({ page }) => {
    await page.route("**/api/v1/auth/local-key", (route) =>
      route.fulfill({ status: 401, contentType: "application/problem+json", body: "{}" })
    );
    await page.goto("/");
    await rename(page, "Ohne Konto");
    await expect(page.getByTestId("sync-status")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("rn_notebook_titles"))).toContain(
      "Ohne Konto"
    );
  });
});

test.describe("Status auf schmalen Bildschirmen", () => {
  for (const width of [390, 768]) {
    test(`kein Layoutfehler bei ${width} px, englischer Text`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
      await startServer(context);
      await page.goto("/");
      await expect(page.getByTestId("sync-status").locator(".rn-sync-text")).toHaveText(
        "All synced"
      );
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByTestId("sync-status").locator(".rn-sync-text")).toHaveText("Offline");
      expect(await findLayoutProblems(page)).toEqual([]);
      await rename(page, "Narrow");
      await expect(page.getByTestId("sync-status").locator(".rn-sync-text")).toHaveText(
        "Offline · 1 change saved locally"
      );
      // Unter 900 px sichtbar: Symbol und Anzahl, voller Text als Tooltip
      await expect(page.getByTestId("sync-status").locator(".rn-sync-count")).toBeVisible();
      await expect(page.getByTestId("sync-status")).toHaveAttribute(
        "title",
        "Offline · 1 change saved locally"
      );
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`sync-status-${width}.png`) });
    });
  }
});
