/**
 * Texterkennung (OCR) für Bilder im Browser (Issue #153).
 *
 * Tesseract.js wird erst beim ersten Bild per dynamischem import() geladen. Die Erkennung
 * selbst läuft als WebAssembly in einem eigenen Web Worker von Tesseract.js, der Haupt-Thread
 * bleibt frei. Worker-Skript, WASM-Kern und die Sprachdaten (Deutsch, Englisch) liefert die
 * App selbst unter /ocr/ aus; es geht keine Anfrage an fremde CDNs (Datenschutz, CSP:
 * script-src 'self' 'wasm-unsafe-eval', worker-src 'self', connect-src 'self').
 */

/** Unterstützte Bildformate. */
export const OCR_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

/** Deutsch und Englisch, in dieser Reihenfolge. */
export const OCR_LANGUAGES = ["deu", "eng"] as const;

/** Ab dieser mittleren Sicherheit (0–100) gilt ein Ergebnis als lesbar. */
export const OCR_MIN_CONFIDENCE = 40;

export interface OcrResult {
  readonly text: string;
  /** Mittlere Erkennungssicherheit 0–100 laut Tesseract. */
  readonly confidence: number;
}

/** Statusmeldung der Erkennung: Phase und Fortschritt 0–1 innerhalb der Phase. */
export interface OcrLogMessage {
  readonly status: string;
  readonly progress: number;
}

export interface OcrAssetPaths {
  readonly workerPath?: string | undefined;
  readonly corePath?: string | undefined;
  readonly langPath: string;
  /** Nur Node: Ablage der entpackten Sprachdaten (Standard wäre das Arbeitsverzeichnis). */
  readonly cachePath?: string | undefined;
}

/** Erkennt Text in einem Bild; in Tests austauschbar. */
export type OcrRecognizer = (
  image: Uint8Array,
  onLog: (message: OcrLogMessage) => void
) => Promise<OcrResult>;

export class OcrUnreadableError extends Error {
  constructor(message = "Im Bild wurde kein lesbarer Text erkannt.") {
    super(message);
    this.name = "OcrUnreadableError";
  }
}

/** Selbst gehostete Dateien im Browser (siehe vite.config.ts, Plugin ocr-assets). */
export const BROWSER_OCR_PATHS: OcrAssetPaths = {
  workerPath: "/ocr/worker.min.js",
  corePath: "/ocr/core",
  langPath: "/ocr/lang"
};

/**
 * Bildet die Phasen von Tesseract.js auf einen Gesamtfortschritt 0–100 ab: Laden von Kern
 * und Sprachdaten bis 30 %, Erkennung 30–100 %.
 */
export function ocrProgressFromLog(message: OcrLogMessage): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(message.progress) ? message.progress : 0));
  if (message.status === "recognizing text") return Math.round(30 + p * 70);
  if (message.status.includes("traineddata")) return Math.round(10 + p * 20);
  return Math.round(p * 10);
}

/** Erzeugt einen Recognizer auf Basis von Tesseract.js mit den angegebenen Pfaden. */
export function createTesseractRecognizer(paths: OcrAssetPaths = BROWSER_OCR_PATHS): OcrRecognizer {
  // Nur gesetzte Pfade übergeben, sonst gelten die Standardwerte von Tesseract.js (Node)
  const definedPaths = Object.fromEntries(
    Object.entries(paths).filter(([, value]) => typeof value === "string")
  );
  return async (image, onLog) => {
    const { createWorker, OEM } = await import("tesseract.js");
    const worker = await createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, {
      ...definedPaths,
      // Worker direkt von der eigenen Origin laden statt über eine blob:-URL
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) =>
        onLog({ status: m.status, progress: m.progress })
    });
    try {
      // Browser- und Node-Build lesen Uint8Array direkt ein (new Uint8Array(image))
      const { data } = await worker.recognize(
        image as unknown as Parameters<typeof worker.recognize>[0]
      );
      return { text: data.text, confidence: data.confidence };
    } finally {
      await worker.terminate();
    }
  };
}

export interface RecognizeImageOptions {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly onProgress?: ((progress: number) => void) | undefined;
  readonly recognize?: OcrRecognizer | undefined;
  readonly minConfidence?: number | undefined;
}

/**
 * Erkennt Text in einem Bild. Fortschritt läuft nur vorwärts und endet bei 100. Leere oder
 * zu unsichere Ergebnisse werden als unlesbar abgelehnt, statt Müll zu indexieren.
 */
export async function recognizeImageText(options: RecognizeImageOptions): Promise<string> {
  const { data, mimeType, onProgress, minConfidence = OCR_MIN_CONFIDENCE } = options;
  if (!OCR_MIME_TYPES.includes(mimeType.toLowerCase())) {
    throw new Error(`Bildformat ${mimeType} wird für die Texterkennung nicht unterstützt.`);
  }
  if (data.byteLength === 0) {
    throw new OcrUnreadableError("Die Bilddatei ist leer.");
  }
  const recognize = options.recognize ?? createTesseractRecognizer();

  let last = 0;
  onProgress?.(0);
  const result = await recognize(data, (message) => {
    const next = ocrProgressFromLog(message);
    if (next > last) {
      last = next;
      onProgress?.(next);
    }
  });

  const text = result.text.replace(/[ \t]+\n/g, "\n").trim();
  if (text.length === 0 || result.confidence < minConfidence) {
    throw new OcrUnreadableError();
  }
  if (last < 100) onProgress?.(100);
  return text;
}
