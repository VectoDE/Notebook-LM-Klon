import type { VideoStoryboard } from "@notebook-lm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ExportProgressEvent,
  VIDEO_EXPORT_ABORTED,
  VideoExportUnsupportedError,
  exportVideoOverview,
  getSupportedVideoMimeType,
  slideAt
} from "../video-exporter.js";

const mockStoryboard: VideoStoryboard = {
  id: "sb_export_test",
  notebookId: "nb_456",
  title: "Export Pipeline Test",
  durationMs: 1000,
  aspectRatio: "16:9",
  fps: 60,
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
  subtitles: [{ id: "cue_1", startTimeMs: 0, endTimeMs: 1000, text: "Export Test." }],
  audioDescriptionTrack: [
    { slideId: "slide_1", startTimeMs: 0, endTimeMs: 1000, description: "Folie fuer Export-Test." }
  ]
};

/** MediaRecorder-Mock: merkt sich Stream und Optionen, liefert beim Stopp ein Datenstück. */
class MockMediaRecorder {
  static last: MockMediaRecorder | null = null;
  static isTypeSupported(type: string) {
    return type === "video/webm;codecs=vp9,opus";
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  timeslice = 0;
  constructor(
    public stream: { tracks: unknown[] },
    public options?: MediaRecorderOptions
  ) {
    MockMediaRecorder.last = this;
  }
  start(timeslice: number) {
    this.timeslice = timeslice;
  }
  stop() {
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([]) });
      this.ondataavailable?.({ data: new Blob(["webm-bytes"], { type: "video/webm" }) });
      this.onstop?.();
    }, 1);
  }
}

function installBrowserMocks(audioDurationSec = 0.2) {
  const audioTrack = { kind: "audio", stop: vi.fn() };
  const videoTrack = { kind: "video", stop: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    fps: 0,
    getContext: () => ({
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      measureText: () => ({ width: 10 }),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      closePath: vi.fn(),
      quadraticCurveTo: vi.fn()
    }),
    captureStream(fps: number) {
      this.fps = fps;
      const tracks: unknown[] = [videoTrack];
      return {
        tracks,
        addTrack: (t: unknown) => tracks.push(t),
        getTracks: () => tracks
      };
    }
  };
  const source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
  const close = vi.fn(async () => {});
  class MockAudioContext {
    decodeAudioData = vi.fn(async () => ({ duration: audioDurationSec }));
    createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [audioTrack] } });
    createBufferSource = () => source;
    resume = vi.fn(async () => {});
    close = close;
  }
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test" });
  return { canvas, source, audioTrack, videoTrack, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockMediaRecorder.last = null;
});

describe("Video-Export (#241)", () => {
  it("bevorzugt WebM mit Opus, ohne MediaRecorder video/webm", () => {
    expect(getSupportedVideoMimeType()).toBe("video/webm");
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    expect(getSupportedVideoMimeType()).toBe("video/webm;codecs=vp9,opus");
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(getSupportedVideoMimeType()).toBe("video/webm");
  });

  it("ohne MediaRecorder oder Canvas-Aufnahme: klarer Fehler statt Scheindatei", async () => {
    await expect(exportVideoOverview({ storyboard: mockStoryboard })).rejects.toBeInstanceOf(
      VideoExportUnsupportedError
    );
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    vi.stubGlobal("document", { createElement: () => ({}) });
    await expect(exportVideoOverview({ storyboard: mockStoryboard })).rejects.toThrow(
      "nicht unterstützt"
    );
  });

  it("bricht vor dem Start ab, wenn das Signal schon gesetzt ist", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      exportVideoOverview({ storyboard: mockStoryboard, signal: controller.signal })
    ).rejects.toThrow(VIDEO_EXPORT_ABORTED);
  });

  it("nimmt 1920 × 1080 bei 30 fps auf und legt den TTS-Ton als Audiospur in den Stream", async () => {
    const mocks = installBrowserMocks(0.2);
    const progress: ExportProgressEvent[] = [];
    const result = await exportVideoOverview({
      storyboard: { ...mockStoryboard, durationMs: 100 },
      narration: new ArrayBuffer(8),
      onProgress: (ev) => progress.push(ev)
    });
    expect([mocks.canvas.width, mocks.canvas.height, mocks.canvas.fps]).toEqual([1920, 1080, 30]);
    // Ton ist länger als das Storyboard: Video dauert so lange wie der Ton
    expect(result.plan).toMatchObject({ durationMs: 200, totalFrames: 6, fps: 30 });
    expect(MockMediaRecorder.last?.stream.tracks).toContain(mocks.audioTrack);
    expect(MockMediaRecorder.last?.options?.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(mocks.source.start).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.audioTrack.stop).toHaveBeenCalled();
    expect(result.hasAudio).toBe(true);
    expect(result.filename).toBe("video-overview-nb_456.webm");
    expect(result.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(result.sizeBytes).toBe("webm-bytes".length);
    expect(result.downloadUrl).toBe("blob:test");
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(["preparing", "rendering", "encoding", "complete"])
    );
    const frames = progress.filter((p) => p.phase === "rendering").map((p) => p.currentFrame);
    expect(Math.max(...frames)).toBeLessThanOrEqual(6);
  });

  it("ohne Ton: stummes Video, MP4-Endung bei MP4-Typ", async () => {
    const mocks = installBrowserMocks();
    const result = await exportVideoOverview({
      storyboard: { ...mockStoryboard, durationMs: 50 },
      mimeType: "video/mp4"
    });
    expect(result.hasAudio).toBe(false);
    expect(result.filename.endsWith(".mp4")).toBe(true);
    expect(MockMediaRecorder.last?.stream.tracks).not.toContain(mocks.audioTrack);
    expect(mocks.source.start).not.toHaveBeenCalled();
  });

  it("Abbruch während der Aufnahme beendet ohne Ergebnis", async () => {
    installBrowserMocks();
    const controller = new AbortController();
    const promise = exportVideoOverview({
      storyboard: { ...mockStoryboard, durationMs: 5000 },
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toThrow(VIDEO_EXPORT_ABORTED);
  });

  it("Aufnahmefehler wird weitergegeben", async () => {
    installBrowserMocks();
    const promise = exportVideoOverview({ storyboard: { ...mockStoryboard, durationMs: 5000 } });
    await new Promise((r) => setTimeout(r, 10));
    MockMediaRecorder.last?.onerror?.(new Error("kaputt"));
    await expect(promise).rejects.toThrow("kaputt");
  });

  it("slideAt: aktive Folie, danach die letzte", () => {
    const slides = mockStoryboard.slides;
    expect(slideAt(slides, 500)?.id).toBe("slide_1");
    expect(slideAt(slides, 5000)?.id).toBe("slide_1");
    expect(slideAt([], 0)).toBeUndefined();
  });
});
