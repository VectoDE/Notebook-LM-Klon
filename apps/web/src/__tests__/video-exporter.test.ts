import type { VideoStoryboard } from "@notebook-lm/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type ExportProgressEvent,
  exportVideoOverview,
  getSupportedVideoMimeType
} from "../video-exporter.js";

const mockStoryboard: VideoStoryboard = {
  id: "sb_export_test",
  notebookId: "nb_456",
  title: "Export Pipeline Test",
  durationMs: 1000,
  aspectRatio: "16:9",
  fps: 30,
  resolution: { width: 640, height: 360 },
  slides: [
    {
      id: "slide_1",
      chapterIndex: 0,
      title: "Export Test Slide",
      bulletPoints: ["Punkt 1"],
      spokenNarration: "Test.",
      audioDescription: "Folie fuer Export-Test.",
      startTimeMs: 0,
      endTimeMs: 1000,
      durationMs: 1000,
      citations: [],
      visualTheme: {
        backgroundGradient: ["#000000", "#111111"],
        accentColor: "#3b82f6",
        textColor: "#ffffff"
      }
    }
  ],
  chapters: [
    {
      id: "ch_1",
      index: 0,
      title: "Kapitel",
      startTimeMs: 0,
      endTimeMs: 1000,
      slideIds: ["slide_1"]
    }
  ],
  subtitlesVtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nExport Test.",
  subtitles: [
    {
      id: "cue_1",
      startTimeMs: 0,
      endTimeMs: 1000,
      text: "Export Test."
    }
  ],
  audioDescriptionTrack: [
    {
      slideId: "slide_1",
      startTimeMs: 0,
      endTimeMs: 1000,
      description: "Folie fuer Export-Test."
    }
  ]
};

describe("Video Exporter Pipeline (Sub-Issue #121)", () => {
  it("determines supported video MIME type with fallback to video/webm", () => {
    const mime = getSupportedVideoMimeType();
    expect(mime).toBe("video/webm");
  });

  it("handles video export in test/fallback environment gracefully", async () => {
    const progressEvents: ExportProgressEvent[] = [];
    const result = await exportVideoOverview({
      storyboard: mockStoryboard,
      fps: 10,
      onProgress: (ev) => progressEvents.push(ev)
    });

    expect(result.filename).toBe("video-overview-nb_456.webm");
    expect(result.mimeType).toBe("video/webm");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(progressEvents.some((ev) => ev.phase === "preparing")).toBe(true);
    expect(progressEvents.some((ev) => ev.phase === "complete")).toBe(true);
  });

  it("aborts video export when signal is aborted before start", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportVideoOverview({
        storyboard: mockStoryboard,
        signal: controller.signal
      })
    ).rejects.toThrow("Video-Export wurde abgebrochen.");
  });

  it("prefers MP4 over WebM because only MP4 can carry C2PA provenance (Issue #353)", () => {
    const globalObj = globalThis as unknown as Record<string, unknown>;
    const original = globalObj.MediaRecorder;
    try {
      globalObj.MediaRecorder = { isTypeSupported: () => true };
      expect(getSupportedVideoMimeType()).toBe("video/mp4;codecs=avc1,mp4a.40.2");
      globalObj.MediaRecorder = { isTypeSupported: (t: string) => t === "video/mp4" };
      expect(getSupportedVideoMimeType()).toBe("video/mp4");
      globalObj.MediaRecorder = { isTypeSupported: (t: string) => t.startsWith("video/webm;") };
      expect(getSupportedVideoMimeType()).toBe("video/webm;codecs=vp9,opus");
      globalObj.MediaRecorder = { isTypeSupported: () => false };
      expect(getSupportedVideoMimeType()).toBe("video/webm");
    } finally {
      globalObj.MediaRecorder = original;
    }
  });

  it("executes mock MediaRecorder pipeline when MediaRecorder is available", async () => {
    class MockMediaRecorder {
      static isTypeSupported(type: string) {
        return type.includes("webm");
      }
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      state = "inactive";

      constructor(
        public stream: MediaStream,
        public options?: MediaRecorderOptions
      ) {}

      start() {
        this.state = "recording";
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(["dummy video chunk"], { type: "video/webm" }) });
        }, 5);
      }

      stop() {
        this.state = "inactive";
        setTimeout(() => {
          this.onstop?.();
        }, 5);
      }
    }

    const globalObj = globalThis as unknown as Record<string, unknown>;
    const originalMediaRecorder = globalObj.MediaRecorder;
    const originalDocument = globalObj.document;

    const mockCanvas = {
      width: 640,
      height: 360,
      getContext: () => ({
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        createLinearGradient: () => ({ addColorStop: vi.fn() }),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn()
      }),
      captureStream: () => ({
        addTrack: vi.fn()
      })
    };

    globalObj.MediaRecorder = MockMediaRecorder;
    globalObj.document = {
      createElement: (tag: string) => {
        if (tag === "canvas") return mockCanvas;
        return {};
      }
    };

    try {
      const progress: ExportProgressEvent[] = [];
      const res = await exportVideoOverview({
        storyboard: { ...mockStoryboard, durationMs: 60 },
        fps: 30,
        onProgress: (ev) => progress.push(ev)
      });

      expect(res.filename).toBe("video-overview-nb_456.webm");
      expect(res.sizeBytes).toBeGreaterThan(0);
      expect(progress.some((p) => p.phase === "rendering")).toBe(true);
      expect(progress.some((p) => p.phase === "complete")).toBe(true);
    } finally {
      globalObj.MediaRecorder = originalMediaRecorder;
      globalObj.document = originalDocument;
    }
  });
});
