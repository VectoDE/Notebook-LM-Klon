import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon, iconShape } from "../Icon.js";

describe("Icon (eine Symbolfamilie, gefüllt; Issue #328)", () => {
  it("rendert jedes Symbol als dekoratives SVG im 24er-Raster", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(20);
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).toContain('focusable="false"');
      expect(html, name).toContain('viewBox="0 0 24 24"');
      expect(html, name).toMatch(/<path d="[Mm][^"]+"/);
      // Der alte dünne Umriss (1,75) ist abgelöst
      expect(html, name).not.toContain('stroke-width="1.75"');
    }
  });

  it("zeichnet Flächen gefüllt (evenodd) und reine Linienzeichen mit kräftigem Strich", () => {
    for (const name of ICON_NAMES) {
      const shape = iconShape(name);
      expect(Boolean(shape.fill) || Boolean(shape.line), name).toBe(true);
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      if (shape.fill) {
        expect(html, name).toContain('fill="currentColor"');
        expect(html, name).toContain('fill-rule="evenodd"');
      }
      if (shape.line) {
        expect(html, name).toContain('stroke="currentColor"');
        expect(html, name).toContain('stroke-width="2"');
        expect(html, name).toContain('stroke-linecap="round"');
      }
    }
    // Gefüllt ist die Regel: nur Zeichen ohne Fläche bleiben reine Linie
    const lineOnly = ICON_NAMES.filter((name) => !iconShape(name).fill);
    expect(lineOnly.sort()).toEqual(["check", "chevron", "close", "menu", "plus"]);
    expect(ICON_NAMES.length - lineOnly.length).toBeGreaterThanOrEqual(25);
  });

  it("nimmt Größe und Klasse als Eigenschaften", () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { name: "send", size: 16, className: "rn-select-chevron" })
    );
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain('class="rn-select-chevron"');
    expect(renderToStaticMarkup(createElement(Icon, { name: "send" }))).toContain(
      'class="rn-icon"'
    );
  });
});
