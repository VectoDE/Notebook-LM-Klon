import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems, openPanel } from "./helpers";

/**
 * Runde 2 Usability: Einstellungen und Navigation (Issue #319).
 * Sprache zuerst, Darstellung an einem Ort mit gleichem Inhalt, Kurzinfos im Kopf,
 * Sprungziele statt „aktuell“ ab 900 px, Fokus nach der unteren Leiste, 16 px auf dem
 * Telefon, gespeicherte Modellwahl, kein Griff ohne Funktion, deutsche Begriffe.
 */

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
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return drawer;
}

/** Sichtbare Gruppen der Darstellung (Legenden und Feldnamen) in Reihenfolge. */
function appearanceGroups(page: Page, container: string) {
  return page
    .getByTestId(container)
    .locator(".rn-appearance-label")
    .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
}

/** Ist die Beschriftung sichtbar (nicht auf 1 px zusammengeklappt)? */
function labelBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

test.describe("Einstellungen: Sprache zuerst", () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844]
  ] as const) {
    test(`${width} px: Sprache oben im Bild, Darstellung nicht doppelt`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const drawer = await openSettings(page);
      const titles = await drawer
        .locator(".rn-drawer-section-title")
        .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
      expect(titles[0]).toBe("Sprache");
      expect(titles[1]).toBe("KI-Modell");
      // Sprache und ihre Optionen sind ohne Scrollen sichtbar
      const english = await drawer.getByTestId("lang-option-en").locator("..").boundingBox();
      expect((english?.y ?? height) + (english?.height ?? 0)).toBeLessThanOrEqual(height);
      await expect(drawer.locator("[data-testid^='theme-option-']")).toHaveCount(0);
      await expect(drawer.getByTestId("reduce-motion-toggle")).toHaveCount(0);
      await expect(drawer.getByTestId("settings-appearance-hint")).toBeVisible();
      expect(await findLayoutProblems(page)).toEqual([]);
    });
  }
});

test.describe("Darstellung an einem Ort, gleicher Inhalt", () => {
  const GROUPS = ["Design", "Farbschema", "Bewegung", "Rolle"];

  test("Kopfmenü (1440 px) und Menü-Sheet (390 px) zeigen dieselben Gruppen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("btn-open-appearance").click();
    await expect(page.getByTestId("appearance-menu")).toBeVisible();
    expect(await appearanceGroups(page, "appearance-menu")).toEqual(GROUPS);
    expect(await findLayoutProblems(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("btn-open-menu").click();
    await expect(page.getByTestId("nav-sheet")).toBeVisible();
    expect(await appearanceGroups(page, "nav-sheet")).toEqual(GROUPS);
    await expect(page.getByTestId("nav-sheet").getByTestId("role-switcher-select")).toBeVisible();
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("Tastatur: Fokus landet beim Öffnen auf der gewählten Option unter „Design“", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("rn_design", "editorial-calm"));
    await page.goto("/");
    await page.getByTestId("btn-open-appearance").focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("appearance-menu");
    await expect(menu.getByTestId("theme-option-editorial-calm")).toBeFocused();
  });

  test("Menü bleibt bei 1024 x 768 im Fenster und scrollt bei Bedarf", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await page.getByTestId("btn-open-appearance").click();
    const menu = page.getByTestId("appearance-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(768);
    await menu.getByTestId("role-switcher-select").scrollIntoViewIfNeeded();
    await expect(menu.getByTestId("role-switcher-select")).toBeInViewport();
  });

  test("„Bewegung reduzieren“ wirkt aus dem Menü-Sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByTestId("btn-open-menu").click();
    await page
      .getByTestId("nav-sheet")
      .getByRole("checkbox", { name: "Bewegung reduzieren" })
      .check();
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
  });
});

