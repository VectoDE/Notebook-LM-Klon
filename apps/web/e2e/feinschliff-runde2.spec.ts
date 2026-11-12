import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign, openPanel } from "./helpers";

/**
 * Runde 2: Feinschliff Design und Barrierefreiheit (Issue #315).
 * Mindmap auf dem Telefon, Farbschema-Liste, Scroll-Verlauf auf der Bühne, Typo-Zwischenstufe,
 * Startansicht mobil, Bühne unter 1024 px, flacher Orb in AAA, Bewegungsdauern, Schalter
 * „Bewegung reduzieren“, Trefferflächen der Kästchen, Rand der Ablagezone, Fehlertexte.
 */

/** Darstellung öffnen: Menü-Sheet auf dem Telefon, sonst das Kopfmenü. */
async function openAppearance(page: Page) {
  const menu = page.getByTestId("btn-open-menu");
  const narrow = await menu.isVisible();
  await (narrow ? menu : page.getByTestId("btn-open-appearance")).click();
  const container = page.getByTestId(narrow ? "nav-sheet" : "appearance-menu");
  await expect(container).toBeVisible();
  // Erst messen, wenn die Einblendung (Skalierung) fertig ist
  await container.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return container;
}

/** Kontrastverhältnis zweier rgb()-Farben nach WCAG. */
function contrastInPage(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    // Hintergrund: erster Vorfahr mit deckender Fläche
    let bgEl: Element | null = el.parentElement;
    let bg = "rgb(255, 255, 255)";
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      if (c && !c.startsWith("rgba(0, 0, 0, 0)") && c !== "transparent") {
        bg = c;
        break;
      }
      bgEl = bgEl.parentElement;
    }
    const border = getComputedStyle(el).borderTopColor;
    const a = lum(parse(border));
    const b = lum(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test.describe("Mindmap auf dem Telefon", () => {
  for (const width of [360, 390]) {
    test(`${width} px: startet mit der Baumliste, erste Ebene vollständig sichtbar`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/");
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-mindmap-tool").click();
      await expect(page.getByRole("tab", { name: "Baumliste", exact: true })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      const tree = page.getByRole("tree");
      await expect(tree).toBeVisible();
      const firstLevel = tree.locator('[role="treeitem"][aria-level="2"]');
      await expect(firstLevel).toHaveCount(2);
      for (const item of await firstLevel.all()) {
        const label = item.locator("strong").first();
        const m = await label.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            vw: document.documentElement.clientWidth,
            sw: el.scrollWidth,
            cw: el.clientWidth,
            font: Number.parseFloat(getComputedStyle(el).fontSize)
          };
        });
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.vw);
        expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
        expect(m.font).toBeGreaterThanOrEqual(14);
      }
      // Die Grafik bleibt einen Reiter entfernt
      await page.getByRole("tab", { name: "Grafik", exact: true }).click();
      await expect(page.getByTestId("mindmap-svg")).toBeVisible();
    });
  }

  test("1440 px: startet weiter mit der Grafik, ohne Eyebrow über dem Titel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("btn-open-mindmap-tool").click();
    await expect(page.getByRole("tab", { name: "Grafik", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator(".rn-tool-view-head .rn-eyebrow")).toHaveCount(0);
  });
});

