import type { VideoStoryboard } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VideoOverviewPlayer, drawSlideToCanvas } from "../VideoOverviewPlayer.js";

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
    expect(html).toContain('aria-label="Video Overview Player: Test Video Overview"');
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
});
