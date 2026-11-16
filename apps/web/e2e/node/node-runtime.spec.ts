import { expect, test } from "@playwright/test";

/**
 * E2E against the Node build (#330, #338): web app and API come from
 * `node apps/worker/dist/node-server.js` on one port (playwright.node.config.ts).
 * No API route is mocked. Only the Turnstile browser widget is replaced by a stub that
 * hands out a token; the server checks it at Cloudflare with the official TEST secret.
 */
const TURNSTILE_STUB = `
  window.turnstile = {
    render(container, options) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Bot-Prüfung bestätigen";
      button.dataset.testid = "turnstile-stub";
      button.addEventListener("click", () => options.callback("XXXX.DUMMY.TOKEN.XXXX"));
      container.appendChild(button);
      return "stub-widget";
    },
    reset() {},
    remove() {}
  };
`;

test.describe("Node-Laufzeit: Web-App und API auf einem Port", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("liefert Startseite, SPA-Unterseiten und die API vom selben Server", async ({
    page,
    request
  }) => {
    const home = await page.goto("/");
    expect(home?.status()).toBe(200);
    await expect(page.getByTestId("btn-open-account")).toBeVisible();

    const deep = await page.goto("/notebooks/beliebig/tief");
    expect(deep?.status()).toBe(200);
    await expect(page.getByTestId("btn-open-account")).toBeVisible();

    const health = await request.get("/api/v1/health");
    expect(health.ok()).toBe(true);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const unknown = await request.get("/api/v1/gibt-es-nicht");
    expect(unknown.status()).toBe(404);
  });

  test("meldet einen Gast über die Oberfläche echt am Node-Server an", async ({ page }) => {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
      route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB })
    );
    const guestResponse = page.waitForResponse("**/api/v1/auth/guest");

    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-sign-in-guest").click();

    expect((await guestResponse).status()).toBe(201);
    await expect(dialog.getByTestId("sign-in-status")).toContainText("als Gast angemeldet");
    const cookies = await page.context().cookies();
    expect(cookies.length).toBeGreaterThan(0);
  });
});
