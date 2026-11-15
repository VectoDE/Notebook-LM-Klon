/**
 * Eigene Quellen hochladen (P6): Datei lesen und zerlegen, beim Worker anmelden, Bytes
 * hochladen, Format prüfen lassen und die Chunks in den Suchindex (D1 + FTS5) schreiben.
 *
 * Reihenfolge der Worker-Routen:
 * 1. POST /api/v1/notebooks/:id/sources        Quelle anlegen, liefert Upload-Ziel
 * 2. PUT  <uploadUrl>                           Bytes (Worker-Route oder vorsigniertes R2)
 * 3. POST /api/v1/sources/:id/upload/complete   Magic-Byte-Prüfung
 * 4. POST /api/v1/sources/:id/chunks            Chunks in Paketen, das letzte setzt "ready"
 *
 * Gelesen wird zuerst: Eine Datei ohne lesbaren Text legt gar nicht erst eine Quelle an.
 * Scheitert ein Schritt nach dem Anlegen, wird die Quelle wieder gelöscht.
 */
import type { TextChunk } from "@notebook-lm/shared";

/** Dateiarten, die der Parser lesen kann, mit dem MIME-Typ, den der Worker erwartet. */
export const SOURCE_UPLOAD_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

/** Upload-Grenze je Datei, gleich MAX_SOURCE_BYTE_SIZE_LIMIT im Worker (50 MB). */
export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024;

/** Chunks je Anfrage an /chunks; hält die Körper klein und die D1-Batches überschaubar. */
export const CHUNK_BATCH_SIZE = 50;

export type SourceUploadStage = "parsing" | "uploading" | "verifying" | "indexing";

export interface ParsedSource {
  readonly chunks: readonly TextChunk[];
  /** Volltext für die Vorschau und die markierten Zitatstellen. */
  readonly text: string;
}

export type SourceParser = (file: File, mimeType: string) => Promise<ParsedSource>;

export interface UploadSourceOptions {
  readonly notebookId: string;
  readonly file: File;
  readonly parse: SourceParser;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly onStage?: ((stage: SourceUploadStage) => void) | undefined;
}

export interface UploadSourceResult {
  readonly sourceId: string;
  readonly mimeType: string;
  readonly chunksCount: number;
  readonly text: string;
}

/** Fehler beim Hochladen; status 0 heißt Netzwerk- oder Client-Fehler. */
export class SourceUploadError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "SourceUploadError";
    this.status = status;
    this.code = code;
  }
}

/**
 * MIME-Typ für den Upload: der Typ des Browsers, sofern unterstützt, sonst aus der Endung.
 * Windows meldet .md oft ohne Typ oder als application/octet-stream.
 */
export function resolveUploadMimeType(file: Pick<File, "name" | "type">): string | null {
  const browserType = file.type.trim().toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(browserType)) return browserType;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return (ext && SOURCE_UPLOAD_MIME_BY_EXTENSION[ext]) || null;
}

async function problemFrom(res: Response): Promise<SourceUploadError> {
  let detail = `Anfrage fehlgeschlagen (HTTP ${res.status}).`;
  let code = `HTTP_${res.status}`;
  try {
    const problem = (await res.json()) as Record<string, unknown>;
    if (typeof problem.detail === "string") detail = problem.detail;
    else if (typeof problem.title === "string") detail = problem.title;
    if (typeof problem.code === "string") code = problem.code;
  } catch {
    // Kein JSON-Körper: Standardtext bleibt.
  }
  return new SourceUploadError(detail, res.status, code);
}

async function send(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch {
    throw new SourceUploadError(
      "Netzwerkfehler: Der Server ist nicht erreichbar.",
      0,
      "NETWORK_ERROR"
    );
  }
  if (!res.ok) throw await problemFrom(res);
  return res;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  };
}

/** Lädt eine Datei als Quelle ins Notebook und indexiert ihre Chunks. */
export async function uploadSource(options: UploadSourceOptions): Promise<UploadSourceResult> {
  const { notebookId, file, parse, onStage } = options;
  const doFetch = options.fetchImpl ?? fetch;

  const mimeType = resolveUploadMimeType(file);
  if (!mimeType) {
    throw new SourceUploadError(
      `Dateiart von ${file.name} wird nicht unterstützt.`,
      0,
      "UNSUPPORTED_TYPE"
    );
  }

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new SourceUploadError(`${file.name} ist größer als 50 MB.`, 413, "FILE_TOO_LARGE");
  }

  onStage?.("parsing");
  const parsed = await parse(file, mimeType);
  const chunks = parsed.chunks.filter((chunk) => chunk.text.trim().length > 0);
  if (chunks.length === 0) {
    throw new SourceUploadError(`${file.name} enthält keinen lesbaren Text.`, 0, "NO_TEXT");
  }

  onStage?.("uploading");
  const initRes = await send(
    doFetch,
    `/api/v1/notebooks/${encodeURIComponent(notebookId)}/sources`,
    jsonInit("POST", { filename: file.name, mimeType, byteSize: file.size })
  );
  const init = (await initRes.json()) as {
    readonly sourceId?: unknown;
    readonly mode?: unknown;
    readonly uploadUrl?: unknown;
  };
  if (typeof init.sourceId !== "string" || typeof init.uploadUrl !== "string") {
    throw new SourceUploadError("Unerwartete Antwort vom Server.", initRes.status, "INVALID_BODY");
  }
  const sourceId = init.sourceId;
  const sourcePath = `/api/v1/sources/${encodeURIComponent(sourceId)}`;

  try {
    // Vorsignierte R2-Adressen liegen auf fremder Origin: dorthin keine Cookies
    const presigned = init.mode === "presigned-s3";
    await send(doFetch, init.uploadUrl, {
      method: "PUT",
      headers: { "content-type": mimeType },
      credentials: presigned ? "omit" : "same-origin",
      body: file
    });

    onStage?.("verifying");
    await send(doFetch, `${sourcePath}/upload/complete`, {
      method: "POST",
      headers: { accept: "application/json" },
      credentials: "same-origin"
    });

    onStage?.("indexing");
    for (let start = 0; start < chunks.length; start += CHUNK_BATCH_SIZE) {
      const batch = chunks.slice(start, start + CHUNK_BATCH_SIZE).map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        pageNumber: chunk.pageNumber ?? null,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset
      }));
      const isLast = start + CHUNK_BATCH_SIZE >= chunks.length;
      await send(
        doFetch,
        `${sourcePath}/chunks`,
        jsonInit("POST", { chunks: batch, markReady: isLast })
      );
    }
  } catch (error) {
    // Halbfertige Quelle nicht stehen lassen (Ergebnis des Aufräumens ist zweitrangig)
    await doFetch(sourcePath, { method: "DELETE", credentials: "same-origin" }).catch(
      () => undefined
    );
    throw error;
  }

  return { sourceId, mimeType, chunksCount: chunks.length, text: parsed.text };
}
