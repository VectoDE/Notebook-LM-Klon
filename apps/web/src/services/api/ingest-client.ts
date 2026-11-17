/**
 * Verbindet die Oberfläche mit dem Ingest-Web-Worker (P6, Aufbau angelehnt an PR #397).
 *
 * Jede Datei bekommt einen eigenen Worker: Lesen, PDF-Auszug und Zerlegen laufen außerhalb
 * des Haupt-Threads. Der Worker meldet PROGRESS und zum Schluss CHUNKS_EXTRACTED oder ERROR;
 * danach wird er beendet.
 */

import type {
  IngestParserWorkerRequest,
  IngestParserWorkerResponse
} from "@/workers/ingest-parser.js";
import { type ParsedSource, SourceUploadError } from "./source-upload-client.js";

export interface IngestWorkerLike {
  onmessage: ((event: MessageEvent<IngestParserWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: IngestParserWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export type IngestWorkerFactory = () => IngestWorkerLike;

/** Startet den Ingest-Worker als ES-Modul (Vite bündelt ihn als eigenen Chunk). */
export const createIngestWorker: IngestWorkerFactory = () =>
  new Worker(new URL("../../workers/ingest.worker.ts", import.meta.url), {
    type: "module",
    name: "ingest"
  }) as unknown as IngestWorkerLike;

const RESPONSE_TYPES: readonly unknown[] = ["PROGRESS", "CHUNKS_EXTRACTED", "ERROR"];

/** Nur Antworten des eigenen Protokolls zählen (PDF.js schickt eigene Nachrichten). */
function isIngestResponse(value: unknown): value is IngestParserWorkerResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    RESPONSE_TYPES.includes((value as { type?: unknown }).type)
  );
}

/**
 * Zeitlimit je Datei. Der Worker parst synchron (mammoth, PDF.js); hängt er, hilft nur
 * terminate() von außen. 60 s reichen für eine 50-MB-Datei auf schwachen Geräten.
 */
export const INGEST_PARSE_TIMEOUT_MS = 60_000;

export interface ParseFileOptions {
  readonly createWorker?: IngestWorkerFactory | undefined;
  /** Zeitlimit in Millisekunden (Tests); Standard INGEST_PARSE_TIMEOUT_MS. */
  readonly timeoutMs?: number | undefined;
}

/** Liest eine Datei im Worker und liefert Chunks und Volltext. */
export async function parseFileInWorker(
  file: File,
  mimeType: string,
  options: ParseFileOptions = {}
): Promise<ParsedSource> {
  const buffer = await file.arrayBuffer();
  const worker = (options.createWorker ?? createIngestWorker)();

  return new Promise<ParsedSource>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish();
      reject(
        new SourceUploadError(`Lesen von ${file.name} hat zu lange gedauert.`, 0, "PARSE_TIMEOUT")
      );
    }, options.timeoutMs ?? INGEST_PARSE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    worker.onmessage = (event) => {
      const message: unknown = event.data;
      if (!isIngestResponse(message) || message.type === "PROGRESS") return;
      finish();
      if (message.type === "CHUNKS_EXTRACTED") {
        resolve({ chunks: message.chunks, text: message.text });
      } else if (message.code) {
        // Grenzen (Zip-Bombe, Textlänge) mit Code, damit die Oberfläche den Grund nennt
        reject(new SourceUploadError(message.error, 0, message.code));
      } else {
        reject(new Error(message.error));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Ingest worker failed"));
    };

    const fileData = new Uint8Array(buffer);
    // Puffer übertragen statt kopieren: große Dateien belegen den Speicher nur einmal
    worker.postMessage(
      { type: "PARSE_DOCUMENT", payload: { fileData, fileName: file.name, mimeType } },
      [fileData.buffer]
    );
  });
}
