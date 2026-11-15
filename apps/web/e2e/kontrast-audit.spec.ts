import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, MODES, chooseDesign } from "./helpers";

/**
 * Kontrast-Audit WCAG 2.2 AAA am gerenderten Bildschirm (Issues #252, #254).
 *
 * Je Design und Farbmodus (4 x 3) wird gemessen, was der Browser wirklich zeichnet:
 * - Grundfläche und Textfarbe der Seite (dunkle Modi dunkel, helle Modi hell),
 * - jeder sichtbare Text gegen seine erste deckende Hintergrundfarbe:
 *   7:1, große Schrift (ab 24 px bzw. 18,66 px fett) 4,5:1 (SC 1.4.6),
 * - Fokusrahmen per Tastatur: mindestens 2 px und 3:1 zur Fläche (SC 1.4.11, 2.4.13),
 * - Überfahren (hover) des Hauptknopfs: Text weiterhin 7:1,
 * - Fehlermeldung (ungültige Adresse im Quellen-Dialog): 7:1,
 * - deaktivierte Bedienelemente: gemessen und berichtet; sie sind nach SC 1.4.6
 *   ausgenommen ("inactive user interface component") und brechen den Test nicht.
 *
 * Text auf Bildern oder Verläufen ist rechnerisch nicht bestimmbar; er wird gezählt und im
 * Bericht ausgewiesen, aber nicht bewertet. Der Bericht liegt je Design als JSON und
 * Markdown unter test-results/kontrast-bericht/ und wird in CI als Artefakt hochgeladen.
 */

const REPORT_DIR = resolve(import.meta.dirname, "../test-results/kontrast-bericht");

interface TextFinding {
  readonly text: string;
  readonly ratio: number;
  readonly min: number;
}

interface Measurement {
  readonly canvas: { background: string; color: string; ratio: number; luminance: number };
  readonly textCount: number;
  readonly unmeasurable: number;
  readonly minText: number;
  readonly failures: TextFinding[];
}

/** Misst Grundfläche und alle sichtbaren Texte der aktuellen Ansicht. */
function measureTexts(page: Page): Promise<Measurement> {
  return page.evaluate(() => {
    // rgb()/rgba() liefert 0 bis 255; color(srgb …) aus color-mix() liefert 0 bis 1
    const parse = (c: string) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
    };
    const lum = (rgb: number[]) => {
      const [r = 0, g = 0, b = 0] = rgb.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    /** Erste deckende Hintergrundfarbe; null bei Bild/Verlauf oder Transparenz im Weg. */
    const backgroundOf = (el: Element): number[] | null => {
      let node: Element | null = el;
      while (node) {
        const s = getComputedStyle(node);
        if (s.backgroundImage !== "none") return null;
        const c = parse(s.backgroundColor);
        const alpha = c[3];
        if (c.length >= 3 && (alpha === undefined || alpha >= 0.99)) return c;
        if (alpha !== undefined && alpha > 0) return null;
        node = node.parentElement;
      }
      return null;
    };
    // Grundfläche der App: die Arbeitsfläche trägt --rn-color-canvas
    const bodyStyle = getComputedStyle(document.querySelector(".workspace-shell") ?? document.body);
    const canvasBg = parse(bodyStyle.backgroundColor);
    const canvasFg = parse(bodyStyle.color);

    const failures: { text: string; ratio: number; min: number }[] = [];
    let textCount = 0;
    let unmeasurable = 0;
    let minText = 21;
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = (node.textContent ?? "").trim();
      if (!el || !text || seen.has(el) || el.closest("svg, [aria-hidden='true']")) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || s.visibility === "hidden" || Number(s.opacity) < 0.1) {
        continue;
      }
      // Nur für Screenreader (1 x 1 px mit clip) zählt nicht als sichtbarer Text
      if (s.clip !== "auto" && r.width <= 1) continue;
      // Deaktivierte Bedienelemente sind nach SC 1.4.6 ausgenommen
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      const fg = parse(s.color);
      const bg = backgroundOf(el);
      if (!bg || (fg[3] !== undefined && fg[3] < 0.99)) {
        unmeasurable += 1;
        continue;
      }
      textCount += 1;
      const size = Number.parseFloat(s.fontSize);
      const bold = Number.parseInt(s.fontWeight, 10) >= 700;
      const min = size >= 24 || (bold && size >= 18.66) ? 4.5 : 7;
      const value = ratio(fg, bg);
      minText = Math.min(minText, value);
      if (value < min - 0.005) failures.push({ text: text.slice(0, 50), ratio: value, min });
    }
    return {
      canvas: {
        background: bodyStyle.backgroundColor,
        color: bodyStyle.color,
        ratio: ratio(canvasFg, canvasBg),
        luminance: lum(canvasBg)
      },
      textCount,
      unmeasurable,
      minText,
      failures
    };
  });
}