test.describe("Kopfknöpfe", () => {
  test("1024 px: Einstellungen und Darstellung mit sichtbarer Beschriftung", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await expect(page.getByTestId("btn-open-settings")).toHaveText("Einstellungen");
    expect((await labelBox(page, ".rn-settings-button-label")).width).toBeGreaterThan(40);
    expect((await labelBox(page, ".rn-appearance-button-label")).width).toBeGreaterThan(40);
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("Einstellungen stehen nicht in der Navigation „Bereiche“", async ({ page }) => {
    // Reiter oben gibt es nur noch von 600 bis 899 px (Issue #325)
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Bereiche" });
    await expect(nav.getByRole("button")).toHaveCount(3);
    await expect(nav.getByTestId("btn-open-settings")).toHaveCount(0);
    await expect(page.getByRole("banner").getByTestId("btn-open-settings")).toBeVisible();
  });

  test("800 px: Kurzinfo bei Zeiger und Fokus, überfahrbar, Escape schließt", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto("/");
    const tip = ".rn-settings-button-label";
    // Ohne Zeiger und Fokus nur für Screenreader da
    expect((await labelBox(page, tip)).width).toBeLessThanOrEqual(1);

    await page.getByTestId("btn-open-settings").hover();
    const shown = await labelBox(page, tip);
    expect(shown.width).toBeGreaterThan(40);
    await expect(page.locator(tip)).toHaveText("Einstellungen");
    await expect(page.locator(tip)).toHaveCSS("font-size", /^(1[4-9]|[2-9]\d)/);

    // Zeiger auf die Kurzinfo selbst: sie bleibt
    await page.mouse.move(shown.x + shown.width / 2, shown.y + shown.height - 4);
    expect((await labelBox(page, tip)).width).toBeGreaterThan(40);

    // Escape blendet sie aus, ohne Zeiger oder Fokus zu bewegen
    await page.keyboard.press("Escape");
    expect((await labelBox(page, tip)).width).toBeLessThanOrEqual(1);

    // Nach dem Verlassen erscheint sie wieder, auch bei Tastaturfokus
    await page.mouse.move(10, 600);
    await page.getByTestId("btn-open-settings").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("btn-open-settings")).toBeFocused();
    expect((await labelBox(page, tip)).width).toBeGreaterThan(40);
    expect(await findLayoutProblems(page)).toEqual([]);

    // Darstellung genauso; bei offenem Menü keine Kurzinfo über dem Menü
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("btn-open-appearance")).toBeFocused();
    expect((await labelBox(page, ".rn-appearance-button-label")).width).toBeGreaterThan(40);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("appearance-menu")).toBeVisible();
    expect((await labelBox(page, ".rn-appearance-button-label")).width).toBeLessThanOrEqual(1);
  });

  test("640 px: Reiter unter dem Kopf mit sichtbarer Beschriftung", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 700 });
    await page.goto("/");
    // Eigene Leiste unter dem Kopf (Issue #325): genug Platz, die Namen stehen sichtbar da
    const label = page.getByTestId("top-tab-studio").locator(".rn-topnav-label");
    expect((await label.boundingBox())?.width ?? 0).toBeGreaterThan(30);
    await expect(page.getByTestId("top-tab-studio")).toHaveAccessibleName(/Studio/);
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

test.describe("Ab 900 px: Spalten statt Sprungziele oben", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Sprunglink fokussiert die Spalte ohne Markierung und ohne aria-current", async ({
    page
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("top-nav")).toBeHidden();
    await page.getByTestId("skip-link-sources").focus();
    await page.keyboard.press("Enter");
    const panel = page.locator("[data-panel='sources']");
    await expect(panel).toBeFocused();
    await expect(panel).not.toHaveAttribute("data-flash", /.*/);
    await expect(page.locator("[aria-current]:visible")).toHaveCount(0);
  });

  test("reduzierte Bewegung: Einklappen ohne Animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByTestId("btn-collapse-studio").click();
    await expect(page.getByTestId("rail-studio")).toBeVisible();
    expect(
      await page.getByTestId("panel-right-wrapper").evaluate((el) => el.getAnimations().length)
    ).toBe(0);
  });
});

