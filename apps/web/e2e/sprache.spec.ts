import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers";

/**
 * Sprachumschaltung übersetzt die Oberfläche (Issue #301): Kopfzeile, Navigation (oben,
 * unten, Sheet), Einstellungen und Darstellung folgen der Wahl, ebenso <html lang>.
 */

async function openSettings(page: Page, narrow: boolean) {
  if (narrow) {
    await page.getByTestId("btn-open-menu").click();
    await page.getByTestId("sheet-open-settings").click();
  } else {
    await page.getByTestId("btn-open-settings").click();
  }
  const drawer = page.getByTestId("settings-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

for (const width of [390, 1440]) {
  const narrow = width < 600;

  test(`${width} px: Umschalten auf Englisch übersetzt Kopf, Navigation und Einstellungen`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "de");

    const drawer = await openSettings(page, narrow);
    await drawer.getByTestId("lang-option-en").check();
    await expect(html).toHaveAttribute("lang", "en");

    // Einstellungen und Darstellung
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    for (const text of [
      "Language",
      "AI model",
      "Applies to new answers.",
      "Your own API keys (BYOK)",
      "Coming soon",
      "BYOK stands for “bring your own key”",
      "Design, color scheme and motion are set under “Appearance”."
    ]) {
      await expect(drawer, text).toContainText(text);
    }
    for (const german of ["Darstellung", "Sprache", "Modell", "Schlüssel"]) {
      await expect(drawer, german).not.toContainText(german);
    }
    expect(await findLayoutProblems(page)).toEqual([]);
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(drawer).toBeHidden();

    // Kopfzeile und Navigation
    if (narrow) {
      const bottom = page.getByTestId("mobile-bottom-nav");
      await expect(page.getByRole("navigation", { name: "Sections" }).first()).toBeVisible();
      await expect(bottom.getByRole("button", { name: "Sources (2)" })).toBeVisible();
      await expect(bottom.getByRole("button", { name: "Chat & citations" })).toBeVisible();
      await expect(bottom.getByRole("button", { name: "Studio (6 tools)" })).toBeVisible();
      await expect(bottom).toContainText("Sources");

      await page.getByRole("button", { name: "Open menu" }).click();
      const sheet = page.getByRole("dialog", { name: "Menu" });
      await expect(sheet).toBeVisible();
      for (const text of [
        "Language, AI model, privacy",
        "Settings",
        "Appearance",
        "Color scheme",
        "Reduce motion",
        "Role"
      ]) {
        await expect(sheet, text).toContainText(text);
      }
      for (const german of ["Bereiche", "Einstellungen", "Darstellung", "Farbschema"]) {
        await expect(sheet, german).not.toContainText(german);
      }
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.getByRole("button", { name: "Close menu" }).click();
      await expect(sheet).toBeHidden();
    } else {
      const top = page.getByTestId("top-nav");
      await expect(page.getByRole("navigation", { name: "Sections" }).first()).toBeVisible();
      for (const label of ["Sources", "Chat", "Studio"]) {
        await expect(top, label).toContainText(label);
      }
      await expect(top).not.toContainText("Quellen");
      await expect(page.getByTestId("btn-open-settings")).toHaveText("Settings");
      const appearance = page.getByTestId("btn-open-appearance");
      await expect(appearance).toHaveText("Appearance");
      await appearance.click();
      const menu = page.getByRole("dialog", { name: "Appearance" });
      await expect(menu).toBeVisible();
      await expect(menu).toContainText("Automatic (match device)");
      await expect(menu).toContainText("Design and color scheme are saved on this device.");
      await expect(menu).toContainText("Reduce motion");
      await expect(menu.getByLabel("Role")).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }

    // Sprunglink und Hauptbereich
    await expect(page.getByTestId("skip-link")).toHaveText("Skip to content");

    // Wahl übersteht Neuladen, zurück auf Deutsch
    await page.reload();
    await expect(html).toHaveAttribute("lang", "en");
    const again = await openSettings(page, narrow);
    await again.getByTestId("lang-option-de").check();
    await expect(html).toHaveAttribute("lang", "de");
    await expect(page.getByRole("dialog", { name: "Einstellungen" })).toBeVisible();
  });
}
