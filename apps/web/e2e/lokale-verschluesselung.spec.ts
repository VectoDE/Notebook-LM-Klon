import { type Page, expect, test } from "@playwright/test";

/**
 * Verschlüsselte lokale Ablage (Issue #348) im echten Browser: Chiffrat in IndexedDB,
 * Abmelden über die Oberfläche, danach ist die Datenbank nachweisbar gelöscht.
 * Die Module werden über den Vite-Server geladen, die Server-Endpunkte sind gestubbt.
 */
const SECRET_TEXT = "Streng vertraulicher Notizinhalt";
const MATERIAL = Buffer.from(new Uint8Array(32).map((_, i) => i * 7 + 1)).toString("base64url");

async function stubSession(page: Page): Promise<() => number> {
  let logoutCalls = 0;
  await page.route("**/api/v1/auth/local-key", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ version: 1, keyMaterial: MATERIAL })
    })
  );
  await page.route("**/api/v1/auth/logout", (route) => {
    logoutCalls++;
    return route.fulfill({ status: 204 });
  });
  return () => logoutCalls;
}

async function writeEncrypted(page: Page): Promise<void> {
  await page.evaluate(async (text) => {
    const storeUrl = "/src/encrypted-store.ts";
    const sessionUrl = "/src/local-session.ts";
    const storeMod = await import(/* @vite-ignore */ storeUrl);
    const sessionMod = await import(/* @vite-ignore */ sessionUrl);
    const key = await sessionMod.fetchLocalKey((input: string, init?: RequestInit) =>
      fetch(input, init)
    );
    if (key.status !== "ok") throw new Error(`kein Schlüssel: ${key.status}`);
    const { store } = await storeMod.openEncryptedStore({ material: key.material });
    await store.put("outbox", "e2e-1", { text });
    const back = await store.get("outbox", "e2e-1");
    if (back.text !== text) throw new Error("Rundweg fehlgeschlagen");
    // Verbindung bleibt offen: das Abmelden muss sie selbst schließen
  }, SECRET_TEXT);
}

/** Alle Rohwerte der lokalen Datenbank als Text, so wie sie gespeichert sind. */
async function rawDump(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open("rn-local-v1");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["records", "meta"], "readonly");
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

async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((info) => info.name ?? ""));
}

test.describe("Verschlüsselte lokale Ablage und Abmelden", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("speichert nur Chiffrat und Abmelden löscht die Datenbank", async ({ page }) => {
    const logoutCalls = await stubSession(page);
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem("rn_notebook_titles", JSON.stringify({ nb_active: "Geheimer Titel" }))
    );

    await writeEncrypted(page);
    expect(await databaseNames(page)).toContain("rn-local-v1");
    const dump = await rawDump(page);
    expect(dump).toContain("outbox");
    expect(dump).not.toContain(SECRET_TEXT);
    expect(dump).not.toContain("vertraulich");

    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-sign-out").click();
    await expect(
      page.getByRole("status").filter({ hasText: /Abgemeldet|Signed out/ })
    ).toBeVisible();

    expect(logoutCalls()).toBe(1);
    await expect.poll(() => databaseNames(page)).not.toContain("rn-local-v1");
    expect(await page.evaluate(() => localStorage.getItem("rn_notebook_titles"))).toBeNull();
  });

  test("ohne Server-Verbindung wird lokal trotzdem gelöscht", async ({ page }) => {
    await stubSession(page);
    await page.goto("/");
    await writeEncrypted(page);
    await page.unroute("**/api/v1/auth/logout");
    await page.route("**/api/v1/auth/logout", (route) => route.abort("internetdisconnected"));

    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-sign-out").click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Lokale Daten sind gelöscht|Local data has been deleted/ })
    ).toBeVisible();
    await expect.poll(() => databaseNames(page)).not.toContain("rn-local-v1");
  });
});
