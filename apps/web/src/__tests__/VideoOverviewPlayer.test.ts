import type { VideoStoryboard } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  VideoOverviewPlayer,
  backdropScrimAlpha,
  cueAt,
  drawSlideToCanvas,
  formatTime,
  isShortcutExemptTarget
} from "../VideoOverviewPlayer.js";

const mockStoryboard: VideoStoryboard = {
  id: "sb_test_1",
  notebookId: "nb_123",
  title: "Test Video Overview",
  durationMs: 16000,
  aspectRatio: "16:9",
  fps: 60,
  resolution: { width: 1920, height: 1080 },
  slides: [
    {
      id: "slide_1",
      chapterIndex: 0,
      title: "Einleitung",
      subtitle: "Kapitel 1",
      bulletPoints: ["Punkt A", "Punkt B"],
      spokenNarration: "Willkommen zur Praesentation.",
      audioDescription: "Titel-Folie mit zwei Kernpunkten auf dunklem Hintergrund.",
      startTimeMs: 0,
      endTimeMs: 8000,
      durationMs: 8000,
      citations: [
        {
          sourceId: "src_1",
          sourceTitle: "Quellenstudie",
          quote: "Wichtige Erkenntnis."
        }
      ],
      visualTheme: {
        backgroundGradient: ["#0f172a", "#1e293b"],
        accentColor: "#38bdf8",
        textColor: "#ffffff"
      }
    },
    {
      id: "slide_2",
      chapterIndex: 1,
      title: "Kennzahlen & Daten",
      subtitle: "Kapitel 2",
      bulletPoints: ["Wachstum 30%"],
      chart: {
        type: "bar",
        title: "Wachstum 2026",
        data: [{ label: "Q1", value: 30, color: "#38bdf8" }],
        unit: "%"
      },
      spokenNarration: "Hier sind die Kennzahlen.",
      audioDescription: "Folie mit Balkendiagramm zum Wachstum.",
      startTimeMs: 8000,
      endTimeMs: 16000,
      durationMs: 8000,
      citations: [],
      visualTheme: {
        backgroundGradient: ["#0b0f19", "#1e1b4b"],
        accentColor: "#6366f1",
        textColor: "#ffffff"
      }
    }
  ],
  chapters: [
    {
      id: "ch_1",
      index: 0,
      title: "Einleitung",
      startTimeMs: 0,
      endTimeMs: 8000,
      slideIds: ["slide_1"]
    },
    {
      id: "ch_2",
      index: 1,
      title: "Kennzahlen",
      startTimeMs: 8000,
      endTimeMs: 16000,
      slideIds: ["slide_2"]
    }
  ],
  subtitlesVtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:08.000\nWillkommen zur Praesentation.",
  subtitles: [
    {
      id: "cue_1",
      startTimeMs: 0,
      endTimeMs: 8000,
      text: "Willkommen zur Praesentation."
    },
    {
      id: "cue_2",
      startTimeMs: 8000,
      endTimeMs: 16000,
      text: "Hier sind die Kennzahlen."
    }
  ],
  audioDescriptionTrack: [
    {
      slideId: "slide_1",
      startTimeMs: 0,
      endTimeMs: 8000,
      description: "Titel-Folie mit zwei Kernpunkten."
    },
    {
      slideId: "slide_2",
      startTimeMs: 8000,
      endTimeMs: 16000,
      description: "Folie mit Balkendiagramm."
    }
  ],
  audioUrl: "https://example.com/audio.mp3"
};

