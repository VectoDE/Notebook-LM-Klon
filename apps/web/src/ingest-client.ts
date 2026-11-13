/**
 * Verbindet die Oberfläche mit dem Ingest-Web-Worker (Issues #88, #154).
 *
 * Jede Datei bekommt einen eigenen Worker: Lesen, PDF-/DOCX-Auszug, Texterkennung und
 * Zerlegen laufen außerhalb des Haupt-Threads. Der Worker meldet PROGRESS (steigend) und
 * zum Schluss CHUNKS_EXTRACTED oder ERROR; danach wird er beendet.
 */
import type { TextChunk } from "@notebook-lm/shared";
import type {
  IngestErrorCode,
  IngestParserWorkerRequest,
  IngestParserWorkerResponse,
  IngestStage
} from "./workers/ingest-parser.js";

export interface IngestWorkerLike {
  onmessage: ((event: MessageEvent<IngestParserWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: IngestParserWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export type IngestWorkerFactory = () => IngestWorkerLike;

/** Datei-Schnittstelle, die der Client braucht (File erfüllt sie). */
export interface IngestFileLike {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface IngestResult {
  readonly chunks: TextChunk[];
  readonly text: string;
}

export class IngestFailure extends Error {
  readonly code: IngestErrorCode;
  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestFailure";
    this.code = code;
  }
}

/** Startet den Ingest-Worker als ES-Modul (Vite bündelt ihn als eigenen Chunk). */
export const createIngestWorker: IngestWorkerFactory = () =>
  new Worker(new URL("./workers/ingest.worker.ts", import.meta.url), {
    type: "module",
    name: "ingest"
  }) as unknown as IngestWorkerLike;

const RESPONSE_TYPES: readonly unknown[] = ["PROGRESS", "CHUNKS_EXTRACTED", "ERROR"];

/** Nur Antworten des eigenen Protokolls zählen. */
export function isIngestResponse(value: unknown): value is IngestParserWorkerResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    RESPONSE_TYPES.includes((value as { type?: unknown }).type)
  );
}

export interface IngestFileOptions {
  readonly onProgress?: ((stage: IngestStage, progress: number) => void) | undefined;
  readonly createWorker?: IngestWorkerFactory | undefined;
}

/** Verarbeitet eine Datei im Worker und liefert Chunks und Volltext. */
export async function ingestFile(
  file: IngestFileLike,
  options: IngestFileOptions = {}
): Promise<IngestResult> {
  const buffer = await file.arrayBuffer();
  const worker = (options.createWorker ?? createIngestWorker)();

  return new Promise<IngestResult>((resolve, reject) => {
    const finish = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (event) => {
      // PDF.js meldet sich im Worker-Kontext mit eigenen Nachrichten ("ready") beim
      // Haupt-Thread; nur das eigene Protokoll wird ausgewertet
      const message: unknown = event.data;
      if (!isIngestResponse(message)) return;
      if (message.type === "PROGRESS") {
        options.onProgress?.(message.stage, message.progress);
      } else if (message.type === "CHUNKS_EXTRACTED") {
        finish();
        resolve({ chunks: message.chunks, text: message.text });
      } else {
        finish();
        reject(new IngestFailure(message.code, message.error));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new IngestFailure("failed", event.message || "Ingest worker failed"));
    };

    const fileData = new Uint8Array(buffer);
    // Puffer übertragen statt kopieren: große Dateien belegen den Speicher nur einmal
    worker.postMessage(
      {
        type: "PARSE_DOCUMENT",
        payload: { fileData, fileName: file.name, mimeType: file.type }
      },
      [fileData.buffer]
    );
  });
}
