import { type Locator, type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, findLayoutProblems } from "./helpers";

/**
 * Desktop wie NotebookLM (Issue #325): ab 900 px sind die Spalten die Navigation, Quellen
 * und Studio klappen auf eine Symbolleiste ein (Maus, Kürzel, gespeichert), die
 * Anwendungsleiste trägt Titel, Teilen, Darstellung, Einstellungen und Konto.
 */

const isFocused = (locator: Locator) =>
  locator.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));

/** Breite eines Elements in px. */
const widthOf = async (locator: Locator) => (await locator.boundingBox())?.width ?? 0;

/** Kontrast Text zu Fläche (WCAG); Fläche: das Element selbst oder der erste deckende Vorfahr. */
function textContrast(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    let bgEl: Element | null = el;
    let bg = "rgb(255, 255, 255)";
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      const alpha = parse(c)[3];
      if (c && c !== "transparent" && (alpha === undefined || alpha >= 0.99)) {
        bg = c;
        break;
      }
      bgEl = bgEl.parentElement;
    }
    const a = lum(parse(getComputedStyle(el).color));
    const b = lum(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function storedCollapsed(page: Page) {
  return page.evaluate(() => localStorage.getItem("rn_collapsed_panels"));
}

test.describe("1440 px: Spalten statt Reiter", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keine obere Reiterleiste, Sprunglinks führen in die Spalten", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("top-nav")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Bereiche" })).toHaveCount(0);
    await expect(page.locator("[aria-current]:visible")).toHaveCount(0);
    // Tab 1: zum Inhalt, Tab 2 bis 4: zu den Spalten
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).toBeFocused();
    for (const [tab, name] of [
      ["sources", "Zu den Quellen"],
      ["chat", "Zum Chat"],
      ["studio", "Zum Studio"]
    ] as const) {
      await page.keyboard.press("Tab");
      const link = page.getByTestId(`skip-link-${tab}`);
      await expect(link).toBeFocused();
      await expect(link).toHaveText(name);
      expect((await link.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    }
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-panel='studio']")).toBeFocused();
    // Keine Sprungmarkierung mehr (Issue #325)
    await expect(page.locator("[data-flash]")).toHaveCount(0);
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("Einklappen per Maus: Leiste, aria-expanded, Fokus auf dem Umschalter, Mitte wird breiter", async ({
    page
  }) => {
    await page.goto("/");
    const center = page.getByTestId("panel-center-wrapper");
    const before = await widthOf(center);
    const collapse = page.getByTestId("btn-collapse-sources");
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(collapse).toHaveAttribute("aria-controls", "sources-column");
    await expect(collapse).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+1");
    await expect(collapse).toHaveAccessibleName("Quellen einklappen");
    await collapse.click();

    const rail = page.getByTestId("rail-sources");
    await expect(rail).toBeVisible();
    await expect(page.locator("#sources-column")).toBeHidden();
    const expand = page.getByTestId("btn-expand-sources");
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(expand).toHaveAttribute("aria-controls", "sources-column");
    await expect(expand).toHaveAccessibleName("Quellen ausklappen");
    await expect(page.getByTestId("layout-status")).toHaveText("Quellen eingeklappt");
    await expect(page.getByTestId("rail-add-source")).toHaveAccessibleName("Quelle hinzufügen");
    // Leiste schmal, die Mitte nutzt den Platz
    await expect.poll(() => widthOf(page.getByTestId("panel-left-wrapper"))).toBeLessThan(70);
    await expect.poll(() => widthOf(center)).toBeGreaterThan(before + 150);

    // Studio ebenso, dann wieder ausklappen
    await page.getByTestId("btn-collapse-studio").click();
    await expect(page.getByTestId("btn-expand-studio")).toBeFocused();
    await expect(page.getByTestId("rail-studio").getByRole("button")).toHaveCount(6);
    expect(await findLayoutProblems(page)).toEqual([]);

    await expand.click();
    await expect(page.getByTestId("btn-collapse-sources")).toBeFocused();
    await expect(page.getByTestId("rail-sources")).toHaveCount(0);
    await expect(page.locator("[data-panel='sources']")).toBeVisible();
    await expect(page.getByTestId("layout-status")).toHaveText("Quellen ausgeklappt");
  });

  test("Kürzel Alt+Umschalt+1 und +3, auch aus dem Chatfeld; Fokus bleibt sinnvoll", async ({
    page
  }) => {
    await page.goto("/");
    const input = page.getByTestId("chat-input-field");
    await input.click();
    await input.fill("Hallo");
    await page.keyboard.press("Alt+Shift+Digit3");
    await expect(page.getByTestId("rail-studio")).toBeVisible();
    // Fokus lag nicht in der Spalte: er bleibt im Chatfeld, der Text bleibt unverändert
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Hallo");
    await page.keyboard.press("Alt+Shift+Digit3");
    await expect(page.getByTestId("rail-studio")).toHaveCount(0);
    await expect(input).toBeFocused();

    // Fokus in der Quellen-Spalte: nach dem Einklappen auf dem Umschalter
    await page.getByTestId("sources-filter-input").focus();
    await page.keyboard.press("Alt+Shift+Digit1");
    await expect(page.getByTestId("btn-expand-sources")).toBeFocused();
    await expect(page.getByTestId("layout-status")).toHaveText("Quellen eingeklappt");
    await page.keyboard.press("Alt+Shift+Digit1");
    await expect(page.locator("[data-panel='sources']")).toBeVisible();
    await expect(page.getByTestId("btn-collapse-sources")).toBeFocused();

    // Ziffernblock und Kürzel ohne Umschalt: nur das echte Kürzel wirkt
    await page.keyboard.press("Alt+Digit1");
    await expect(page.getByTestId("rail-sources")).toHaveCount(0);

    // Bei offenem modalen Dialog wirkt das Kürzel nicht
    await page.getByTestId("btn-open-settings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
    await page.keyboard.press("Alt+Shift+Digit1");
    await expect(page.getByTestId("rail-sources")).toHaveCount(0);
  });

  test("Kurzinfo nennt Name und Kürzel, Escape blendet sie aus", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-collapse-studio").click();
    const expand = page.getByTestId("btn-expand-studio");
    await expand.hover();
    const tip = expand.locator(".rn-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Studio ausklappen");
    await expect(tip).toContainText("Alt+Umschalt+3");
    expect(await widthOf(tip)).toBeGreaterThan(60);
    // Studio-Leiste rechts: die Kurzinfo geht nach links auf und bleibt im Bild
    const box = await tip.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1440);
    expect(await findLayoutProblems(page)).toEqual([]);
    await page.keyboard.press("Escape");
    // Nur noch für Screenreader da (1 px plus transparenter Abstandsrand)
    expect(await widthOf(tip)).toBeLessThanOrEqual(8);
    // Werkzeug-Symbole mit Namen
    for (const name of [
      "Audio-Überblick",
      "Video-Überblick",
      "Wissens-Mindmap",
      "Lernkarten",
      "Quiz"
    ]) {
      await expect(page.getByTestId("rail-studio").getByRole("button", { name })).toBeVisible();
    }
  });

  test("Zustand bleibt nach dem Neuladen, Werkzeug aus der Leiste öffnet das Studio", async ({
    page
  }) => {
    await page.goto("/");
    await page.getByTestId("btn-collapse-sources").click();
    await page.getByTestId("btn-collapse-studio").click();
    expect(await storedCollapsed(page)).toBe('{"sources":true,"studio":true}');
    await page.reload();
    await expect(page.getByTestId("rail-sources")).toBeVisible();
    await expect(page.getByTestId("rail-studio")).toBeVisible();

    await page.getByTestId("rail-tool-quiz").click();
    await expect(page.getByTestId("rail-studio")).toHaveCount(0);
    await expect(page.getByTestId("btn-back-to-studio-overview")).toBeVisible();
    await expect(page.locator("[data-panel='studio']")).toBeFocused();
    expect(await storedCollapsed(page)).toBe('{"sources":true,"studio":false}');

    // Datei über die Leiste hinzufügen: die Spalte bleibt eingeklappt, die Quelle ist da
    await page.getByTestId("rail-file-input").setInputFiles({
      name: "notizen.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Notizen")
    });
    await expect(page.getByTestId("rail-sources")).toBeVisible();
    await page.getByTestId("btn-expand-sources").click();
    await expect(page.getByTestId("sources-count-badge")).toHaveText("3 Quellen");
  });

  test("Zitat aus dem Chat klappt die Quellen aus", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("btn-collapse-sources").click();
    await page.locator("[data-testid^='citation-']").first().click();
    await expect(page.getByTestId("rail-sources")).toHaveCount(0);
    await expect(page.getByTestId("source-inspector-drawer")).toBeVisible();
  });

  test("reduzierte Bewegung: Einklappen ohne Übergang, sonst mit Übergang", async ({ page }) => {
    // Längste Übergangsdauer der Spaltenbreite in ms (laufende Übergänge sind zu kurz zum Messen)
    const transitionMs = () =>
      page.getByTestId("panel-left-wrapper").evaluate((el) => {
        const style = getComputedStyle(el);
        const props = style.transitionProperty.split(",").map((p) => p.trim());
        const durations = style.transitionDuration
          .split(",")
          .map((d) => Number.parseFloat(d) * 1000);
        return Math.max(
          0,
          ...props.map((p, i) =>
            p === "flex-basis" || p === "all" ? (durations[i % durations.length] ?? 0) : 0
          )
        );
      });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    expect(await transitionMs()).toBeGreaterThan(50);
    await page.getByTestId("btn-collapse-sources").click();
    await expect(page.getByTestId("rail-sources")).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    expect(await transitionMs()).toBeLessThan(1);
    await page.getByTestId("btn-expand-sources").click();
    await expect(page.getByTestId("rail-sources")).toHaveCount(0);

    // Schalter „Bewegung reduzieren“ in der App wirkt genauso
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => localStorage.setItem("rn_reduce_motion", "true"));
    await page.reload();
    expect(await transitionMs()).toBeLessThan(1);
  });
});