describe("VideoOverviewPlayer (Sub-Issue #120)", () => {
  it("renders player with canvas, accessible controls, chapters and audio element", () => {
    const html = renderToStaticMarkup(
      createElement(VideoOverviewPlayer, {
        storyboard: mockStoryboard
      })
    );

    expect(html).toContain('data-testid="video-overview-player"');
    expect(html).toContain('data-testid="slide-canvas"');
    expect(html).toContain('data-testid="play-pause-button"');
    expect(html).toContain('data-testid="toggle-subtitles-button"');
    expect(html).toContain('data-testid="toggle-ad-button"');
    expect(html).toContain('data-testid="timeline-scrubber"');
    expect(html).toContain('data-testid="chapter-btn-ch_1"');
    expect(html).toContain('data-testid="chapter-btn-ch_2"');
    expect(html).toContain('data-testid="player-audio-element"');
    expect(html).toContain('data-testid="a11y-live-region"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Video-Übersicht: Test Video Overview"');
  });

  it("draws slide, bullet points, citations and charts to 2D canvas context", () => {
    const fillTextCalls: string[] = [];
    const fillRectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];

    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: () => ({
        addColorStop: vi.fn()
      }),
      fillStyle: "",
      strokeStyle: "",
      globalAlpha: 1.0,
      font: "",
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h });
      }),
      strokeRect: vi.fn(),
      fillText: vi.fn((text: string) => {
        fillTextCalls.push(text);
      }),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    const slide0 = mockStoryboard.slides[0];
    if (slide0) {
      drawSlideToCanvas(mockCtx, slide0, 1920, 1080, 1.0, false);
      expect(fillTextCalls).toContain("KAPITEL 1");
      expect(fillTextCalls).toContain("Einleitung");
      expect(fillTextCalls).toContain("Punkt A");
      expect(fillTextCalls).toContain("Punkt B");
      expect(fillTextCalls.some((t) => t.includes('Quelle: "Quellenstudie"'))).toBe(true);
    }

    fillTextCalls.length = 0;
    const slide1 = mockStoryboard.slides[1];
    if (slide1) {
      drawSlideToCanvas(mockCtx, slide1, 1920, 1080, 0.5, true);
      expect(fillTextCalls).toContain("Kennzahlen & Daten");
      expect(fillTextCalls).toContain("Wachstum 2026");
      expect(fillTextCalls).toContain("30%");
      expect(fillTextCalls).toContain("Q1");
    }
  });

  it("zeichnet im Bildschirm-Modus nur den Hintergrund, ohne Text", () => {
    const fillText = vi.fn();
    const fillRect = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillStyle: "",
      fillRect,
      fillText
    } as unknown as CanvasRenderingContext2D;
    const slide = mockStoryboard.slides[0];
    if (!slide) throw new Error("Folie fehlt");
    drawSlideToCanvas(ctx, slide, 1280, 720, 1, true, "backdrop");
    expect(fillText).not.toHaveBeenCalled();
    // dunkler Verlauf: keine Abdeckung, nur die Verlaufsfläche
    expect(fillRect).toHaveBeenCalledTimes(1);

    fillRect.mockClear();
    const light = {
      ...slide,
      visualTheme: { ...slide.visualTheme, backgroundGradient: ["#ffffff", "#e2e8f0"] as const }
    };
    drawSlideToCanvas(ctx, light as typeof slide, 1280, 720, 1, true, "backdrop");
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(String(ctx.fillStyle)).toMatch(/^rgba\(0, 0, 0, 0\.\d+\)$/);
  });

  it("dunkelt helle Folienverläufe so weit ab, dass heller Text 7:1 hält", () => {
    expect(backdropScrimAlpha(["#0f172a", "#1e293b"])).toBe(0);
    expect(backdropScrimAlpha(["#022c22", "#064e3b"])).toBe(0);
    const white = backdropScrimAlpha(["#fff", "#0f172a"]);
    expect(white).toBeGreaterThan(0.5);
    expect(white).toBeLessThanOrEqual(0.9);
    // Weiß abgedunkelt: Luminanz ≤ 0,08 → Bühnentext (#F5F3FF) erreicht mindestens 7:1
    expect((1 - white) ** 2.2).toBeLessThanOrEqual(0.08 + 1e-9);
    expect(backdropScrimAlpha(["rgb(10, 10, 10)"])).toBe(0.6);
  });

  it("formatiert Zeiten als m:ss bzw. h:mm:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65_000)).toBe("1:05");
    expect(formatTime(200_999)).toBe("3:20");
    expect(formatTime(3_725_000)).toBe("1:02:05");
    expect(formatTime(-5)).toBe("0:00");
  });

  it("lässt Tasten auf Knöpfen, Reglern und Eingaben in Ruhe", () => {
    const fakeTarget = (match: boolean) => ({
      closest: (selector: string) => {
        expect(selector).toContain("button");
        expect(selector).toContain("[role='slider']");
        expect(selector).toContain("textarea");
        return match ? {} : null;
      }
    });
    expect(isShortcutExemptTarget(fakeTarget(true) as unknown as EventTarget)).toBe(true);
    expect(isShortcutExemptTarget(fakeTarget(false) as unknown as EventTarget)).toBe(false);
    expect(isShortcutExemptTarget(null)).toBe(false);
    expect(isShortcutExemptTarget({} as EventTarget)).toBe(false);
  });

  it("beschreibt Leinwand, Zeitregler und Umschalter zugänglich", () => {
    const html = renderToStaticMarkup(
      createElement(VideoOverviewPlayer, { storyboard: mockStoryboard })
    );
    // Leinwand als Bild mit Folientitel und Verweis auf den Folientext
    expect(html).toMatch(/<canvas[^>]*role="img"/);
    expect(html).toContain('aria-label="Folie 1 von 2: Einleitung"');
    const describedBy = /<canvas[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    // Folientext als HTML
    expect(html).toContain('<h3 class="rn-video-title">Einleitung</h3>');
    expect(html).toContain("<li>Punkt A</li>");
    expect(html).toContain("Quelle: „Quellenstudie“ – „Wichtige Erkenntnis.“");
    // Zeitregler: Sekunden, Schrittweite 1 s, Zeit als Text
    expect(html).toMatch(/<input[^>]*type="range"[^>]*max="16"[^>]*step="1"/);
    expect(html).toContain('aria-valuetext="0:00 von 0:16"');
    expect(html).toContain('<span data-testid="video-time">0:00 / 0:16</span>');
    // Sichtbare Beschriftung = zugänglicher Name, keine Ersatzschreibung
    expect(html).not.toMatch(/fuer|Fuer|ueber|aendern/);
    expect(html).not.toContain('aria-label="Video abspielen"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Untertitel<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*?Audiodeskription<\/button>/);
    expect(html).toContain("rn-video-toggle-check");
    // Kapitel: Name beginnt mit dem sichtbaren Titel
    expect(html).toMatch(/data-testid="chapter-btn-ch_1"[^>]*>Einleitung<span class="sr-only">/);
  });

  it("zeigt Diagrammdaten als lesbare Balkenliste", () => {
    const html = renderToStaticMarkup(
      createElement(VideoOverviewPlayer, {
        storyboard: { ...mockStoryboard, slides: [mockStoryboard.slides[1] as never] }
      })
    );
    expect(html).toContain('<figcaption class="rn-video-chart-title">Wachstum 2026</figcaption>');
    expect(html).toContain('<rect width="100" height="10" rx="2" fill="currentColor">');
    expect(html).toContain('<span class="rn-video-bar-value">30%</span>');
  });
});

