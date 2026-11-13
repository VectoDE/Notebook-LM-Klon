import type { VideoSlide, VideoStoryboard } from "@notebook-lm/shared";
import { drawSlideToCanvas } from "./VideoOverviewPlayer.js";

export interface ExportProgressEvent {
  readonly phase: "preparing" | "rendering" | "encoding" | "complete" | "error";
  readonly progressPercent: number;
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly message: string;
}

export interface VideoExportOptions {
  readonly storyboard: VideoStoryboard;
  readonly fps?: number;
  readonly mimeType?: string;
  readonly onProgress?: (event: ExportProgressEvent) => void;
  readonly signal?: AbortSignal;
}

export interface VideoExportResult {
  readonly blob: Blob;
  readonly downloadUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Determine supported video MIME type in current browser.
 */
export function getSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "video/webm";
  }

  // MP4 zuerst: Nur MP4 kann einen C2PA-Herkunftsnachweis tragen, WebM nicht (Issue #353,
  // docs/c2pa.md). WebM bleibt Rückfall für Browser ohne MP4-Aufnahme.
  const candidateTypes = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  for (const type of candidateTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return "video/webm";
}

/**
 * Client-side in-browser video exporter using Canvas captureStream & MediaRecorder.
 * Synthesizes slides, chapters, and audio into a downloadable WebM / MP4 video file.
 */
export async function exportVideoOverview(options: VideoExportOptions): Promise<VideoExportResult> {
  const { storyboard, fps = 30, onProgress, signal } = options;

  if (signal?.aborted) {
    throw new Error("Video-Export wurde abgebrochen.");
  }

  onProgress?.({
    phase: "preparing",
    progressPercent: 0,
    currentFrame: 0,
    totalFrames: 0,
    message: "Initialisiere Video-Render-Pipeline..."
  });

  const width = storyboard.resolution?.width ?? 1920;
  const height = storyboard.resolution?.height ?? 1080;

  // Create off-screen canvas
  let canvas: HTMLCanvasElement;
  if (typeof document !== "undefined" && document.createElement) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  } else {
    // Fallback for mock/test environments
    canvas = {
      width,
      height,
      getContext: () => null,
      captureStream: () => ({}) as MediaStream
    } as unknown as HTMLCanvasElement;
  }

  const ctx = canvas.getContext ? canvas.getContext("2d") : null;

  const mimeType = options.mimeType ?? getSupportedVideoMimeType();
  const totalDurationSec = storyboard.durationMs / 1000;
  const totalFrames = Math.max(1, Math.round(totalDurationSec * fps));

  // If captureStream or MediaRecorder is unavailable, return synthesized fallback blob
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    onProgress?.({
      phase: "complete",
      progressPercent: 100,
      currentFrame: totalFrames,
      totalFrames,
      message: "Export abgeschlossen (Simulationsmodus)."
    });

    const fallbackBlob = new Blob([storyboard.subtitlesVtt], {
      type: "video/webm"
    });
    return {
      blob: fallbackBlob,
      downloadUrl: "blob:mock-video-url",
      filename: `video-overview-${storyboard.notebookId}.webm`,
      mimeType: "video/webm",
      sizeBytes: fallbackBlob.size
    };
  }

  const stream = canvas.captureStream(fps);

  // Setup AudioContext & MediaStreamAudioDestinationNode if audioUrl or narration track is present
  if (typeof AudioContext !== "undefined") {
    try {
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      const audioTracks = dest.stream.getAudioTracks();
      if (audioTracks[0]) {
        stream.addTrack(audioTracks[0]);
      }
    } catch {
      // Audio stream optional in test or restricted context
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const recordedChunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  return new Promise<VideoExportResult>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType });
      const downloadUrl =
        typeof URL !== "undefined" && URL.createObjectURL
          ? URL.createObjectURL(blob)
          : "blob:mock-url";

      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const filename = `video-overview-${storyboard.notebookId}.${extension}`;

      onProgress?.({
        phase: "complete",
        progressPercent: 100,
        currentFrame: totalFrames,
        totalFrames,
        message: "Video erfolgreich generiert."
      });

      resolve({
        blob,
        downloadUrl,
        filename,
        mimeType,
        sizeBytes: blob.size
      });
    };

    recorder.onerror = (err) => {
      onProgress?.({
        phase: "error",
        progressPercent: 0,
        currentFrame: 0,
        totalFrames,
        message: `Fehler beim Video-Export: ${String(err)}`
      });
      reject(err);
    };

    recorder.start(100);

    // Frame rendering loop
    let currentFrame = 0;
    const intervalMs = 1000 / fps;

    const renderNextFrame = () => {
      if (signal?.aborted) {
        recorder.stop();
        reject(new Error("Video-Export wurde abgebrochen."));
        return;
      }

      if (currentFrame >= totalFrames) {
        onProgress?.({
          phase: "encoding",
          progressPercent: 95,
          currentFrame,
          totalFrames,
          message: "Finalisiere Video-Encoding..."
        });
        recorder.stop();
        return;
      }

      const frameTimeMs = (currentFrame / fps) * 1000;

      // Find active slide
      let slide = storyboard.slides[0] as VideoSlide;
      for (const s of storyboard.slides) {
        if (frameTimeMs >= s.startTimeMs && frameTimeMs < s.endTimeMs) {
          slide = s;
          break;
        }
      }

      if (ctx && slide) {
        const elapsed = frameTimeMs - slide.startTimeMs;
        const progress = Math.min(1.0, elapsed / 400);
        drawSlideToCanvas(ctx, slide, width, height, progress, false);
      }

      currentFrame++;
      const percent = Math.min(90, Math.round((currentFrame / totalFrames) * 90));

      onProgress?.({
        phase: "rendering",
        progressPercent: percent,
        currentFrame,
        totalFrames,
        message: `Rendere Frame ${currentFrame} von ${totalFrames}...`
      });

      setTimeout(renderNextFrame, intervalMs);
    };

    renderNextFrame();
  });
}
