import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLogo, LOGO_ASPECT_RATIO } from "../BrandLogo.js";
import { WorkspaceLayout } from "../WorkspaceLayout.js";

describe("BrandLogo (Logo C)", () => {
  it("rendert ein zugängliches SVG mit Titel RelationNotes", () => {
    const html = renderToStaticMarkup(createElement(BrandLogo));
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-labelledby="rn-logo-title-[^"]+"/);
    expect(html).toContain(">RelationNotes</title>");
    expect(html).toContain('height="32"');
    expect(html).toContain(`width="${Math.round(32 * LOGO_ASPECT_RATIO)}"`);
  });

  it("nimmt Höhe und Titel als Eigenschaften", () => {
    const html = renderToStaticMarkup(
      createElement(BrandLogo, { height: 48, title: "Startseite" })
    );
    expect(html).toContain('height="48"');
    expect(html).toContain(">Startseite</title>");
  });

  it("färbt über Design-Tokens statt fester Markenfarben", () => {
    const html = renderToStaticMarkup(createElement(BrandLogo));
    expect(html).toContain("var(--rn-color-logo-tile)");
    expect(html).toContain("var(--rn-color-logo-accent)");
    expect(html).toContain("var(--rn-color-text-primary)");
    expect(html).not.toMatch(/#2563EB|#0F172A/i);
  });

  it("vergibt eindeutige clipPath-IDs je Instanz", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, createElement(BrandLogo), createElement(BrandLogo))
    );
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("steht als Überschrift in der Kopfzeile des Arbeitsbereichs", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout));
    expect(html).toMatch(/<h1 id="app-title"[^>]*><svg[^>]*data-testid="brand-logo"/);
    expect(html).toContain('data-testid="btn-open-appearance"');
  });
});
