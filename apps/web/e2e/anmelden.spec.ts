import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers.js";

/**
 * Anmelden mit Turnstile (Issue #233). Das echte Cloudflare-Skript wird durch einen Stub
 * ersetzt: der Test bleibt ohne Netz stabil und prüft, dass das Token mitgeschickt wird.
 */
const TURNSTILE_STUB = `
  window.turnstile = {
    render(container, options) {
      window.__turnstileOptions = { sitekey: options.sitekey, language: options.language };
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Bot-Prüfung bestätigen";
      button.dataset.testid = "turnstile-stub";
      button.addEventListener("click", () => options.callback("stub-token-" + Date.now()));
      container.appendChild(button);
      return "stub-widget";
    },
    reset() {},
    remove() {}
  };
`;

async function stubTurnstile(page: Page) {
  let scriptRequests = 0;
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) => {
    scriptRequests++;
    return route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB });
  });
  return () => scriptRequests;
}

test.describe("Anmelden mit Turnstile", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lädt Turnstile erst beim Öffnen und schickt das Token mit", async ({ page }) => {
    const scriptRequests = await stubTurnstile(page);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/v1/auth/guest", async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, json: { user: { id: "g" } } });
    });
    await page.route("**/api/v1/auth/magic-link", async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, json: { message: "ok" } });
    });

    await page.goto("/");
    expect(scriptRequests()).toBe(0);

    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await expect(dialog).toBeVisible();
    // Entwicklung ohne Site-Key: offizieller Test-Key, deutlich markiert
    await expect(dialog.getByTestId("sign-in-test-key")).toContainText("Testmodus");
    await expect
      .poll(() =>
        page.evaluate(() => (window as { __turnstileOptions?: unknown }).__turnstileOptions)
      )
      .toEqual({ sitekey: "1x00000000000000000000AA", language: "de" });
    expect(scriptRequests()).toBe(1);

    // Ohne Token: sichtbarer Hinweis, kein Aufruf. aria-disabled hält den Knopf erreichbar,
    // Playwright wertet ihn aber als gesperrt, daher force.
    await dialog.getByTestId("btn-sign-in-guest").click({ force: true });
    await expect(dialog.getByTestId("sign-in-status")).toHaveText(
      "Bitte zuerst die Bot-Prüfung abschließen."
    );
    expect(bodies).toHaveLength(0);

    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-sign-in-guest").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText("als Gast angemeldet");
    expect(bodies[0]?.turnstileToken).toMatch(/^stub-token-/);

    // Token ist verbraucht: Magic-Link braucht eine neue Prüfung
    await dialog.getByTestId("sign-in-email-input").fill("anna@example.com");
    await dialog.getByTestId("btn-sign-in-magic").click({ force: true });
    await expect(dialog.getByTestId("sign-in-status")).toHaveText(
      "Bitte zuerst die Bot-Prüfung abschließen."
    );
    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-sign-in-magic").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText("Anmeldelink ist unterwegs");
    expect(bodies[1]).toMatchObject({ email: "anna@example.com", locale: "de" });
    expect(bodies[1]?.turnstileToken).toMatch(/^stub-token-/);
    expect(await findLayoutProblems(page)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("btn-open-account")).toBeFocused();
  });

  test("meldet Serverfehler ohne Bot-Schutz verständlich", async ({ page }) => {
    await stubTurnstile(page);
    await page.route("**/api/v1/auth/guest", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ code: "TURNSTILE_NOT_CONFIGURED" })
      })
    );
    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-sign-in-guest").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText(
      "keinen Bot-Schutz eingerichtet"
    );
  });

  test("zeigt einen Fehler, wenn das Turnstile-Skript nicht lädt", async ({ page }) => {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
      route.abort()
    );
    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await expect(dialog.getByTestId("sign-in-widget-failed")).toBeVisible();
  });
});

/**
 * Passkey einrichten (Issue #343): navigator.credentials.create wird ersetzt, damit der Test
 * ohne echten Authenticator läuft. Geprüft wird, dass die Options-Anfrage das Turnstile-Token
 * trägt und ohne Token nichts an den Server geht.
 */
