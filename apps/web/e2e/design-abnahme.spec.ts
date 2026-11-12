import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, findLayoutProblems, openPanel } from "./helpers";

/**
 * Issue #335 (Design-Abnahme): Chat-Platz, Hinweisleiste, 1024 px, Teilen-Dialog,
 * Hilfstexte und gefüllte Symbole.
 */

/** Sichtbare Text-Zeilen eines Elements (nur Textknoten, Abzeichen zählen nicht extra). */
async function wrappedTexts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const lines = (el: Element): number => {
      const lh = Number.parseFloat(getComputedStyle(el).fontSize) * 1.2;
      const mids: number[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 0) mids.push(r.top + r.height / 2);
        }
        node = walker.nextNode();
      }
      mids.sort((a, b) => a - b);
      let count = mids.length ? 1 : 0;
      for (let i = 1; i < mids.length; i += 1) {
        if ((mids[i] ?? 0) - (mids[i - 1] ?? 0) > lh * 0.6) count += 1;
      }
      return count;
    };
    return [...document.querySelectorAll(sel)]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => lines(el) > 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 40));
  }, selector);
}

/** Liegen die Kinder einer Zeile (Flex mit Umbruch) in mehr als einer Reihe? */
async function rowWraps(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const row = document.querySelector(sel);
    if (!row) return false;
    const kids = [...row.children].filter((c) => (c as HTMLElement).offsetParent !== null);
    const first = kids[0]?.getBoundingClientRect();
    return Boolean(first && kids.some((c) => c.getBoundingClientRect().top >= first.bottom - 1));
  }, selector);
}

const CHAT_VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
] as const;

test.describe("Chat: nichts liegt unter der Eingabe", () => {
  for (const { width, height } of CHAT_VIEWPORTS) {
    test(`${width} px: letzter Vorschlag ganz sichtbar und bedienbar`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await openPanel(page, "chat");
      await expect(page.getByTestId("chat-empty-state")).toHaveCount(0);
      const result = await page.evaluate(() => {
        const log = document.querySelector(".chat-log") as HTMLElement;
        log.scrollTop = log.scrollHeight;
        const chips = [...document.querySelectorAll<HTMLElement>(".rn-chip")];
        const last = chips[chips.length - 1] as HTMLElement;
        const l = log.getBoundingClientRect();
        const c = last.getBoundingClientRect();
        const dock = (document.querySelector(".chat-dock") as HTMLElement).getBoundingClientRect();
        const hit = document.elementFromPoint(c.left + c.width / 2, c.bottom - 4);
        return {
          gapToLogEnd: l.bottom - c.bottom,
          dockBelowLog: dock.top >= l.bottom - 0.5,
          // Keine Blende der Eingabe ragt in den Verlauf
          dockOverlay: getComputedStyle(document.querySelector(".chat-dock") as Element, "::before")
            .content,
          hitIsChip: hit === last || last.contains(hit)
        };
      });
      // Abstand zum Ende des Verlaufs, Eingabe darunter, die Unterkante ist klickbar
      expect(result.gapToLogEnd).toBeGreaterThanOrEqual(16);
      expect(result.dockBelowLog).toBe(true);
      expect(result.dockOverlay).toBe("none");
      expect(result.hitIsChip).toBe(true);
    });
  }
});

test.describe("Hinweisleiste verdeckt keine Bedienelemente", () => {
  for (const { width, height, collapse } of [
    { width: 390, height: 844, collapse: false },
    { width: 1440, height: 900, collapse: true }
  ]) {
    test(`${width} px${collapse ? ", Spalten eingeklappt" : ""}`, async ({ page }) => {
      if (collapse) {
        await page.addInitScript(() =>
          localStorage.setItem("rn_collapsed_panels", '{"sources":true,"studio":true}')
        );
      }
      await page.setViewportSize({ width, height });
      await page.goto("/");
      // Hinweis auslösen: Link als Quelle hinzufügen
      await openPanel(page, "sources");
      await page.getByTestId("btn-open-url-dialog").click();
      await page.getByTestId("url-address-input").fill("https://example.org/bericht");
      await page.getByTestId("btn-submit-url-dialog").click();
      await expect(page.getByTestId("toast")).toBeVisible();
      await openPanel(page, "chat");
      const covered = await page.evaluate(() => {
        const toast = (document.querySelector(".rn-toast") as HTMLElement).getBoundingClientRect();
        const hits: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          "button, input, a, .rn-model-badge, [role='tab']"
        )) {
          if (el.closest(".rn-toast") || el.offsetParent === null) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const overlap =
            r.left < toast.right &&
            r.right > toast.left &&
            r.top < toast.bottom &&
            r.bottom > toast.top;
          if (overlap) hits.push((el.textContent ?? el.className).trim().slice(0, 30));
        }
        return hits;
      });
      expect(covered).toEqual([]);
      await expect(page.getByTestId("active-model-badge")).toBeInViewport({ ratio: 1 });
    });
  }
});

