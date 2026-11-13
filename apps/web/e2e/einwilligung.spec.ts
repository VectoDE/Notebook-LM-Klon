import { type Page, expect, test } from "@playwright/test";

/**
 * Einwilligungsbanner (Issue #261). Läuft im Projekt "einwilligung" gegen einen
 * Server mit VITE_GTM_ID=GTM-TEST0001. Anfragen an Google werden abgefangen.
 */
const GOOGLE =
  /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)\//;

async function watchGoogle(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(GOOGLE, (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
  return requests;
}

async function storedConsent(page: Page): Promise<{ analytics: boolean } | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("rn-consent");
    return raw ? (JSON.parse(raw) as { analytics: boolean }) : null;
  });
}

test.describe("Einwilligungsbanner", () => {
  test("drei gleichwertige Knöpfe, zuerst per Tastatur erreichbar", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Darf RelationNotes die Nutzung messen?" });
    await expect(banner).toBeVisible();

    const choices = banner.locator(".rn-consent-choice");
    await expect(choices).toHaveText(["Alle akzeptieren", "Nur notwendige", "Anpassen"]);

    const styles = await choices.evaluateAll((buttons) =>
      buttons.map((b) => {
        const s = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return {
          width: Math.round(r.width),
          height: Math.round(r.height),
          background: s.backgroundColor,
          color: s.color,
          weight: s.fontWeight,
          size: s.fontSize,
          border: s.borderTopColor
        };
      })
    );
    for (const style of styles) {
      expect(style).toEqual(styles[0]);
      expect(style.height).toBeGreaterThanOrEqual(44);
    }

    // Erster Tabulatorschritt landet im Banner (es steht im DOM vor der App)
    await page.keyboard.press("Tab");
    await expect(banner.getByTestId("consent-notice-link")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(banner.getByTestId("consent-accept-all")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(banner.getByTestId("consent-necessary-only")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(banner.getByTestId("consent-customize")).toBeFocused();
  });

  test("Pfad 1: Alle akzeptieren speichert die Einwilligung", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-accept-all").click();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    await expect(page.getByTestId("consent-status")).toHaveText("Gespeichert: Messung erlaubt.");
    expect(await storedConsent(page)).toMatchObject({ analytics: true });

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  });

  test("Pfad 2: Nur notwendige lehnt die Messung ab und lädt nichts von Google", async ({
    page
  }) => {
    const google = await watchGoogle(page);
    await page.goto("/");
    await page.getByTestId("consent-necessary-only").press("Enter");
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect(await storedConsent(page)).toMatchObject({ analytics: false });

    await page.reload();
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect(google).toEqual([]);
  });

  test("Pfad 3: Anpassen öffnet die Auswahl ohne Vorauswahl", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-customize").click();
    const dialog = page.getByRole("dialog", { name: "Cookie-Einstellungen" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("consent-necessary")).toBeChecked();
    await expect(dialog.getByTestId("consent-necessary")).toBeDisabled();
    await expect(dialog.getByTestId("consent-analytics")).not.toBeChecked();

    await dialog.getByTestId("consent-analytics").check();
    await dialog.getByTestId("consent-save").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("consent-banner")).toHaveCount(0);
    expect(await storedConsent(page)).toMatchObject({ analytics: true });
  });

  test("Widerruf jederzeit über die Fußzeile", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-accept-all").click();

    await page.getByTestId("footer-cookie-settings").click();
    const dialog = page.getByRole("dialog", { name: "Cookie-Einstellungen" });
    await expect(dialog.getByTestId("consent-analytics")).toBeChecked();
    await dialog.getByTestId("consent-analytics").uncheck();
    await dialog.getByTestId("consent-save").click();
    expect(await storedConsent(page)).toMatchObject({ analytics: false });

    // Escape schließt die Einstellungen, der Fokus kehrt zum Auslöser zurück
    await page.getByTestId("footer-cookie-settings").click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("footer-cookie-settings")).toBeFocused();
  });

  test("Datenschutzhinweise aus dem Banner", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-notice-link").click();
    const notice = page.getByRole("dialog", { name: "Datenschutzhinweise" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Reichweitenmessung ohne Cookies");
    await notice.getByTestId("privacy-notice-close").click();
    await expect(notice).toHaveCount(0);
  });
});
