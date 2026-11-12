import { describe, expect, it } from "vitest";
import {
  ORB_FALLBACK,
  ORB_MAX_LIGHTNESS,
  orbPalette,
  orbStyleFor,
  parseHexColor,
  podcastStateLabel,
  rgba,
  vividOrbColor
} from "../stage-visuals.js";

describe("podcastStateLabel (#294)", () => {
  it("zeigt jeden Zustand auf Deutsch", () => {
    expect(podcastStateLabel("idle")).toBe("Bereit");
    expect(podcastStateLabel("playing")).toBe("Läuft");
    expect(podcastStateLabel("paused")).toBe("Pausiert");
    expect(podcastStateLabel("interjecting")).toBe("Zwischenfrage");
    expect(podcastStateLabel("answering")).toBe("Hosts antworten");
    expect(podcastStateLabel("resuming")).toBe("Wird fortgesetzt");
  });

  it("zeigt unbekannte Werte nie roh", () => {
    expect(podcastStateLabel("buffering")).toBe("Bereit");
  });
});

describe("parseHexColor", () => {
  it("liest sechsstellige Tokens, auch mit Leerraum aus getComputedStyle", () => {
    expect(parseHexColor(" #fcd34d")).toEqual({ r: 252, g: 211, b: 77 });
  });

  it("liest dreistellige Tokens", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("liefert null für leere oder fremde Werte", () => {
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor("rgb(1, 2, 3)")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
  });
});

describe("orbPalette", () => {
  it("baut den Verlauf aus dem Bühnenakzent und das Glanzlicht aus dem Bühnentext", () => {
    const palette = orbPalette("#fcd34d", "#f4f6f2", "hostA");
    expect(palette.core).toBe("rgba(252, 211, 77, 0.9)");
    expect(palette.edge).toBe("rgba(252, 211, 77, 0)");
    expect(palette.glow).toBe("rgba(244, 246, 242, 0.35)");
    expect(palette.glowEdge).toBe("rgba(244, 246, 242, 0)");
  });

  it("zeichnet den zweiten Sprecher gedämpfter", () => {
    expect(orbPalette("#fcd34d", "#ffffff", "hostB").core).toBe("rgba(252, 211, 77, 0.75)");
    expect(orbPalette("#fcd34d", "#ffffff", null).core).toBe("rgba(252, 211, 77, 0.9)");
  });

  it("fällt bei fehlenden Tokens auf feste Werte zurück", () => {
    const palette = orbPalette("", "", null);
    expect(palette.core).toBe(rgba(vividOrbColor(ORB_FALLBACK), 0.9));
    expect(palette.fill).toBe(rgba(ORB_FALLBACK, 1));
    expect(palette.glow).toBe("rgba(255, 255, 255, 0.35)");
  });
});

describe("Orb im Feinschliff (Issue #315)", () => {
  const lightness = ({ r, g, b }: { r: number; g: number; b: number }) =>
    (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

  it("lässt kräftige Akzente unverändert", () => {
    const amber = { r: 252, g: 211, b: 77 };
    expect(vividOrbColor(amber)).toBe(amber);
  });

  it("macht blasse Akzente farbiger, Farbton bleibt", () => {
    const pale = { r: 199, g: 210, b: 254 }; // Pure #c7d2fe
    const vivid = vividOrbColor(pale);
    expect(lightness(vivid)).toBeLessThanOrEqual(ORB_MAX_LIGHTNESS + 0.01);
    expect(vivid.b).toBeGreaterThan(vivid.r);
    expect(vivid.b).toBeGreaterThan(vivid.g);
    // Rot- und Grün-dominante helle Töne, Grau bleibt grau
    const pink = vividOrbColor({ r: 254, g: 200, b: 220 });
    expect(pink.r).toBeGreaterThan(pink.g);
    const mint = vividOrbColor({ r: 200, g: 254, b: 220 });
    expect(mint.g).toBeGreaterThan(mint.r);
    const yellow = vividOrbColor({ r: 250, g: 250, b: 200 });
    expect(yellow.b).toBeLessThan(yellow.r);
    const grey = vividOrbColor({ r: 230, g: 230, b: 230 });
    expect(grey.r).toBe(grey.g);
    expect(grey.g).toBe(grey.b);
    // Zielhelligkeit unter 50 %
    const dark = vividOrbColor({ r: 199, g: 210, b: 254 }, 0.4);
    expect(lightness(dark)).toBeLessThanOrEqual(0.41);
  });

  it("zeichnet im Hochkontrast flach, sonst mit Leuchten", () => {
    expect(orbStyleFor("aaa-contrast")).toBe("flat");
    expect(orbStyleFor("dark")).toBe("glow");
    expect(orbStyleFor(undefined)).toBe("glow");
  });

  it("liefert Füllung und Rand für die flache Darstellung", () => {
    const palette = orbPalette("#fde047", "#ffffff", "hostA");
    expect(palette.fill).toBe("rgba(253, 224, 71, 1)");
    expect(palette.outline).toBe("rgba(255, 255, 255, 1)");
    expect(orbPalette("#fde047", "#ffffff", "hostB").fill).toBe("rgba(253, 224, 71, 0.8)");
  });
});