test.describe("Farbschema-Auswahl", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: alle Optionen gleich hoch und einzeilig`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      // Farbschema steht in der Darstellung (Kopfmenü bzw. Menü-Sheet, Issue #319)
      const drawer = await openAppearance(page);
      const rows = drawer.locator(".rn-choice:has([data-testid^='mode-option-'])");
      await expect(rows).toHaveCount(4);
      const boxes = await rows.evaluateAll((els) =>
        els.map((el) => {
          const title = el.querySelector(".rn-choice-title") as HTMLElement;
          const range = document.createRange();
          range.selectNodeContents(title);
          const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
          return { h: Math.round(el.getBoundingClientRect().height), lines: lines.size };
        })
      );
      expect(new Set(boxes.map((b) => b.h)).size).toBe(1);
      for (const b of boxes) {
        expect(b.lines).toBe(1);
        expect(b.h).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe("Bühne", () => {
  test("Scroll-Verlauf an Bühne und Transkript", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
    const masks = await page.evaluate(() =>
      [".rn-stage-body", ".rn-lyrics"].map((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).maskImage : "";
      })
    );
    const supported = await page.evaluate(() => CSS.supports("animation-timeline: scroll()"));
    test.skip(!supported, "Browser ohne scroll-gesteuerte Animationen");
    for (const m of masks) expect(m).toContain("linear-gradient");
  });

  test("768 px: Orb oben, Transkript in voller Breite darunter", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
    const m = await page.evaluate(() => {
      const body = document.querySelector(".rn-stage-body") as HTMLElement;
      const orb = document.querySelector(".rn-stage-orb") as HTMLElement;
      const lyrics = document.querySelector(".rn-stage-lyrics") as HTMLElement;
      const cs = getComputedStyle(body);
      const inner =
        body.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
      return {
        orbBottom: orb.getBoundingClientRect().bottom,
        lyricsTop: lyrics.getBoundingClientRect().top,
        lyricsW: lyrics.getBoundingClientRect().width,
        inner
      };
    });
    expect(m.orbBottom).toBeLessThanOrEqual(m.lyricsTop);
    expect(m.lyricsW).toBeGreaterThanOrEqual(m.inner - 1);
  });

  test("AAA: Orb flach mit Rand, ohne Verlauf", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await chooseDesign(page, "pure", "aaa-contrast");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    const canvas = page.getByTestId("aurora-orb-canvas");
    await expect(canvas).toBeVisible();
    // Mitte und Bereich nahe am Rand haben dieselbe Füllfarbe (kein Verlauf)
    const same = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) return false;
      const mid = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
      const near = ctx.getImageData(c.width / 2 + c.width * 0.3, c.height / 2, 1, 1).data;
      return Array.from(mid).join() === Array.from(near).join() && mid[3] === 255;
    });
    expect(same).toBe(true);
  });
});

test.describe("Typografie", () => {
  for (const design of DESIGNS) {
    test(`${design}: Zwischenstufe zwischen Karten- und Paneltitel`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await chooseDesign(page, design, "light");
      const size = (sel: string) =>
        page
          .locator(sel)
          .first()
          .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      const panel = await size(".panel-right h2");
      const card = await size(".rn-tool-title");
      await page.getByTestId("btn-open-quiz-tool").click();
      const tool = await size(".rn-tool-view-title");
      expect(tool).toBeGreaterThan(card);
      expect(tool).toBeLessThan(panel);
    });
  }
});

test.describe("Startansicht mobil", () => {
  for (const width of [360, 390]) {
    test(`${width} px: erste Antwort sichtbar, Text ortsneutral`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
      await page.goto("/");
      const msg = page.getByTestId("chat-message-msg_intro");
      await expect(msg).toContainText("im Bereich Studio");
      await expect(msg).not.toContainText("rechts");
      const visible = await msg.evaluate((el) => {
        const log = el.closest(".chat-log") as HTMLElement;
        const r = el.getBoundingClientRect();
        const l = log.getBoundingClientRect();
        return r.top >= l.top && r.bottom <= l.bottom;
      });
      expect(visible).toBe(true);
    });
  }
});

test.describe("Bewegung", () => {
  test("UI-Übergänge dauern höchstens 300 ms", async ({ page }) => {
    for (const design of DESIGNS) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await chooseDesign(page, design, "light");
      await page.reload();
      const long = await page.evaluate(() =>
        document
          .getAnimations()
          .map((a) => a.effect?.getTiming())
          .filter((t) => t && t.iterations !== Number.POSITIVE_INFINITY)
          .map((t) => Number(t?.duration ?? 0))
          .filter((d) => d > 300)
      );
      expect(long, design).toEqual([]);
    }
  });

  for (const design of ["fusion", "immersive-cinema"] as const) {
    test(`${design}: Schalter „Bewegung reduzieren“ hält Hintergrundanimationen an`, async ({
      page
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await chooseDesign(page, design, "dark");
      const infinite = () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.playState === "running" &&
                  a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY
              ).length
        );
      expect(await infinite()).toBeGreaterThan(0);

      // Der Schalter gehört zur Darstellung (Issue #319)
      const drawer = await openAppearance(page);
      const toggle = drawer.getByRole("checkbox", { name: "Bewegung reduzieren" });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
      expect(await page.evaluate(() => localStorage.getItem("rn_reduce_motion"))).toBe("true");
      await expect.poll(infinite).toBe(0);

      // Bleibt nach dem Neuladen erhalten
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
      expect(await infinite()).toBe(0);

      // Wieder aus: Hintergrund läuft wieder
      const again = await openAppearance(page);
      await again.getByRole("checkbox", { name: "Bewegung reduzieren" }).uncheck();
      await expect(page.locator("html")).not.toHaveAttribute("data-reduce-motion", "true");
      await page.keyboard.press("Escape");
      await expect.poll(infinite).toBeGreaterThan(0);
    });
  }

  test("Schalter auf Englisch beschriftet", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    const drawer = await openAppearance(page);
    await expect(drawer.getByRole("checkbox", { name: "Reduce motion" })).toBeVisible();
  });
});

test.describe("Trefferflächen und Ablagezone", () => {
  for (const width of [390, 1440]) {
    test(`${width} px: Kästchen über das Label mindestens 44 px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await openPanel(page, "sources");
      const all = page.locator("label.rn-select-all");
      const allBox = await all.boundingBox();
      expect(allBox?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      const hits = page.locator("label.rn-check-hit");
      await expect(hits).toHaveCount(2);
      for (const hit of await hits.all()) {
        const box = await hit.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      }
      // Klick auf den Rand der Trefferfläche schaltet das Kästchen
      const first = page.getByTestId("source-checkbox-src_1");
      await expect(first).toBeChecked();
      const box = await hits.first().boundingBox();
      if (box) await page.mouse.click(box.x + 3, box.y + 3);
      await expect(first).not.toBeChecked();
      // Ganze Zeile „Alle Quellen auswählen“ schaltet
      if (allBox) await page.mouse.click(allBox.x + allBox.width - 8, allBox.y + allBox.height / 2);
      await expect(first).toBeChecked();
    });
  }

  for (const design of DESIGNS) {
    for (const mode of MODES) {
      test(`${design}/${mode}: Rand der Ablagezone mindestens 3:1`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/");
        await chooseDesign(page, design, mode);
        const ratio = await contrastInPage(page, "[data-testid=dropzone-area]");
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

test.describe("Fehlertexte", () => {
  test("Chat: Klartext mit Handlungshinweis, Statuscode nur als Detail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/v1/notebooks/*/chat", (route) =>
      route.fulfill({ status: 404, body: "" })
    );
    await page.goto("/");
    await page.getByTestId("chat-input-field").fill("Was steht in den Quellen?");
    await page.getByTestId("chat-input-field").press("Enter");
    const alert = page.locator(".rn-msg-error").last();
    await expect(alert).toBeVisible();
    const text = alert.locator(".rn-msg-error-text");
    await expect(text).toContainText("Laden Sie die Seite neu");
    const detail = alert.locator(".rn-msg-error-detail");
    await expect(detail).toHaveText(/Technische Angabe: HTTP 404/);
    // Der Hauptsatz beginnt nicht mit dem Code
    const main = await text.evaluate((el) => el.firstChild?.textContent ?? "");
    expect(main).not.toContain("HTTP");
    await expect(page.getByTestId("btn-retry-chat")).toBeVisible();
  });

  test("Chat: Netzwerkfehler mit Hinweis auf die Verbindung", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/v1/notebooks/*/chat", (route) => route.abort("failed"));
    await page.goto("/");
    await page.getByTestId("chat-input-field").fill("Hallo");
    await page.getByTestId("chat-input-field").press("Enter");
    await expect(page.locator(".rn-msg-error-text").last()).toContainText(
      "Prüfen Sie Ihre Internetverbindung"
    );
  });
});