test.describe("Notebook-Titel bearbeiten", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Klick, Enter speichert, Titel bleibt nach dem Neuladen", async ({ page }) => {
    await page.goto("/");
    const button = page.getByTestId("notebook-title-button");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Cloudflare Edge Stack Architecture"
    );
    await expect(page.getByRole("main")).toHaveAccessibleName("Cloudflare Edge Stack Architecture");
    await expect(button).toHaveAccessibleDescription("Zum Umbenennen auswählen");
    await button.click();
    const input = page.getByTestId("notebook-title-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAccessibleName("Notebook-Titel");
    await expect(input).toHaveValue("Cloudflare Edge Stack Architecture");
    await input.fill("  Mein   Projekt ");
    await page.keyboard.press("Enter");
    await expect(input).toHaveCount(0);
    await expect(button).toHaveText("Mein Projekt");
    await expect(button).toBeFocused();
    // Rückmeldung in der Hinweis-Leiste (role="status", Issue #329)
    await expect(page.getByTestId("toast-text")).toHaveText("Titel gespeichert: Mein Projekt");
    // Zusammenfassung im Chat folgt dem Titel
    await expect(page.locator(".rn-summary-title")).toHaveText("Mein Projekt");
    await page.reload();
    await expect(page.getByTestId("notebook-title-button")).toHaveText("Mein Projekt");
  });

  test("Tastatur: Enter öffnet, Escape verwirft, leere Eingabe behält den Titel", async ({
    page
  }) => {
    await page.goto("/");
    const button = page.getByTestId("notebook-title-button");
    await button.focus();
    await page.keyboard.press("Enter");
    const input = page.getByTestId("notebook-title-input");
    await expect(input).toBeFocused();
    await page.keyboard.type("Verworfen");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(button).toHaveText("Cloudflare Edge Stack Architecture");
    await expect(button).toBeFocused();

    await page.keyboard.press("Space");
    await expect(input).toBeFocused();
    await input.fill("   ");
    await page.keyboard.press("Enter");
    await expect(button).toHaveText("Cloudflare Edge Stack Architecture");
    expect(await page.evaluate(() => localStorage.getItem("rn_notebook_titles"))).toBeNull();

    // Verlassen des Felds speichert ebenfalls
    await button.click();
    await input.fill("Per Blur");
    await page.getByTestId("chat-input-field").click();
    await expect(button).toHaveText("Per Blur");
  });
});

