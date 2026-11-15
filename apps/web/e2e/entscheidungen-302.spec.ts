import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers";

/**
 * Entscheidungen des Inhabers (Issue #302): Training-Angabe je Modell mit Quelle statt
 * pauschal „ohne Training“, Rolle als Vorschau im Text geklärt.
 */

async function openSettings(page: Page, width: number) {
  if (width < 600) {
    await page.getByTestId("btn-open-menu").click();
    await page.getByTestId("sheet-open-settings").click();
  } else {
    await page.getByTestId("btn-open-settings").click();
  }
  const drawer = page.getByTestId("settings-drawer");
  await expect(drawer).toBeVisible();
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return drawer;
}

for (const width of [390, 1440]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
    });

    test("Training-Angabe folgt dem gewählten Modell, mit Quelle", async ({ page }) => {
      const drawer = await openSettings(page, width);
      await expect(drawer).not.toContainText("ohne Training");
      await expect(drawer).not.toContainText("On-Device");

      const policy = drawer.getByTestId("model-policy");
      await expect(policy).toBeVisible();
      await expect(policy).toHaveAttribute("data-status", "conditional");
      await expect(policy).toContainText("Kein Training nur unter Bedingungen");
      const link = policy.getByRole("link", { name: /Gemini API Additional Terms/ });
      await expect(link).toHaveAttribute("href", "https://aistudio.google.com/docs/terms");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(drawer.getByTestId("model-policy-retrieved")).toContainText(
        "keine Rechtsberatung"
      );
      // Auswahlfeld ist mit Hinweis und Angabe verknüpft
      const select = drawer.getByTestId("model-router-select");
      await expect(select).toHaveAccessibleDescription(/Gilt für neue Antworten\..*Training/);

      await select.selectOption("deepseek-r1");
      await expect(drawer.getByTestId("model-policy-connection")).toContainText(
        "Anfragen gehen derzeit an Google Gemini 2.5 Flash"
      );
      await select.selectOption("ollama-local");
      await expect(policy).toHaveAttribute("data-status", "local");
      await expect(drawer.getByTestId("model-policy-connection")).toHaveCount(0);

      await policy.scrollIntoViewIfNeeded();
      expect(await findLayoutProblems(page)).toEqual([]);
    });

    test("Rolle ist als Vorschau gekennzeichnet", async ({ page }) => {
      const mobile = width < 600;
      await page.getByTestId(mobile ? "btn-open-menu" : "btn-open-appearance").click();
      const container = page.getByTestId(mobile ? "nav-sheet" : "appearance-menu");
      await expect(container).toBeVisible();
      const role = container.getByTestId("role-switcher-select");
      await role.scrollIntoViewIfNeeded();
      await expect(role).toHaveAccessibleName("Rolle (Vorschau)");
      await expect(role).toHaveAccessibleDescription(
        /Nur Vorschau: Die Auswahl ändert derzeit nichts/
      );
      await expect(container.getByTestId("role-hint")).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);
    });
  });
}

test("Englisch: Angabe und Rolle übersetzt", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const drawer = await openSettings(page, 1440);
  await expect(drawer.getByTestId("model-policy")).toContainText(
    "No training only under conditions"
  );
  await expect(drawer).not.toContainText("zero model training");
  await page.keyboard.press("Escape");
  await page.getByTestId("btn-open-appearance").click();
  await expect(page.getByTestId("appearance-menu").getByTestId("role-hint")).toContainText(
    "Preview only"
  );
});