interface FocusFinding {
  readonly target: string;
  readonly width: number;
  readonly ratio: number;
}

/** Tab durch die ersten Bedienelemente; Fokusrahmen gegen die Fläche dahinter. */
async function measureFocus(page: Page, steps: number): Promise<FocusFinding[]> {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const found: FocusFinding[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // rgb()/rgba() liefert 0 bis 255; color(srgb …) aus color-mix() liefert 0 bis 1
      const parse = (c: string) => {
        const n = (c.match(/[\d.]+/g) ?? []).map(Number);
        return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
      };
      const lum = (rgb: number[]) => {
        const [r = 0, g = 0, b = 0] = rgb.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const s = getComputedStyle(el);
      // Fläche um das Element: erste deckende Farbe ab dem Elternteil
      let node: Element | null = el.parentElement;
      let bg = [255, 255, 255];
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const ring = parse(s.outlineStyle === "none" ? s.borderTopColor : s.outlineColor);
      const width = s.outlineStyle === "none" ? 0 : Number.parseFloat(s.outlineWidth || "0");
      const a = lum(ring);
      const b = lum(bg);
      return {
        target: `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className}]`,
        width,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      };
    });
    if (result) found.push(result);
  }
  return found;
}

/** Kontrast Text zu eigener (sonst geerbter) deckender Fläche eines Elements. */
function elementContrast(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      // rgb()/rgba() liefert 0 bis 255; color(srgb …) aus color-mix() liefert 0 bis 1
      const parse = (c: string) => {
        const n = (c.match(/[\d.]+/g) ?? []).map(Number);
        return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
      };
      const lum = (rgb: number[]) => {
        const [r = 0, g = 0, b = 0] = rgb.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      let node: Element | null = el;
      let bg = [255, 255, 255];
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const a = lum(parse(getComputedStyle(el).color));
      const b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
}

/** Deaktivierte Bedienelemente der Ansicht mit Kontrast (nur Bericht). */
function measureDisabled(page: Page): Promise<{ target: string; ratio: number }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button:disabled, [aria-disabled='true']"))
      .filter((el) => el.getBoundingClientRect().width > 1)
      .map((el) => {
        // rgb()/rgba() liefert 0 bis 255; color(srgb …) aus color-mix() liefert 0 bis 1
        const parse = (c: string) => {
          const n = (c.match(/[\d.]+/g) ?? []).map(Number);
          return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
        };
        const lum = (rgb: number[]) => {
          const [r = 0, g = 0, b = 0] = rgb.slice(0, 3).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        let node: Element | null = el;
        let bg = [255, 255, 255];
        while (node) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c.length >= 3 && (c[3] === undefined || c[3] >= 0.99)) {
            bg = c;
            break;
          }
          node = node.parentElement;
        }
        const a = lum(parse(getComputedStyle(el).color));
        const b = lum(bg);
        return {
          target: el.getAttribute("data-testid") ?? el.className,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        };
      })
  );
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

