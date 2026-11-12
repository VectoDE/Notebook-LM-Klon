import type { Page } from "@playwright/test";

export const DESIGNS = ["pure", "immersive-cinema", "editorial-calm", "fusion"] as const;
export const MODES = ["light", "dark", "aaa-contrast"] as const;

/**
 * Setzt Design und Farbmodus über die Darstellung (wie ein Mensch): auf dem Telefon im
 * Menü-Sheet, sonst im Darstellungsmenü im Kopf. Danach ist das Menü wieder zu.
 */
export async function chooseDesign(page: Page, design: string, mode: string): Promise<void> {
  const menuButton = page.getByTestId("btn-open-menu");
  const narrow = await menuButton.isVisible();
  await (narrow ? menuButton : page.getByTestId("btn-open-appearance")).click();
  const container = page.getByTestId(narrow ? "nav-sheet" : "appearance-menu");
  await container.getByTestId(`theme-option-${design}`).check();
  await container.getByTestId(`mode-option-${mode}`).check();
  await page.waitForFunction(
    ([d, m]) =>
      document.documentElement.dataset.design === d &&
      document.documentElement.dataset.colorMode === m,
    [design, mode] as const
  );
  await page.keyboard.press("Escape");
  await container.waitFor({ state: "hidden" });
}

/** Öffnet einen Bereich: unter 600 px über die untere Leiste, sonst über die Reiter im Kopf. */
export async function openPanel(page: Page, panel: "sources" | "chat" | "studio"): Promise<void> {
  const bottom = page.getByTestId(`tab-btn-${panel}`);
  await ((await bottom.isVisible()) ? bottom : page.getByTestId(`top-tab-${panel}`)).click();
}

export interface LayoutProblem {
  readonly kind: "horizontal-scroll" | "outside-viewport" | "clipped";
  readonly detail: string;
}

/**
 * Sucht Layoutfehler: horizontaler Seiten-Scroll, sichtbare Bedien- und Textelemente,
 * die rechts/links aus dem Viewport ragen, und Elemente, deren Inhalt abgeschnitten wird
 * (overflow hidden/clip bzw. text-overflow mit breiterem Inhalt).
 */
export async function findLayoutProblems(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate(() => {
    const problems: {
      kind: "horizontal-scroll" | "outside-viewport" | "clipped";
      detail: string;
    }[] = [];
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    if (doc.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1) {
      problems.push({
        kind: "horizontal-scroll",
        detail: `scrollWidth ${Math.max(doc.scrollWidth, document.body.scrollWidth)} > ${vw}`
      });
    }
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
    const isVisible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // Nur für Screenreader sichtbare Elemente (1 x 1 px, clip) zählen nicht
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
    };
    // Ist das Element in einem eigenen Scrollbereich (z. B. Mindmap-Fläche), zählt dessen Rand.
    const scrollParentRight = (el: Element): number => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return p.getBoundingClientRect().right;
        p = p.parentElement;
      }
      return vw;
    };
    const selector = "button, a, label, select, input, h1, h2, h3, h4, [role='tab'], p, li";
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const limit = Math.min(vw, scrollParentRight(el));
      if (r.left < -1 || r.right > limit + 1) {
        problems.push({
          kind: "outside-viewport",
          detail: `${describe(el)} ${Math.round(r.left)}..${Math.round(r.right)} > ${Math.round(limit)}`
        });
      }
      if (el.tagName === "SELECT" || el.tagName === "INPUT") continue;
      const s = getComputedStyle(el);
      const clips =
        s.overflowX === "hidden" || s.overflowX === "clip" || s.textOverflow === "ellipsis";
      if (clips && el.scrollWidth > el.clientWidth + 1) {
        problems.push({
          kind: "clipped",
          detail: `${describe(el)} ${el.scrollWidth} > ${el.clientWidth}`
        });
      }
    }
    return problems;
  });
}

/** Alle sichtbaren Textknoten mit berechneter Schriftgröße unter minPx. */
export async function findSmallText(page: Page, minPx: number): Promise<string[]> {
  return page.evaluate((min) => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent ?? "").trim();
      const parent = node.parentElement;
      if (text && parent) {
        const r = parent.getBoundingClientRect();
        const s = getComputedStyle(parent);
        const visible = r.width > 0 && r.height > 0 && s.visibility !== "hidden";
        // SVG-Text wird mit der Mindmap gezoomt; maßgeblich ist die gesetzte Größe
        const size = Number.parseFloat(
          parent instanceof SVGElement
            ? (parent.getAttribute("font-size") ?? s.fontSize)
            : s.fontSize
        );
        if (visible && size < min) {
          found.push(`${parent.tagName.toLowerCase()} ${size}px "${text.slice(0, 40)}"`);
        }
      }
      node = walker.nextNode();
    }
    return found;
  }, minPx);
}