const WEBAUTHN_STUB = `
  window.__createCalls = 0;
  navigator.credentials.create = async (options) => {
    window.__createCalls++;
    window.__createChallenge = Array.from(new Uint8Array(options.publicKey.challenge));
    const bytes = (...v) => new Uint8Array(v).buffer;
    return {
      id: "cred-e2e",
      rawId: bytes(1, 2, 3),
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: bytes(4, 5),
        attestationObject: bytes(6),
        getTransports: () => ["internal"]
      },
      getClientExtensionResults: () => ({})
    };
  };
`;

const REGISTRATION_OPTIONS = {
  challenge: "AQID",
  rp: { name: "RelationNotes", id: "127.0.0.1" },
  user: { id: "dXNyXzE", name: "gast", displayName: "Gast" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [],
  attestation: "none"
};

test.describe("Passkey einrichten mit Turnstile", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("schickt das Token mit der Options-Anfrage und registriert den Passkey", async ({
    page
  }) => {
    await stubTurnstile(page);
    await page.addInitScript(WEBAUTHN_STUB);
    const optionBodies: Record<string, unknown>[] = [];
    const verifyBodies: Record<string, unknown>[] = [];
    await page.route("**/api/v1/auth/passkey/register/options", async (route) => {
      optionBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, json: REGISTRATION_OPTIONS });
    });
    await page.route("**/api/v1/auth/passkey/register/verify", async (route) => {
      verifyBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, json: { verified: true, upgradedToPermanent: true } });
    });

    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await expect(dialog.getByRole("heading", { name: "Passkey einrichten" })).toBeVisible();

    // Ohne Token: Hinweis, keine Anfrage
    await dialog.getByTestId("btn-register-passkey").click({ force: true });
    await expect(dialog.getByTestId("sign-in-status")).toHaveText(
      "Bitte zuerst die Bot-Prüfung abschließen."
    );
    expect(optionBodies).toHaveLength(0);

    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-register-passkey").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText("Passkey ist eingerichtet");
    expect(optionBodies[0]?.turnstileToken).toMatch(/^stub-token-/);
    expect(
      await page.evaluate(() => (window as { __createChallenge?: number[] }).__createChallenge)
    ).toEqual([1, 2, 3]);
    expect(verifyBodies[0]).toMatchObject({ id: "cred-e2e", rawId: "AQID", type: "public-key" });
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("zeigt die Ablehnung durch den Bot-Schutz und ruft WebAuthn nicht auf", async ({ page }) => {
    await stubTurnstile(page);
    await page.addInitScript(WEBAUTHN_STUB);
    await page.route("**/api/v1/auth/passkey/register/options", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        body: JSON.stringify({ code: "BOT_VERIFICATION_FAILED" })
      })
    );
    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-register-passkey").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText(
      "Bot-Prüfung wurde nicht bestätigt"
    );
    expect(await page.evaluate(() => (window as { __createCalls?: number }).__createCalls)).toBe(0);
  });

  test("bittet ohne Sitzung zuerst um Anmeldung", async ({ page }) => {
    await stubTurnstile(page);
    await page.addInitScript(WEBAUTHN_STUB);
    await page.route("**/api/v1/auth/passkey/register/options", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        body: JSON.stringify({ code: "UNAUTHORIZED" })
      })
    );
    await page.goto("/");
    await page.getByTestId("btn-open-account").click();
    await page.getByTestId("account-open-sign-in").click();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await dialog.getByTestId("turnstile-stub").click();
    await dialog.getByTestId("btn-register-passkey").click();
    await expect(dialog.getByTestId("sign-in-status")).toContainText("zuerst anmelden");
  });
});

test.describe("Anmelden auf dem Telefon", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("öffnet den Dialog aus dem Menü-Sheet", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto("/");
    await page.getByTestId("btn-open-menu").click();
    await page.getByTestId("sheet-open-sign-in").click();
    await expect(page.getByTestId("nav-sheet")).toBeHidden();
    const dialog = page.getByRole("dialog", { name: "Anmelden" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("turnstile-stub")).toBeVisible();
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});
