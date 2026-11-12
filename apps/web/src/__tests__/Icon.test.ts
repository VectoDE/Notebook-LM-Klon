import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../Icon.js";

describe("Icon (eine Symbolfamilie)", () => {
  it("rendert jedes Symbol als dekoratives SVG im 24er-Raster mit einheitlichem Strich", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(20);
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      expect(html, name).toContain('aria-hidden="true"');
      expect(html, name).toContain('focusable="false"');
      expect(html, name).toContain('viewBox="0 0 24 24"');
      expect(html, name).toContain('stroke-width="1.75"');
      expect(html, name).toContain('stroke="currentColor"');
      expect(html, name).toMatch(/<path d="[Mm][^"]+"/);
    }
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
