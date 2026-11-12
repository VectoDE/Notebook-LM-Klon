import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_MONO, THEMES, TYPOGRAPHY } from "../design-tokens.js";

const webDir = resolve(import.meta.dirname, "../..");
const fontDir = resolve(webDir, "src/fonts");
const licenseDir = resolve(webDir, "public/fonts/LICENSES");
const fontsCss = readFileSync(resolve(webDir, "src/fonts.css"), "utf8");
const themesCss = readFileSync(resolve(webDir, "src/themes.css"), "utf8");
const mainTsx = readFileSync(resolve(webDir, "src/main.tsx"), "utf8");
const sources = readFileSync(resolve(fontDir, "SOURCES.txt"), "utf8");

/** Familie, Datei, Lizenz und Gewichtsbereich je selbst gehosteter Schrift. */
const FONTS = [
  {
    family: "Inter",
    file: "inter-latin-wght-normal.woff2",
    license: "Inter-OFL.txt",
    weight: "100 900"
  },
  {
    family: "Source Serif 4",
    file: "source-serif-4-latin-wght-normal.woff2",
    license: "SourceSerif4-OFL.txt",
    weight: "200 900"
  },
  {
    family: "Space Grotesk",
    file: "space-grotesk-latin-wght-normal.woff2",
    license: "SpaceGrotesk-OFL.txt",
    weight: "300 700"
  },
  {
    family: "Geist",
    file: "geist-latin-wght-normal.woff2",
    license: "Geist-OFL.txt",
    weight: "100 900"
  },
  {
    family: "JetBrains Mono",
    file: "jetbrains-mono-latin-wght-normal.woff2",
    license: "JetBrainsMono-OFL.txt",
    weight: "100 800"
  }
] as const;

const sums = new Map(
  readFileSync(resolve(fontDir, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, name] = line.split(/\s+\*?/);
      return [name, hash] as const;
    })
);

/** Alle @font-face-Blöcke aus fonts.css. */
const faces = [...fontsCss.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1] as string);
const faceFor = (family: string) => faces.find((f) => f.includes(`font-family: "${family}";`));

describe("Selbst gehostete Schriften (Issue #355)", () => {
  it("liefert genau die fünf Dateien als WOFF2 mit passender SHA-256-Prüfsumme", () => {
    const files = readdirSync(fontDir).filter((f) => f.endsWith(".woff2"));
    expect(files.sort()).toEqual(FONTS.map((f) => f.file).sort());
    expect(sums.size).toBe(FONTS.length);
    for (const font of FONTS) {
      const bytes = readFileSync(resolve(fontDir, font.file));
      // WOFF2-Signatur "wOF2"
      expect(bytes.subarray(0, 4).toString("latin1"), font.file).toBe("wOF2");
      // Latin-Subset bleibt klein (je Datei unter 64 KB)
      expect(bytes.length, font.file).toBeLessThan(64 * 1024);
      const hash = createHash("sha256").update(bytes).digest("hex");
      expect(hash, font.file).toBe(sums.get(font.file));
    }
  });

  it("legt je Schrift den OFL-Lizenztext bei und dokumentiert die Herkunft", () => {
    for (const font of FONTS) {
      const path = resolve(licenseDir, font.license);
      expect(existsSync(path), font.license).toBe(true);
      expect(readFileSync(path, "utf8")).toContain("SIL Open Font License, Version 1.1");
      expect(sources).toContain(font.file);
      expect(sources).toContain("https://cdn.jsdelivr.net/npm/@fontsource-variable/");
    }
  });

  it("bindet jede Schrift per @font-face mit font-display swap und Latin-Subset ein", () => {
    expect(faces).toHaveLength(FONTS.length);
    for (const font of FONTS) {
      const face = faceFor(font.family);
      expect(face, font.family).toBeDefined();
      expect(face).toContain("font-display: swap;");
      expect(face).toContain(`font-weight: ${font.weight};`);
      expect(face).toContain(`url("./fonts/${font.file}") format("woff2")`);
      // Deutsch und Englisch: Latin-1 (Umlaute, ß), typografische Zeichen, Euro
      expect(face).toContain("U+0000-00FF");
      expect(face).toContain("U+2000-206F");
      expect(face).toContain("U+20AC");
    }
  });

  it("lädt die Schriften ohne externes CDN und ohne npm-Schriftpakete", () => {
    expect(mainTsx).toContain('import "./fonts.css";');
    expect(mainTsx).not.toContain("@fontsource");
    expect(fontsCss).not.toMatch(/url\(["']?https?:/);
  });

  it("verweist jede Schriftrolle aller Designs zuerst auf eine selbst gehostete Familie", () => {
    const families = new Set<string>(FONTS.map((f) => `"${f.family}"`));
    for (const theme of THEMES) {
      for (const stack of Object.values(TYPOGRAPHY[theme])) {
        expect(families.has(stack.split(",")[0] as string), `${theme}: ${stack}`).toBe(true);
      }
    }
    expect(FONT_MONO.split(",")[0]).toBe('"JetBrains Mono"');
    expect(themesCss).toContain(`--rn-font-mono: ${FONT_MONO};`);
  });
});
