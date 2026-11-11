import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_FONT_SIZE } from "../MindmapViewer.js";

/**
 * Vorgabe: keine Schriftgröße unter 14 px (0,875 rem) im Quelltext der Web-App.
 * Geprüft werden Inline-Styles (fontSize: "…"), SVG-Attribute (fontSize="…")
 * und CSS (font-size: …) in allen .tsx- und .css-Dateien unter apps/web/src.
 */
const SRC = resolve(import.meta.dirname, "..");
const MIN_PX = 14;
const ROOT_PX = 16;

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".tsx") || f.endsWith(".css"))
  .map((f) => ({ name: f, text: readFileSync(resolve(SRC, f), "utf8") }));

/** Wandelt "0.875rem", "14px", "1.1em" oder "13" in Pixel um (rem/em auf 16 px). */
function toPx(value: string): number {
  const match = /^(\d*\.?\d+)(rem|em|px)?$/.exec(value);
  if (!match?.[1]) {
    throw new Error(`Unbekannte Schriftgröße: ${value}`);
  }
  const n = Number.parseFloat(match[1]);
  return match[2] === "rem" || match[2] === "em" ? n * ROOT_PX : n;
}

/** Findet alle festen Schriftgrößen in einem Quelltext. */
function findFontSizes(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /fontSize\s*[:=]\s*\{?([^,}\n]+)/g, // fontSize: "0.875rem" | fontSize="14" | fontSize: a ? "1rem" : "1.1rem"
    /font-size\s*:\s*([^;\n]+)/g // CSS
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const expr = m[1] ?? "";
      for (const v of expr.matchAll(/(?<![\w-])(\d*\.?\d+)(rem|em|px)?(?![\w%])/g)) {
        // Zahlen innerhalb von var(...)/max(...) mit Einheit sowie reine Zahlen in Attributen
        found.push(`${v[1]}${v[2] ?? ""}`);
      }
    }
  }
  return found;
}

describe("Schriftgrößen-Minimum 14 px (0,875 rem)", () => {
  it("rechnet Einheiten korrekt um und erkennt Fehler", () => {
    expect(toPx("0.875rem")).toBe(14);
    expect(toPx("14px")).toBe(14);
    expect(toPx("13")).toBe(13);
    expect(toPx("1em")).toBe(16);
    expect(() => toPx("abc")).toThrow("Unbekannte Schriftgröße");
  });

  it("findet Inline-, SVG- und CSS-Angaben", () => {
    expect(findFontSizes('style={{ fontSize: "0.75rem" }}')).toEqual(["0.75rem"]);
    expect(findFontSizes('<text fontSize="11">')).toEqual(["11"]);
    expect(findFontSizes('fontSize: active ? "1.35rem" : "0.8rem",')).toEqual([
      "1.35rem",
      "0.8rem"
    ]);
    expect(findFontSizes("p { font-size: 12px; }")).toEqual(["12px"]);
    expect(findFontSizes("fontSize={NODE_FONT_SIZE}")).toEqual([]);
  });

  it("prüft alle Quelldateien", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f.name, f.text] as const))(
    "%s hat keine Größe unter 14 px",
    (_name, text) => {
      const tooSmall = findFontSizes(text).filter((v) => toPx(v) < MIN_PX);
      expect(tooSmall).toEqual([]);
    }
  );

  it("Mindmap-Beschriftung nutzt mindestens 14 px", () => {
    expect(NODE_FONT_SIZE).toBeGreaterThanOrEqual(MIN_PX);
  });
});