describe("Medienalternativen im Video-Player (#350)", () => {
  it("findet den Cue zur Zeit, an der Grenze den späteren", () => {
    const cues = [
      { id: "1", startMs: 0, endMs: 1000, text: "a" },
      { id: "2", startMs: 1000, endMs: 2000, text: "b" }
    ];
    expect(cueAt(cues, 1000)?.text).toBe("b");
    expect(cueAt(cues, 2500)).toBeUndefined();
  });

  it("bietet das Transkript an und sagt offen, dass kein Gebärdensprachvideo da ist", () => {
    const html = renderToStaticMarkup(
      createElement(VideoOverviewPlayer, { storyboard: mockStoryboard })
    );
    expect(html).toMatch(
      /data-testid="toggle-transcript-button" aria-expanded="false" aria-controls="[^"]+-transcript">Transkript zeigen<\/button>/
    );
    expect(html).toContain('data-testid="sign-language-unavailable"');
    expect(html).toContain("noch kein Video in Deutscher Gebärdensprache hinterlegt");
    expect(html).not.toContain("toggle-sign-language-button");
    // Ohne Browser-API keine Spur-URL und kein Vorlese-Knopf (beides erst im Browser)
    expect(html).toContain(
      '<track kind="captions" srcLang="de" label="Untertitel" default=""/><track kind="descriptions" srcLang="de" label="Audiodeskription"/>'
    );
    expect(html).not.toContain("toggle-ad-speech-button");
  });

  it("bietet Gebärdensprache an, sobald ein Video hinterlegt ist", () => {
    const html = renderToStaticMarkup(
      createElement(VideoOverviewPlayer, {
        storyboard: {
          ...mockStoryboard,
          signLanguageVideo: { url: "/dgs.webm", language: "gsg" }
        }
      })
    );
    expect(html).toMatch(
      /data-testid="toggle-sign-language-button" aria-pressed="false">.*?Gebärdensprache<\/button>/
    );
    expect(html).not.toContain("sign-language-unavailable");
    // Das Video selbst erscheint erst nach dem Einschalten
    expect(html).not.toContain("sign-language-video");
  });
});