test.describe("Teilen-Dialog (nur Oberfläche)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Tastatur: öffnen, Fokusfalle, ehrliche Meldung, Escape, Fokus zurück, kein Netzwerk", async ({
    page
  }) => {
    await page.goto("/");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/@") && !request.url().includes("/src/")) {
        requests.push(`${request.method()} ${request.url()}`);
      }
    });
    const trigger = page.getByTestId("btn-open-share");
    await expect(trigger).toHaveAccessibleName("Teilen");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "„Cloudflare Edge Stack Architecture“ teilen"
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/Freigabe noch nicht verfügbar/);
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
    await expect(page.getByTestId("share-email-input")).toBeFocused();
    await expect(page.getByTestId("share-notice")).toContainText(
      "Einladungen werden noch nicht verschickt"
    );
    await expect(dialog.getByText("Gast (Sie)")).toBeVisible();

    // Fokusfalle in beide Richtungen
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      expect(await isFocused(dialog)).toBe(true);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await isFocused(dialog)).toBe(true);
    }

    await page.getByTestId("share-email-input").fill("kollegin@beispiel.de");
    const role = page.getByTestId("share-role-select");
    await expect(role).toHaveValue("viewer");
    await role.selectOption("editor");
    const options = await role.locator("option").allTextContents();
    expect(options).toEqual(["Eigentümer", "Bearbeiten", "Betrachten"]);
    const send = page.getByTestId("btn-share-send");
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("share-status")).toHaveText(
      "Nicht gesendet: Die Freigabe ist noch nicht verfügbar."
    );
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(requests).toEqual([]);

    // Maus: „Fertig“ schließt ebenfalls, die Meldung ist beim nächsten Öffnen weg
    await trigger.click();
    await expect(page.getByTestId("share-status")).toHaveText("");
    await page.getByTestId("btn-share-done").click();
    await expect(page.getByTestId("share-dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

test.describe("Konto-Menü: Gast", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Maus und Tastatur, Escape, Fokus zurück, Einstellungen aus dem Menü", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByTestId("btn-open-account");
    await expect(trigger).toHaveAccessibleName("Konto");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Konto" });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toContainText("Gast");
    await expect(menu).toContainText("Nicht angemeldet");
    await expect(menu.locator("input")).toHaveCount(0);
    expect(await findLayoutProblems(page)).toEqual([]);
    // Klick außerhalb schließt
    await page.mouse.click(700, 500);
    await expect(menu).toBeHidden();

    await trigger.focus();
    await page.keyboard.press("Enter");
    // Fokusfalle mit zwei Knöpfen: Anmelden, Einstellungen (Issue #233)
    await expect(page.getByTestId("account-open-sign-in")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("account-open-settings")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("account-open-sign-in")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("account-open-settings")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByTestId("account-open-settings").click();
    await expect(page.getByRole("dialog", { name: /Einstellungen/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});

test.describe("600 bis 899 px: ein Bereich, Reiter unter dem Kopf", () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test("Reiter mit aria-current, keine Umschalter, Kürzel ohne Wirkung", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("rn_collapsed_panels", '{"sources":true,"studio":true}')
    );
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Bereiche" });
    await expect(nav).toBeVisible();
    // Die Reiter liegen außerhalb der Anwendungsleiste, direkt darunter
    expect(await page.getByTestId("top-nav").evaluate((el) => Boolean(el.closest("header")))).toBe(
      false
    );
    await expect(page.getByTestId("top-tab-chat")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("top-tab-studio").click();
    await expect(page.locator("[data-panel='studio']")).toBeVisible();
    await expect(page.getByTestId("rail-studio")).toHaveCount(0);
    await expect(page.getByTestId("btn-collapse-studio")).toBeHidden();
    await page.keyboard.press("Alt+Shift+Digit3");
    await expect(page.locator("[data-panel='studio']")).toBeVisible();
    expect(await findLayoutProblems(page)).toEqual([]);
  });
});

for (const width of [360, 390, 430]) {
  test.describe(`Telefon ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("Kopf kompakt mit Titel, Teilen und Konto im Menü, Leiste unten", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("notebook-title-button")).toBeVisible();
      for (const id of ["btn-open-share", "btn-open-account", "btn-open-settings"]) {
        await expect(page.getByTestId(id)).toBeHidden();
      }
      await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
      await expect(page.getByTestId("top-nav")).toBeHidden();
      const header = await page.getByTestId("workspace-header").boundingBox();
      expect(header?.height ?? 0).toBeLessThanOrEqual(80);
      expect(await findLayoutProblems(page)).toEqual([]);

      // Titel auch hier bearbeitbar
      await page.getByTestId("notebook-title-button").click();
      await page.getByTestId("notebook-title-input").fill("Mobil");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("notebook-title-button")).toHaveText("Mobil");

      // Menü: Teilen und Konto
      await page.getByTestId("btn-open-menu").click();
      const sheet = page.getByTestId("nav-sheet");
      await expect(sheet.getByTestId("sheet-account")).toContainText("Nicht angemeldet");
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.getByTestId("sheet-open-share").click();
      await expect(sheet).toBeHidden();
      const dialog = page.getByTestId("share-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Freigabe noch nicht verfügbar");
      expect(await findLayoutProblems(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("btn-open-menu")).toBeFocused();

      // Untere Leiste schaltet weiter um
      for (const tab of ["studio", "sources", "chat"] as const) {
        await page.getByTestId(`tab-btn-${tab}`).click();
        await expect(page.getByTestId(`tab-btn-${tab}`)).toHaveAttribute("aria-current", "true");
        await expect(page.locator(`[data-panel='${tab}']`)).toBeFocused();
      }
    });
  });
}

test.describe("Kontrast der neuen Elemente in allen Designs und Modi", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const design of DESIGNS) {
    test(`${design}: Titel, Kurzinfo, Teilen-Hinweis und Konto mit 7:1, Symbole 3:1`, async ({
      page
    }) => {
      await page.goto("/");
      for (const mode of MODES) {
        await chooseDesign(page, design, mode);
        const label = `${design}/${mode}`;
        expect(await textContrast(page.locator(".rn-nb-title-text")), label).toBeGreaterThanOrEqual(
          7
        );
        expect(
          await textContrast(page.getByTestId("btn-collapse-sources").locator("svg")),
          `${label} Umschalter`
        ).toBeGreaterThanOrEqual(3);

        await page.getByTestId("btn-collapse-studio").click();
        const expand = page.getByTestId("btn-expand-studio");
        await expand.hover();
        expect(
          await textContrast(expand.locator(".rn-tip")),
          `${label} Kurzinfo`
        ).toBeGreaterThanOrEqual(7);
        for (const button of await page.getByTestId("rail-studio").getByRole("button").all()) {
          expect(
            await textContrast(button.locator("svg")),
            `${label} Leiste`
          ).toBeGreaterThanOrEqual(3);
        }
        await expand.click();
        await page.mouse.move(700, 600);

        await page.getByTestId("btn-open-share").click();
        for (const selector of [
          ".rn-share-notice-title",
          ".rn-share-notice-text",
          ".rn-share-person-name",
          ".rn-share-person-role"
        ]) {
          expect(
            await textContrast(page.locator(selector)),
            `${label} ${selector}`
          ).toBeGreaterThanOrEqual(7);
        }
        await page.keyboard.press("Escape");

        await page.getByTestId("btn-open-account").click();
        for (const selector of [".rn-account-name", ".rn-account-state", ".rn-account-hint"]) {
          expect(
            await textContrast(page.locator(selector).first()),
            `${label} ${selector}`
          ).toBeGreaterThanOrEqual(7);
        }
        await page.keyboard.press("Escape");
      }
    });
  }
});
