import { describe, expect, it } from "vitest";
import {
  ORB_FALLBACK,
  orbPalette,
  parseHexColor,
  podcastStateLabel,
  rgba
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
    expect(palette.core).toBe(rgba(ORB_FALLBACK, 0.9));
    expect(palette.glow).toBe("rgba(255, 255, 255, 0.35)");
  });
});
