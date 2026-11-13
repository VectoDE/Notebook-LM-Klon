import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, findLayoutProblems, openPanel } from "./helpers";

/**
 * Leichte Sprache (Issue #349): Umschalten in den Einstellungen, Katalog lädt erst bei Wahl,
 * <html lang> bleibt "de". Leichte Sprache ist länger: In allen vier Designs bei 1440 und
 * 390 px darf nichts überlaufen oder abgeschnitten werden (Einstellungen, Kopf, alle Bereiche).
 */

const LS = JSON.parse(
  readFileSync(new URL("../src/locales/de-x-ls.json", import.meta.url), "utf8")
) as Record<string, string>;

async function openSettings(page: Page) {
  const menu = page.getByTestId("btn-open-menu");
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByTestId("sheet-open-settings").click();
  } else {
    await page.getByTestId("btn-open-settings").click();
  }
  const drawer = page.getByTestId("settings-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Zugänglicher Name beginnt mit der sichtbaren Beschriftung (WCAG 2.5.3), auch in Leichter Sprache. */
async function labelInNameProblems(page: Page, where: string): Promise<string[]> {
  const problems = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("button[aria-label], a[aria-label]")) {
      const aria = (el.getAttribute("aria-label") ?? "").toLowerCase().trim();
      const visible = Array.from(el.childNodes)
        .map((n) => (n.nodeType === 3 ? n.nodeValue : ((n as Element).textContent ?? "")))
        .join(" ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
      if (/\p{L}/u.test(visible) && !aria.startsWith(visible))
        bad.push(`"${aria}" beginnt nicht mit "${visible}"`);
    }
    return bad;
  });
  return problems.map((p) => `${where}: ${p}`);
}

async function expectNoLayoutProblems(page: Page, where: string) {
  expect(await findLayoutProblems(page), where).toEqual([]);
}

for (const width of [1440, 390]) {
  for (const design of DESIGNS) {
    test(`${width} px, ${design}: Leichte Sprache wählbar, lang=de, kein Überlauf`, async ({
      page
    }) => {
      const catalogRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("de-x-ls")) catalogRequests.push(r.url());
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await chooseDesign(page, design, "light");
      // Der Katalog gehört nicht zum Start: erst die Wahl lädt ihn.
      expect(catalogRequests).toEqual([]);

      const drawer = await openSettings(page);
      for (const [id, name] of [
        ["de", "Deutsch"],
        ["de-x-ls", "Deutsch – Leichte Sprache"],
        ["en", "English"]
      ] as const) {
        await expect(drawer.getByTestId(`lang-option-${id}`).locator("..")).toContainText(name);
      }
      await drawer.getByTestId("lang-option-de-x-ls").check();

      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-language", "de-x-ls");
      await expect(html).toHaveAttribute("lang", "de");
      await expect(drawer).toContainText(LS.languageHint as string);
      await expect(drawer).toContainText(LS.modelHint as string);
      expect(catalogRequests.length).toBeGreaterThan(0);
      await expectNoLayoutProblems(page, "Einstellungen");

      await page.getByRole("button", { name: LS.settingsClose as string }).click();
      await expect(drawer).toBeHidden();
      await expectNoLayoutProblems(page, "Kopf und Startansicht");
      const menu = page.getByTestId("btn-open-menu");
      if (await menu.isVisible()) {
        await menu.click();
        await expect(page.getByTestId("nav-sheet")).toBeVisible();
        await expectNoLayoutProblems(page, "Menü-Sheet");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("nav-sheet")).toBeHidden();
      }

      for (const panel of ["sources", "chat", "studio"] as const) {
        await openPanel(page, panel);
        await expectNoLayoutProblems(page, `Bereich ${panel}`);
      }
      await expect(page.getByText(LS.studioTitle as string).first()).toBeVisible();
    });
  }
}

test("Leichte Sprache bleibt nach dem Neuladen gewählt und lässt sich zurückstellen", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  let drawer = await openSettings(page);
  await drawer.getByTestId("lang-option-de-x-ls").check();
  await expect(page.locator("html")).toHaveAttribute("data-language", "de-x-ls");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-language", "de-x-ls");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  drawer = await openSettings(page);
  await expect(drawer).toContainText(LS.languageHint as string);
  await expect(drawer.getByTestId("lang-option-de-x-ls")).toBeChecked();

  await drawer.getByTestId("lang-option-de").check();
  await expect(page.locator("html")).toHaveAttribute("data-language", "de");
  await expect(drawer).toContainText(
    "Gilt für die Oberfläche und wird auf diesem Gerät gespeichert."
  );
  await expect(drawer).not.toContainText(LS.languageHint as string);
});

for (const width of [1440, 390]) {
  test(`${width} px: jede Studio-Ansicht in Leichter Sprache ohne Überlauf, Name enthält Beschriftung`, async ({
    page
  }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "de-x-ls"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const labelProblems: string[] = [];
    for (const panel of ["sources", "chat", "studio"] as const) {
      await openPanel(page, panel);
      await expectNoLayoutProblems(page, `Bereich ${panel}`);
      labelProblems.push(...(await labelInNameProblems(page, `Bereich ${panel}`)));
    }
    const tools = await page
      .locator("[data-testid^='btn-open-'][data-testid$='-tool']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
    expect(tools.length).toBeGreaterThan(4);
    // Das Wissens·netz öffnet eine eigene Ansicht statt der Werkzeugansicht: zuletzt prüfen.
    const inToolView = tools.filter((tool) => tool !== "btn-open-graph-tool");
    for (const tool of inToolView) {
      await page.getByTestId(tool).click();
      await expect(page.getByTestId("studio-tool-view")).toBeVisible();
      await expectNoLayoutProblems(page, tool);
      labelProblems.push(...(await labelInNameProblems(page, tool)));
      await page.getByTestId("btn-back-to-studio-overview").click();
    }
    if (tools.includes("btn-open-graph-tool")) {
      await page.getByTestId("btn-open-graph-tool").click();
      await expect(page.getByTestId("graph-panel")).toBeVisible();
      await expectNoLayoutProblems(page, "Wissens·netz");
      labelProblems.push(...(await labelInNameProblems(page, "Wissens·netz")));
    }
    expect([...new Set(labelProblems)], "Label im Namen").toEqual([]);
  });
}

for (const width of [1440, 390]) {
  test(`${width} px: Teilen und Anmelden in Leichter Sprache ohne Überlauf`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "de-x-ls"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-language", "de-x-ls");
    for (const [trigger, dialog] of [
      ["btn-open-share", "[data-testid='share-dialog']"],
      ["btn-open-account", "#account-menu"]
    ] as const) {
      const button = page.getByTestId(trigger);
      if (!(await button.isVisible())) continue;
      await button.click();
      await expect(page.locator(dialog)).toBeVisible();
      await expectNoLayoutProblems(page, dialog);
      await page.keyboard.press("Escape");
      await expect(page.locator(dialog)).toBeHidden();
    }
  });
}
