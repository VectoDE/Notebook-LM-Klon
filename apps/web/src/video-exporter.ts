import type { VideoSlide, VideoStoryboard } from "@notebook-lm/shared";
import { drawSlideToCanvas } from "./VideoOverviewPlayer.js";
import { type VideoExportPlan, planVideoExport } from "./video-export-plan.js";

export interface ExportProgressEvent {
  readonly phase: "preparing" | "rendering" | "encoding" | "complete" | "error";
  readonly progressPercent: number;
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly message: string;
}

export interface VideoExportOptions {
  readonly storyboard: VideoStoryboard;
  /** Sprecherton als Audiodatei (WAV aus Gemini-TTS); ohne Angabe entsteht ein stummes Video. */
  readonly narration?: ArrayBuffer | undefined;
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
  readonly plan: VideoExportPlan;
  readonly hasAudio: boolean;
}

/** Der Browser kann nicht aufnehmen (kein MediaRecorder oder keine Canvas-Aufnahme). */
export class VideoExportUnsupportedError extends Error {
  constructor() {
    super("Video-Export wird von diesem Browser nicht unterstützt.");
    this.name = "VideoExportUnsupportedError";
  }
}

export const VIDEO_EXPORT_ABORTED = "Video-Export wurde abgebrochen.";

/** WebM mit Opus-Ton bevorzugen, sonst was der Browser kann. */
export function getSupportedVideoMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidateTypes = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4"
  ];
  return candidateTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

/** Aktive Folie zu einem Zeitpunkt; nach dem Ende bleibt die letzte stehen. */
export function slideAt(slides: readonly VideoSlide[], timeMs: number): VideoSlide | undefined {
  return (
    slides.find((s) => timeMs >= s.startTimeMs && timeMs < s.endTimeMs) ?? slides[slides.length - 1]
  );
}

interface NarrationTrack {
  readonly track: MediaStreamTrack;
  readonly durationMs: number;
  readonly start: () => void;
  readonly close: () => void;
}

async function prepareNarration(narration: ArrayBuffer): Promise<NarrationTrack> {
  const audioCtx = new AudioContext();
  const buffer = await audioCtx.decodeAudioData(narration.slice(0));
  const destination = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    await audioCtx.close();
    throw new Error("Audiospur konnte nicht erzeugt werden.");
  }
  return {
    track,
    durationMs: buffer.duration * 1000,
    start: () => {
      void audioCtx.resume();
      source.start();
    },
    close: () => {
      void audioCtx.close();
    }
  };
}

/**
 * Video im Browser aufnehmen: Canvas 1920 × 1080, captureStream(30), MediaRecorder.
 * Mit Sprecherton wird die WAV-Datei über die Web Audio API dekodiert und als Audiospur in
 * denselben Stream gelegt, sodass MediaRecorder Bild und Ton in eine WebM-Datei schreibt.
 * Die Aufnahme läuft in Echtzeit; die Bildfolge richtet sich nach der vergangenen Zeit.
 */
export async function exportVideoOverview(options: VideoExportOptions): Promise<VideoExportResult> {
  const { storyboard, onProgress, signal } = options;
  if (signal?.aborted) throw new Error(VIDEO_EXPORT_ABORTED);

  onProgress?.({
    phase: "preparing",
    progressPercent: 0,
    currentFrame: 0,
    totalFrames: 0,
    message: "Initialisiere Video-Render-Pipeline..."
  });

  if (typeof MediaRecorder === "undefined" || typeof document === "undefined") {
    throw new VideoExportUnsupportedError();
  }
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") throw new VideoExportUnsupportedError();

  const narration = options.narration ? await prepareNarration(options.narration) : null;
  const plan = planVideoExport(storyboard, narration?.durationMs ?? null);
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(plan.fps);
  if (narration) stream.addTrack(narration.track);

  const mimeType = options.mimeType ?? getSupportedVideoMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const recordedChunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  return new Promise<VideoExportResult>((resolve, reject) => {
    let aborted = false;
    let stopped = false;
    const finish = () => {
      stopped = true;
      narration?.close();
      for (const track of stream.getTracks?.() ?? []) track.stop();
    };

    recorder.onstop = () => {
      finish();
      if (aborted) return;
      const blob = new Blob(recordedChunks, { type: mimeType });
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      onProgress?.({
        phase: "complete",
        progressPercent: 100,
        currentFrame: plan.totalFrames,
        totalFrames: plan.totalFrames,
        message: "Video erfolgreich generiert."
      });
      resolve({
        blob,
        downloadUrl: URL.createObjectURL(blob),
        filename: `video-overview-${storyboard.notebookId}.${extension}`,
        mimeType,
        sizeBytes: blob.size,
        plan,
        hasAudio: narration !== null
      });
    };

    recorder.onerror = (err) => {
      finish();
      onProgress?.({
        phase: "error",
        progressPercent: 0,
        currentFrame: 0,
        totalFrames: plan.totalFrames,
        message: `Fehler beim Video-Export: ${String(err)}`
      });
      reject(err);
    };

    const intervalMs = 1000 / plan.fps;
    let startedAt = 0;
    let drawnFrame = -1;

    const renderNextFrame = () => {
      if (stopped) return;
      if (signal?.aborted) {
        aborted = true;
        recorder.stop();
        reject(new Error(VIDEO_EXPORT_ABORTED));
        return;
      }
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs >= plan.durationMs) {
        onProgress?.({
          phase: "encoding",
          progressPercent: 95,
          currentFrame: plan.totalFrames,
          totalFrames: plan.totalFrames,
          message: "Finalisiere Video-Encoding..."
        });
        recorder.stop();
        return;
      }
      const frame = Math.min(plan.totalFrames - 1, Math.floor((elapsedMs / 1000) * plan.fps));
      if (frame !== drawnFrame) {
        drawnFrame = frame;
        const frameTimeMs = (frame / plan.fps) * 1000;
        const slide = slideAt(storyboard.slides, frameTimeMs);
        if (ctx && slide) {
          const progress = Math.min(1, (frameTimeMs - slide.startTimeMs) / 400);
          drawSlideToCanvas(ctx, slide, plan.width, plan.height, progress, false);
        }
        onProgress?.({
          phase: "rendering",
          progressPercent: Math.min(90, Math.round(((frame + 1) / plan.totalFrames) * 90)),
          currentFrame: frame + 1,
          totalFrames: plan.totalFrames,
          message: `Rendere Frame ${frame + 1} von ${plan.totalFrames}...`
        });
      }
      setTimeout(renderNextFrame, intervalMs);
    };

    recorder.start(250);
    narration?.start();
    startedAt = performance.now();
    renderNextFrame();
  });
}
