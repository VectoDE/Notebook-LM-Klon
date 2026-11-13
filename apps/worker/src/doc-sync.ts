import { createProblemDetails } from "@notebook-lm/shared";
import type { Context, Hono } from "hono";
import * as Y from "yjs";

/**
 * Yjs-Stand eines Notebooks (Issue #347): der Server hält je Notebook einen zusammengeführten
 * Yjs-Update-Blob im NotebookDO. Clients schicken ihre Änderungen als Yjs-Updates (auch
 * gesammelt nach einer Offline-Phase) und holen per Zustandsvektor nur, was ihnen fehlt.
 * Konflikte löst der CRDT-Stand: Updates sind kommutativ und idempotent, jede Reihenfolge
 * und jede Wiederholung ergibt denselben Endstand.
 */

/** Größtes einzelnes Update (gesammelte Offline-Änderungen eingeschlossen). */
export const MAX_UPDATE_BYTES = 256 * 1024;
/** Größter gespeicherter Stand je Notebook. */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

export class DocSyncError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DocSyncError";
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strenges base64url ohne Auffüllung; alles andere ist ein 400. */
export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new DocSyncError(400, "INVALID_ENCODING", "Ungültige base64url-Kodierung.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Prüft Größe und Aufbau eines Yjs-Updates (v1-Kodierung). */
export function validateUpdate(update: Uint8Array): void {
  if (update.byteLength === 0) {
    throw new DocSyncError(400, "INVALID_UPDATE", "Leeres Yjs-Update.");
  }
  if (update.byteLength > MAX_UPDATE_BYTES) {
    throw new DocSyncError(413, "UPDATE_TOO_LARGE", "Yjs-Update ist zu groß.");
  }
  try {
    Y.decodeUpdate(update);
  } catch {
    throw new DocSyncError(400, "INVALID_UPDATE", "Kein gültiges Yjs-Update.");
  }
}

/** Führt ein Update in den gespeicherten Stand ein (idempotent). */
export function mergeIntoState(state: Uint8Array | null, update: Uint8Array): Uint8Array {
  validateUpdate(update);
  let merged: Uint8Array;
  try {
    merged = state ? Y.mergeUpdates([state, update]) : update;
  } catch {
    throw new DocSyncError(400, "INVALID_UPDATE", "Yjs-Update lässt sich nicht einfügen.");
  }
  if (merged.byteLength > MAX_DOC_BYTES) {
    throw new DocSyncError(413, "DOC_TOO_LARGE", "Der Notebook-Stand ist zu groß.");
  }
  return merged;
}

const EMPTY_STATE = Y.encodeStateAsUpdate(new Y.Doc());

/** Was dem Client mit Zustandsvektor `stateVector` fehlt, dazu der Zustandsvektor des Servers. */
export function diffFromState(
  state: Uint8Array | null,
  stateVector?: Uint8Array
): { update: Uint8Array; stateVector: Uint8Array } {
  const current = state ?? EMPTY_STATE;
  try {
    return {
      update: stateVector ? Y.diffUpdate(current, stateVector) : current,
      stateVector: Y.encodeStateVectorFromUpdate(current)
    };
  } catch {
    throw new DocSyncError(400, "INVALID_STATE_VECTOR", "Ungültiger Zustandsvektor.");
  }
}

const PROBLEM_HEADERS = {
  "content-type": "application/problem+json; charset=utf-8",
  "cache-control": "no-store"
} as const;

function problem(c: Context, status: 400 | 413 | 503, code: string, detail: string): Response {
  return c.json(
    createProblemDetails({
      status,
      title:
        status === 503
          ? "Service Unavailable"
          : status === 413
            ? "Payload Too Large"
            : "Bad Request",
      detail,
      instance: c.req.path,
      code
    }),
    status,
    PROBLEM_HEADERS
  );
}

/**
 * GET  /api/v1/notebooks/:id/doc?sv=…  fehlende Änderungen (viewer)
 * POST /api/v1/notebooks/:id/doc       Änderungen einspielen (editor), Body { update }
 * Rollen prüft index.ts vor diesen Handlern.
 */
// biome-ignore lint/suspicious/noExplicitAny: shared with differently typed Hono apps
export function registerDocSyncRoutes(app: Hono<any>): void {
  const stubFor = (c: Context) => {
    const ns = (c.env as Env | undefined)?.NOTEBOOK_DO;
    if (!ns) return null;
    return ns.get(ns.idFromName(c.req.param("id") as string));
  };

  const relay = async (res: Response): Promise<Response> => {
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "content-type": res.ok
          ? "application/json; charset=utf-8"
          : "application/problem+json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  };

  app.get("/api/v1/notebooks/:id/doc", async (c) => {
    const stub = stubFor(c);
    if (!stub)
      return problem(c, 503, "DOC_SYNC_UNAVAILABLE", "Synchronisierung ist nicht verfügbar.");
    const sv = c.req.query("sv");
    if (sv !== undefined) {
      try {
        fromBase64Url(sv);
      } catch (error) {
        return problem(c, 400, (error as DocSyncError).code, (error as DocSyncError).message);
      }
    }
    const target = sv ? `http://internal/doc?sv=${sv}` : "http://internal/doc";
    return relay(await stub.fetch(target));
  });

  app.post("/api/v1/notebooks/:id/doc", async (c) => {
    const stub = stubFor(c);
    if (!stub)
      return problem(c, 503, "DOC_SYNC_UNAVAILABLE", "Synchronisierung ist nicht verfügbar.");
    // base64url bläht um 4/3 auf; großzügige Grenze vor dem Einlesen des Bodys
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_UPDATE_BYTES * 2) {
      return problem(c, 413, "UPDATE_TOO_LARGE", "Yjs-Update ist zu groß.");
    }
    let update: Uint8Array;
    try {
      const body = (await c.req.json()) as { update?: unknown };
      if (typeof body?.update !== "string")
        throw new DocSyncError(400, "INVALID_BODY", "Feld update fehlt.");
      update = fromBase64Url(body.update);
      validateUpdate(update);
    } catch (error) {
      if (error instanceof DocSyncError) return problem(c, error.status, error.code, error.message);
      return problem(c, 400, "INVALID_JSON", "Ungültiges JSON.");
    }
    return relay(
      await stub.fetch("http://internal/doc", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: update
      })
    );
  });
}
