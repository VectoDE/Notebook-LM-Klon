import { describe, expect, it, vi } from "vitest";
import {
  NarrationError,
  VIDEO_EXPORT_FPS,
  VIDEO_EXPORT_HEIGHT,
  VIDEO_EXPORT_TEXTS,
  VIDEO_EXPORT_WIDTH,
  classifyNarrationFailure,
  fetchNarration,
  narrationText,
  planVideoExport
} from "../video-export-plan.js";

const slide = (start: number, narration: string) =>
  ({ startTimeMs: start, spokenNarration: narration }) as never;

describe("Video-Export: Plan 1920 × 1080 bei 30 fps (#241)", () => {
  it("feste Ausgabe unabhängig vom Storyboard", () => {
    expect([VIDEO_EXPORT_WIDTH, VIDEO_EXPORT_HEIGHT, VIDEO_EXPORT_FPS]).toEqual([1920, 1080, 30]);
    const plan = planVideoExport({ durationMs: 30_000 });
    expect(plan).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 30_000,
      totalFrames: 900
    });
  });

  it("längerer Sprecherton verlängert das Video, kürzerer nicht", () => {
    expect(planVideoExport({ durationMs: 10_000 }, 12_345.2).durationMs).toBe(12_346);
    expect(planVideoExport({ durationMs: 10_000 }, 4_000).totalFrames).toBe(300);
    expect(planVideoExport({ durationMs: 0 }).totalFrames).toBe(1);
  });

  it("Sprechertext folgt der Zeitachse und lässt leere Folien weg", () => {
    const text = narrationText({
      slides: [slide(5000, "Zweitens."), slide(0, " Erstens. "), slide(9000, "  ")]
    });
    expect(text).toBe("Erstens.\n\nZweitens.");
  });
});

describe("Video-Export: Fehlerfälle beim Sprecherton (#241)", () => {
  it("ordnet Status und Code verständlichen Fällen zu", () => {
    expect(classifyNarrationFailure(409, "TTS_KEY_MISSING")).toBe("key-missing");
    expect(classifyNarrationFailure(409, null)).toBe("key-missing");
    expect(classifyNarrationFailure(500, "TTS_KEY_MISSING")).toBe("key-missing");
    expect(classifyNarrationFailure(429, "DEMO_RATE_LIMITED")).toBe("rate-limited");
    expect(classifyNarrationFailure(401, null)).toBe("signed-out");
    expect(classifyNarrationFailure(502, "TTS_FAILED")).toBe("unavailable");
    expect(classifyNarrationFailure(null, null)).toBe("unavailable");
  });

  it("fetchNarration liefert WAV-Bytes bei Erfolg", async () => {
    const wav = new Uint8Array([82, 73, 70, 70]);
    const fetchFn = vi.fn(
      async () => new Response(wav, { status: 200, headers: { "content-type": "audio/wav" } })
    );
    const data = await fetchNarration({ notebookId: "nb 1", text: "Hallo", lang: "en", fetchFn });
    expect(new Uint8Array(data)).toEqual(wav);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/notebooks/nb%201/video-tts");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hallo", lang: "en" });
  });

  it("ohne Schlüssel: NarrationError key-missing", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "TTS_KEY_MISSING" }), {
          status: 409,
          headers: { "content-type": "application/problem+json" }
        })
    );
    await expect(
      fetchNarration({ notebookId: "n", text: "a", lang: "de", fetchFn })
    ).rejects.toMatchObject({
      kind: "key-missing",
      status: 409
    });
  });

  it("Netzfehler, HTML statt Ton und Antwort ohne Code werden unavailable", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await fetchNarration({
      notebookId: "n",
      text: "a",
      lang: "de",
      fetchFn: down
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NarrationError);
    expect(err.kind).toBe("unavailable");
    expect(err.message).toBe("Sprecherton nicht verfügbar (unavailable).");

    // Dev-Server ohne Worker antwortet mit 200 und HTML
    const html = vi.fn(
      async () =>
        new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    await expect(
      fetchNarration({ notebookId: "n", text: "a", lang: "de", fetchFn: html })
    ).rejects.toMatchObject({
      kind: "unavailable",
      status: 200
    });
    const noCode = vi.fn(async () => new Response(JSON.stringify({}), { status: 502 }));
    await expect(
      fetchNarration({ notebookId: "n", text: "a", lang: "de", fetchFn: noCode })
    ).rejects.toMatchObject({
      kind: "unavailable"
    });
    const noType = vi.fn(async () => {
      const res = new Response(null, { status: 404 });
      res.headers.delete("content-type");
      return res;
    });
    const e404 = await fetchNarration({
      notebookId: "n",
      text: "a",
      lang: "de",
      fetchFn: noType
    }).catch((e) => e);
    expect(e404.message).toBe("Sprecherton nicht verfügbar (unavailable, HTTP 404).");
  });

  it("nutzt ohne fetchFn das globale fetch", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/wav" } })
      );
    try {
      const signal = new AbortController().signal;
      await fetchNarration({ notebookId: "n", text: "a", lang: "de", signal });
      expect((spy.mock.calls[0]?.[1] as RequestInit).signal).toBe(signal);
    } finally {
      spy.mockRestore();
    }
  });

  it("Texte: Deutsch und Englisch vollständig, jeder Fehlerfall erklärt", () => {
    const { de, en } = VIDEO_EXPORT_TEXTS;
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const lang of [de, en]) {
      expect(Object.keys(lang.failure).sort()).toEqual(
        ["key-missing", "rate-limited", "signed-out", "unavailable"].sort()
      );
      expect(lang.rendering(42)).toContain("42");
      expect(lang.done("a.webm")).toContain("a.webm");
      expect(lang.download("a.webm")).toContain("a.webm");
    }
    expect(de.failure["key-missing"]).toContain("Gemini-Schlüssel");
    expect(en.failure["key-missing"]).toContain("Gemini key");
  });
});