for (const design of DESIGNS) {
  test(`${design}: Kontrast-Audit AAA in Hell, Dunkel und AAA-Kontrast`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const rows: string[] = [];
    const json: Record<string, unknown> = {};

    for (const mode of MODES) {
      await chooseDesign(page, design, mode);
      await page.mouse.move(1, 1);
      const label = `${design}/${mode}`;

      // 1. Grundfläche: dunkle Modi dunkel, helle Modi hell, Text darauf 7:1 (#252)
      const texts = await measureTexts(page);
      // AAA-Kontrast ist je Design hell (Pure, Editorial) oder dunkel (Cinema, Fusion)
      if (mode === "dark") {
        expect(texts.canvas.luminance, `${label} Grundfläche dunkel`).toBeLessThan(0.05);
      } else if (mode === "light") {
        expect(texts.canvas.luminance, `${label} Grundfläche hell`).toBeGreaterThan(0.6);
      }
      expect(texts.canvas.background, `${label} Grundfläche = Token`).toBe(
        await page.evaluate(() => {
          const probe = document.createElement("div");
          probe.style.backgroundColor = "var(--rn-color-canvas)";
          document.body.append(probe);
          const value = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return value;
        })
      );
      expect(texts.canvas.ratio, `${label} Seitentext`).toBeGreaterThanOrEqual(7);

      // 2. Jeder sichtbare Text (#254)
      expect(texts.textCount, `${label} gemessene Texte`).toBeGreaterThan(30);
      expect(texts.failures, `${label} Text unter AAA`).toEqual([]);

      // 3. Fokusrahmen per Tastatur
      const focus = await measureFocus(page, 12);
      expect(focus.length, `${label} fokussierte Elemente`).toBeGreaterThan(5);
      for (const f of focus) {
        expect(f.width, `${label} Fokusbreite ${f.target}`).toBeGreaterThanOrEqual(2);
        expect(f.ratio, `${label} Fokuskontrast ${f.target}`).toBeGreaterThanOrEqual(3);
      }
      const minFocus = Math.min(...focus.map((f) => f.ratio));

      // 4. Überfahren des Hauptknopfs
      const primary = page.getByTestId("btn-open-url-dialog");
      await primary.hover();
      const hover = await elementContrast(page, "[data-testid='btn-open-url-dialog']");
      expect(hover, `${label} hover`).toBeGreaterThanOrEqual(7);

      // 5. Fehlerzustand: ungültige Adresse im Quellen-Dialog
      await primary.click();
      await page.getByTestId("url-address-input").fill("kein link");
      await page.getByTestId("btn-submit-url-dialog").click();
      await expect(page.getByTestId("url-address-error")).toBeVisible();
      const error = await elementContrast(page, "[data-testid='url-address-error']");
      expect(error, `${label} Fehlermeldung`).toBeGreaterThanOrEqual(7);
      const dialogTexts = await measureTexts(page);
      expect(dialogTexts.failures, `${label} Dialog mit Fehler`).toEqual([]);
      await page.getByTestId("btn-cancel-url-dialog").click();
      await expect(page.getByTestId("url-import-dialog")).toBeHidden();

      // 6. Deaktivierte Elemente: nur Bericht (SC 1.4.6 nimmt sie aus)
      const disabled = await measureDisabled(page);

      json[mode] = { texts, dialogTexts, focus, hover, error, disabled };
      rows.push(
        `| ${mode} | ${texts.canvas.background} | ${fmt(texts.canvas.ratio)} | ${texts.textCount} | ${texts.unmeasurable} | ${fmt(Math.min(texts.minText, dialogTexts.minText))} | ${fmt(minFocus)} | ${fmt(hover)} | ${fmt(error)} | ${disabled.length ? disabled.map((d) => fmt(d.ratio)).join(", ") : "keine"} |`
      );
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(resolve(REPORT_DIR, `${design}.json`), JSON.stringify(json, null, 2));
    writeFileSync(
      resolve(REPORT_DIR, `${design}.md`),
      [
        `## ${design}`,
        "",
        "Grenzwerte: Text 7:1, große Schrift 4,5:1, Fokus 3:1 bei mindestens 2 px.",
        "",
        "| Modus | Grundfläche | Seitentext | Texte gemessen | nicht messbar | kleinster Text | kleinster Fokus | hover | Fehler | deaktiviert (ausgenommen) |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...rows,
        ""
      ].join("\n")
    );
  });
}