test.describe("Untere Leiste (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Wechsel setzt den Fokus in den Bereich und aria-current", async ({ page }) => {
    await page.goto("/");
    for (const tab of ["studio", "sources", "chat"] as const) {
      await page.getByTestId(`tab-btn-${tab}`).click();
      await expect(page.locator(`[data-panel='${tab}']`)).toBeFocused();
      await expect(page.getByTestId(`tab-btn-${tab}`)).toHaveAttribute("aria-current", "true");
    }
  });

  test("Auswahlfelder mit 16 px (kein Zoom auf iOS)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-open-menu").click();
    const role = page.getByTestId("nav-sheet").getByTestId("role-switcher-select");
    await expect(role).toHaveCSS("font-size", "16px");
    await page.getByTestId("sheet-open-settings").click();
    await expect(page.getByTestId("model-router-select")).toHaveCSS("font-size", "16px");
  });

  test("Einstellungs-Sheet ohne Griff, der nichts tut", async ({ page }) => {
    await page.goto("/");
    const drawer = await openSettings(page);
    const grip = await drawer
      .locator(".rn-drawer-head")
      .evaluate((el) => getComputedStyle(el, "::before").content);
    expect(grip === "none" || grip === "normal").toBe(true);
  });
});

test.describe("Modellwahl bleibt gespeichert", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("übersteht Neuladen, unbekannte Werte fallen auf den Standard zurück", async ({ page }) => {
    await page.goto("/");
    const drawer = await openSettings(page);
    await drawer.getByTestId("model-router-select").selectOption("gpt-4o");
    expect(await page.evaluate(() => localStorage.getItem("rn_model"))).toBe("gpt-4o");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chat-panel")).toContainText("gpt-4o");

    await page.reload();
    await expect(page.getByTestId("chat-panel")).toContainText("gpt-4o");
    const again = await openSettings(page);
    await expect(again.getByTestId("model-router-select")).toHaveValue("gpt-4o");

    await page.evaluate(() => localStorage.setItem("rn_model", "unbekannt<script>"));
    await page.reload();
    await expect(page.getByTestId("chat-panel")).toContainText("gemini-2.5-flash");
    await expect(page.getByTestId("chat-panel")).not.toContainText("unbekannt");
  });
});

test.describe("Glossar: deutsche Begriffe, erklärte Kürzel", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Deutsch", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".rn-summary .rn-eyebrow")).toHaveText("Zusammenfassung");
    const studio = page.getByTestId("studio-panel");
    await expect(page.getByTestId("tool-card-audio")).toContainText("Audio-Überblick");
    await expect(page.getByTestId("tool-card-video")).toContainText("Video-Überblick");
    await expect(page.getByTestId("btn-open-audio-tool")).toHaveText("Anhören");
    await expect(page.getByTestId("tool-card-video")).toContainText("Videodatei im WebM-Format");
    await expect(page.getByTestId("tool-card-flashcards")).toContainText("SM-2-Verfahren");
    await expect(page.getByTestId("tool-card-flashcards")).toContainText("Lernkarten-App Anki");
    for (const english of ["Overview", "Player öffnen", "Executive"]) {
      await expect(page.locator("main")).not.toContainText(english);
    }
    await expect(studio).toBeVisible();
    const drawer = await openSettings(page);
    await expect(drawer).toContainText("BYOK steht für „Bring Your Own Key“");
  });

  test("Englisch", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    await expect(page.locator(".rn-summary .rn-eyebrow")).toHaveText("Summary");
    await expect(page.getByTestId("tool-card-audio")).toContainText("Audio overview");
    await expect(page.getByTestId("btn-open-audio-tool")).toHaveText("Listen");
    await expect(page.getByTestId("tool-card-flashcards")).toContainText("SM-2 method");
  });

  test("Telefon: Begriffe auch im Studio-Bereich", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await openPanel(page, "studio");
    await expect(page.getByTestId("tool-card-audio")).toContainText("Audio-Überblick");
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});