test.describe("1024 px: drei Bereiche ohne Umbrüche", () => {
  for (const design of DESIGNS) {
    test(`${design}: Studio startet eingeklappt, Knöpfe und Metadaten einzeilig`, async ({
      page
    }) => {
      await page.addInitScript((d) => localStorage.setItem("rn_design", d), design);
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto("/");
      await expect(page.locator(".panel-right")).toHaveAttribute("data-collapsed", "true");
      await expect(page.locator(".panel-left")).not.toHaveAttribute("data-collapsed", "true");
      expect(
        await wrappedTexts(
          page,
          ".panel-left .rn-btn, .panel-left .rn-source-meta, .rn-rail .rn-btn"
        )
      ).toEqual([]);
      expect(await rowWraps(page, ".rn-source-actions")).toBe(false);
      expect(await rowWraps(page, ".rn-sources-toolbar")).toBe(false);
      expect(await findLayoutProblems(page)).toEqual([]);
    });
  }

  test("eigene Wahl gilt: ausgeklapptes Studio bleibt nach dem Neuladen offen", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await openPanel(page, "studio");
    await expect(page.locator(".panel-right")).not.toHaveAttribute("data-collapsed", "true");
    await page.reload();
    await expect(page.locator(".panel-right")).not.toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("btn-open-mindmap-tool")).toBeVisible();
  });

  test("1440 px: alle drei Spalten offen, Quellen ohne Umbrüche", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".panel-right")).not.toHaveAttribute("data-collapsed", "true");
    expect(await wrappedTexts(page, ".panel-left .rn-btn, .panel-left .rn-source-meta")).toEqual(
      []
    );
    expect(await rowWraps(page, ".rn-sources-toolbar")).toBe(false);
  });
});

test.describe("Teilen-Dialog", () => {
  test("Senden ohne gestrichelten Rand, mit sichtbarem Hinweis", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("btn-open-share").click();
    const send = page.getByTestId("btn-share-send");
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("share-send-hint")).toHaveText("Bald verfügbar");
    await expect(page.getByTestId("share-send-hint")).toBeVisible();
    const style = await send.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(style).not.toBe("dashed");
    const box = await send.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe("Hilfstexte als Fließtext", () => {
  test("Leerzustand und Quellen-Untertitel 16 px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("sources-filter-input").fill("zzz");
    const sizes = await page.evaluate(() => ({
      empty: getComputedStyle(document.querySelector(".rn-empty-text") as Element).fontSize,
      help: getComputedStyle(document.querySelector(".rn-panel-sub--help") as Element).fontSize
    }));
    expect(sizes).toEqual({ empty: "16px", help: "16px" });
  });
});

test.describe("Symbole gefüllt", () => {
  test("Link, Audio und Spalten-Umschalter zeichnen Flächen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const kinds = await page.evaluate(() => {
      const of = (sel: string) => {
        const svg = document.querySelector(sel);
        return svg ? [...svg.querySelectorAll("path")].map((p) => p.getAttribute("fill")) : null;
      };
      return {
        link: of("[data-testid='btn-open-url-dialog'] svg"),
        toggle: of(".rn-panel-toggle svg"),
        audio: of("[data-testid='studio-panel'] .rn-tool svg")
      };
    });
    for (const [name, fills] of Object.entries(kinds)) {
      expect(fills, name).not.toBeNull();
      expect(fills, name).toContain("currentColor");
    }
  });
});
