/**
 * Video-Export (Issue #241): feste Ausgabe 1920 × 1080 bei 30 fps, Sprecherton aus Gemini-TTS.
 * Reine Logik ohne Browser-APIs, damit sie in Node vollständig getestet werden kann.
 */
import type { VideoStoryboard } from "@notebook-lm/shared";
import type { Language } from "./theme-preferences.js";

export const VIDEO_EXPORT_WIDTH = 1920;
export const VIDEO_EXPORT_HEIGHT = 1080;
export const VIDEO_EXPORT_FPS = 30;

export interface VideoExportPlan {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Länge des Videos: Storyboard, bei längerem Sprecherton dessen Länge. */
  readonly durationMs: number;
  readonly totalFrames: number;
}

export function planVideoExport(
  storyboard: Pick<VideoStoryboard, "durationMs">,
  audioDurationMs: number | null = null
): VideoExportPlan {
  const durationMs = Math.max(storyboard.durationMs, Math.ceil(audioDurationMs ?? 0), 1);
  return {
    width: VIDEO_EXPORT_WIDTH,
    height: VIDEO_EXPORT_HEIGHT,
    fps: VIDEO_EXPORT_FPS,
    durationMs,
    totalFrames: Math.max(1, Math.round((durationMs / 1000) * VIDEO_EXPORT_FPS))
  };
}

/** Sprechertext aller Folien in Reihenfolge, Grundlage für den TTS-Ton. */
export function narrationText(storyboard: Pick<VideoStoryboard, "slides">): string {
  return [...storyboard.slides]
    .sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map((slide) => slide.spokenNarration.trim())
    .filter(Boolean)
    .join("\n\n");
}

export type NarrationFailure = "key-missing" | "rate-limited" | "signed-out" | "unavailable";

export class NarrationError extends Error {
  constructor(
    readonly kind: NarrationFailure,
    readonly status: number | null
  ) {
    super(`Sprecherton nicht verfügbar (${kind}${status === null ? "" : `, HTTP ${status}`}).`);
    this.name = "NarrationError";
  }
}

/** HTTP-Status und Problem-Code der TTS-Route in einen verständlichen Fehlerfall übersetzen. */
export function classifyNarrationFailure(
  status: number | null,
  code: string | null
): NarrationFailure {
  if (code === "TTS_KEY_MISSING" || status === 409) return "key-missing";
  if (status === 429) return "rate-limited";
  if (status === 401) return "signed-out";
  return "unavailable";
}

export interface FetchNarrationOptions {
  readonly notebookId: string;
  readonly text: string;
  readonly lang: Language;
  readonly fetchFn?: typeof fetch | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** WAV-Ton von der Worker-Route holen. Wirft NarrationError mit dem Fehlerfall. */
export async function fetchNarration(options: FetchNarrationOptions): Promise<ArrayBuffer> {
  const fetchFn = options.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(
      `/api/v1/notebooks/${encodeURIComponent(options.notebookId)}/video-tts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: options.text, lang: options.lang }),
        signal: options.signal ?? null
      }
    );
  } catch {
    throw new NarrationError("unavailable", null);
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.ok && type.startsWith("audio/")) return response.arrayBuffer();
  let code: string | null = null;
  try {
    code = ((await response.json()) as { code?: string }).code ?? null;
  } catch {
    code = null;
  }
  throw new NarrationError(
    classifyNarrationFailure(response.ok ? null : response.status, code),
    response.status
  );
}

export interface VideoExportTexts {
  readonly heading: string;
  readonly format: string;
  readonly exportWithAudio: string;
  readonly exportSilent: string;
  readonly cancel: string;
  readonly preparing: string;
  readonly narrating: string;
  readonly rendering: (percent: number) => string;
  readonly done: (file: string) => string;
  readonly download: (file: string) => string;
  readonly failure: Readonly<Record<NarrationFailure, string>>;
  readonly unsupported: string;
  readonly recordError: string;
  readonly cancelled: string;
  readonly silentNote: string;
}

export const VIDEO_EXPORT_TEXTS: Readonly<Record<Language, VideoExportTexts>> = {
  de: {
    heading: "Video exportieren",
    format: "WebM, 1920 × 1080, 30 Bilder pro Sekunde, Sprecherton per Gemini-TTS",
    exportWithAudio: "WebM mit Ton exportieren",
    exportSilent: "Ohne Ton exportieren",
    cancel: "Export abbrechen",
    preparing: "Export wird vorbereitet …",
    narrating: "Sprecherton wird erzeugt …",
    rendering: (percent) => `Video wird aufgenommen: ${percent} %`,
    done: (file) => `Fertig: ${file}`,
    download: (file) => `${file} herunterladen`,
    failure: {
      "key-missing":
        "Für den Ton fehlt ein Gemini-Schlüssel. Hinterlegen Sie Ihren eigenen Schlüssel in den Einstellungen oder öffnen Sie ein Demo-Notebook. Das Video lässt sich auch ohne Ton exportieren.",
      "rate-limited":
        "Der Demo-Schlüssel ist für den Moment ausgelastet. Bitte in einer Minute erneut versuchen oder ohne Ton exportieren.",
      "signed-out": "Für den Ton müssen Sie angemeldet sein. Ohne Ton geht der Export auch so.",
      unavailable:
        "Der Sprecherton konnte nicht erzeugt werden, der Dienst ist gerade nicht erreichbar. Sie können ohne Ton exportieren."
    },
    unsupported:
      "Ihr Browser kann keine Videos aufnehmen (MediaRecorder oder Canvas-Aufnahme fehlt). Bitte einen aktuellen Chrome, Edge oder Firefox nutzen.",
    recordError: "Die Aufnahme ist fehlgeschlagen. Bitte erneut versuchen.",
    cancelled: "Export abgebrochen.",
    silentNote: "Dieses Video hat keinen Ton."
  },
  en: {
    heading: "Export video",
    format: "WebM, 1920 × 1080, 30 frames per second, narration via Gemini TTS",
    exportWithAudio: "Export WebM with audio",
    exportSilent: "Export without audio",
    cancel: "Cancel export",
    preparing: "Preparing export …",
    narrating: "Generating narration …",
    rendering: (percent) => `Recording video: ${percent} %`,
    done: (file) => `Done: ${file}`,
    download: (file) => `Download ${file}`,
    failure: {
      "key-missing":
        "A Gemini key is needed for the audio. Add your own key in Settings or open a demo notebook. You can also export the video without audio.",
      "rate-limited":
        "The demo key is busy right now. Try again in a minute or export without audio.",
      "signed-out": "Sign in to get audio. You can still export without it.",
      unavailable:
        "The narration could not be generated because the service is unreachable. You can export without audio."
    },
    unsupported:
      "Your browser cannot record video (MediaRecorder or canvas capture is missing). Please use a current Chrome, Edge or Firefox.",
    recordError: "Recording failed. Please try again.",
    cancelled: "Export cancelled.",
    silentNote: "This video has no audio."
  }
};
