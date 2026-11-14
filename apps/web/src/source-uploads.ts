/**
 * Zustände einer hochgeladenen Quelle in der Quellenliste (P6): zuerst ein Platzhalter
 * ("processing"), nach dem Upload die Quelle mit Server-ID und Volltext ("ready") oder ein
 * sichtbarer Fehler ("error"). Reine Funktionen, damit WorkspaceLayout sie nur anwendet.
 */
import { errorKeyForStatus } from "./chat-client.js";
// Nur Typen: der Upload-Client wird erst beim ersten Upload nachgeladen
import type { SourceUploadError, UploadSourceResult } from "./source-upload-client.js";
import type { WorkspaceSource } from "./workspace-types.js";

/** Platzhalter, solange die Datei gelesen, hochgeladen und indexiert wird. */
export function createPendingSource(file: File, id: string): WorkspaceSource {
  return {
    id,
    title: file.name.replace(/\.[^/.]+$/, ""),
    originalName: file.name,
    mimeType: file.type || "text/plain",
    byteSize: file.size,
    isSelected: false,
    status: "processing"
  };
}

/** Platzhalter wird zur Quelle des Servers; die ID gilt ab jetzt für Chat und Zitate. */
export function markSourceReady(
  sources: readonly WorkspaceSource[],
  pendingId: string,
  result: UploadSourceResult
): WorkspaceSource[] {
  return sources.map((source) =>
    source.id === pendingId
      ? {
          ...source,
          id: result.sourceId,
          mimeType: result.mimeType,
          isSelected: true,
          status: "ready",
          chunksCount: result.chunksCount,
          rawText: result.text
        }
      : source
  );
}

/** Fehlschlag bleibt in der Liste sichtbar (mit Grund), wird aber nicht im Chat genutzt. */
export function markSourceFailed(
  sources: readonly WorkspaceSource[],
  pendingId: string,
  errorKey: string
): WorkspaceSource[] {
  return sources.map((source) =>
    source.id === pendingId ? { ...source, isSelected: false, status: "error", errorKey } : source
  );
}

/** Strukturell geprüft, damit dieses Modul den Upload-Client nicht statisch lädt. */
function isSourceUploadError(error: unknown): error is SourceUploadError {
  return (
    error instanceof Error &&
    error.name === "SourceUploadError" &&
    typeof (error as Partial<SourceUploadError>).status === "number" &&
    typeof (error as Partial<SourceUploadError>).code === "string"
  );
}

/** Schlüssel im Sprachkatalog mit verständlichem Grund und Handlungshinweis. */
export function uploadErrorKey(error: unknown): string {
  if (!isSourceUploadError(error)) return "srcErrorRead";
  if (error.code === "UNSUPPORTED_TYPE" || error.status === 415) return "srcErrorType";
  if (error.code === "NO_TEXT") return "srcErrorEmpty";
  if (error.status === 413) return "srcErrorSize";
  return errorKeyForStatus(error.status);
}
