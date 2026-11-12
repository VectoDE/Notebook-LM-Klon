import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Page, expect, test } from "@playwright/test";

/**
 * Diagramme und Hero-Banner in Deutsch und Englisch (Issue #354): jeder Text passt mit der
 * echten Schrift (Inter und für Code JetBrains Mono, selbst gehostet) und mit Arial (unter Linux metrisch gleich: Liberation Sans)
 * als Rückfall ohne Inter, etwa in der GitHub-Ansicht, in seine Fläche, und
 * jeder Text erreicht AAA-Kontrast (mindestens 7:1) zu seinem Untergrund.
 */

const assets = resolve(import.meta.dirname, "../../../docs/assets");
const fontData = (file: string): string =>
  readFileSync(resolve(import.meta.dirname, "../src/fonts", file)).toString("base64");
const inter = fontData("inter-latin-wght-normal.woff2");
const mono = fontData("jetbrains-mono-latin-wght-normal.woff2");
/**
 * Alle Fassungen. Die automatischen (systemLanguage) zeigen in Chromium den Zweig der
 * Oberflächensprache; ihre beiden Zweige sind Text für Text identisch mit den -de- und
 * -en-Dateien, die hier je für sich gemessen werden.
 */
const files = readdirSync(assets).filter((f) => f.endsWith(".svg"));

interface Finding {
  text: string;
  overflow: number;
  ratio: number;
}

/** Misst alle sichtbaren Texte der eingebetteten Grafik. */
async function measure(page: Page, svg: string, font: string): Promise<Finding[]> {
  const fontFace =
    `@font-face{font-family:"Inter";src:url(data:font/woff2;base64,${inter}) format("woff2");font-weight:100 900}` +
    `@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,${mono}) format("woff2");font-weight:100 800}`;
  const override = font === "Inter" ? "" : `text{font-family:${font} !important}`;
  await page.setContent(
    `<!doctype html><html><head><style>${fontFace}${override}body{margin:0}</style></head><body>${svg}</body></html>`
  );
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: string): number => {
      const [r, g, b] = parse(c).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
    };
    const ratio = (a: number, b: number): number =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const root = document.querySelector("svg") as SVGSVGElement;
    const rects = [...root.querySelectorAll("rect")].map((el) => ({
      el,
      box: el.getBoundingClientRect()
    }));
    type Rgba = [number, number, number, number];
    const rgba = (c: string, alpha = 1): Rgba => {
      const [r = 0, g = 0, b = 0] = parse(c);
      return [r, g, b, alpha];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const a = top[3];
      return [0, 1, 2]
        .map((i) => (top[i] as number) * a + (below[i] as number) * (1 - a))
        .concat(1) as Rgba;
    };
    const lumOf = (c: Rgba): number => lum(`rgb(${c[0]},${c[1]},${c[2]})`);
    /** Farben einer Füllung (bei Verläufen alle Farbstopps samt Deckkraft), sonst null. */
    const colors = (el: Element): Rgba[] | null => {
      const style = getComputedStyle(el);
      const fill = style.fill;
      if (fill.startsWith("url(")) {
        const id = fill.match(/#([^")]+)/)?.[1] ?? "";
        const stops = [...root.querySelectorAll(`[id="${id}"] stop`)];
        return stops.map((s) => {
          const st = getComputedStyle(s);
          return rgba(st.stopColor, Number(st.stopOpacity));
        });
      }
      if (fill === "none" || Number(style.fillOpacity) === 0) {
        return null;
      }
      return [rgba(fill, Number(style.fillOpacity))];
    };
    /** Sichtbare Untergrundfarben: halbtransparente Flächen über der nächstgrößeren Fläche. */
    const backdrop = (stack: Element[]): Rgba[] => {
      const [first, ...rest] = stack;
      const own = colors(first as Element) as Rgba[];
      if (own.every((c) => c[3] >= 1) || rest.length === 0) {
        return own;
      }
      const below = backdrop(rest);
      return own.flatMap((c) => below.map((b) => (c[3] >= 1 ? c : over(c, b))));
    };
    const fills = (el: Element): boolean => colors(el) !== null;
    const out: { text: string; overflow: number; ratio: number }[] = [];
    for (const text of root.querySelectorAll("text")) {
      const box = text.getBoundingClientRect();
      if (box.width === 0) {
        continue; // nicht gewählter <switch>-Zweig
      }
      const cx = box.left + 2;
      const cy = box.top + box.height / 2;
      const containers = rects
        .filter(
          (r) =>
            r.box.left <= cx &&
            r.box.right >= cx &&
            r.box.top <= cy &&
            r.box.bottom >= cy &&
            fills(r.el)
        )
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
      const container = containers[0];
      if (!container) {
        continue;
      }
      // Überstand rechts bzw. links gegenüber der Fläche (4 px Innenabstand), negativ = passt
      const overflow = Math.max(
        box.right - (container.box.right - 4),
        container.box.left + 4 - box.left
      );
      const textLum = lum(getComputedStyle(text).fill);
      const bg = backdrop(containers.map((c) => c.el)).map(lumOf);
      out.push({
        text: text.textContent ?? "",
        overflow: Math.round(overflow * 10) / 10,
        ratio: Math.min(...bg.map((l) => ratio(textLum, l)))
      });
    }
    return out;
  });
}

test.describe("Diagramme und Hero in Deutsch und Englisch", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  for (const file of files) {
    test(`${file}: Texte passen und erreichen 7:1`, async ({ page }) => {
      const svg = readFileSync(resolve(assets, file), "utf8");
      const problems: string[] = [];
      for (const font of ["Inter", "Arial"]) {
        const findings = await measure(page, svg, font);
        expect(findings.length, `${file} ${font}`).toBeGreaterThan(0);
        for (const f of findings) {
          if (f.overflow > 0) {
            problems.push(`${font}: „${f.text}“ ragt ${f.overflow} px heraus`);
          }
          if (f.ratio < 7) {
            problems.push(`„${f.text}“ Kontrast ${f.ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(problems, file).toEqual([]);
    });
  }
});
