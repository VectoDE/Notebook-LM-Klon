import { LOCAL_KEY_BYTES } from "./local-crypto.js";

/**
 * Sitzungsbezogene Aufrufe für die verschlüsselte lokale Ablage (Issue #348):
 * Schlüsselmaterial abrufen und Abmelden mit Löschen der lokalen Daten.
 */

export type LocalKeyResult =
  | { readonly status: "ok"; readonly material: Uint8Array }
  | { readonly status: "signed-out" }
  | { readonly status: "unavailable" };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * GET /api/v1/auth/local-key. Ohne Sitzung (401) "signed-out"; Netzfehler, 503 oder eine
 * kaputte Antwort "unavailable". Das Material wird nicht zwischengespeichert.
 */
export async function fetchLocalKey(fetchFn: FetchFn): Promise<LocalKeyResult> {
  let res: Response;
  try {
    res = await fetchFn("/api/v1/auth/local-key", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401) return { status: "signed-out" };
  if (!res.ok) return { status: "unavailable" };
  try {
    const body = (await res.json()) as { version?: unknown; keyMaterial?: unknown };
    const material =
      body.version === 1 && typeof body.keyMaterial === "string"
        ? fromBase64Url(body.keyMaterial)
        : null;
    if (!material || material.byteLength !== LOCAL_KEY_BYTES) return { status: "unavailable" };
    return { status: "ok", material };
  } catch {
    return { status: "unavailable" };
  }
}

/** Lokale Schlüssel mit Nutzerinhalten außerhalb von IndexedDB (Darstellung bleibt). */
export const LOCAL_CONTENT_KEYS = ["rn_notebook_titles"] as const;

export interface SignOutResult {
  /** Server hat die Sitzung beendet (204). false bei Netzfehler oder anderem Status. */
  readonly serverSignedOut: boolean;
  /** Lokale Datenbank und Inhaltsschlüssel sind gelöscht. */
  readonly localWiped: boolean;
}

export interface SignOutDeps {
  readonly fetchFn: FetchFn;
  readonly wipe: () => Promise<boolean>;
  readonly storage?: Pick<Storage, "removeItem"> | undefined;
}

/**
 * Abmelden: Erst lokal löschen (gelingt auch offline), dann die Sitzung am Server beenden.
 * Scheitert der Server-Aufruf, sind die lokalen Daten trotzdem weg; mit der beendeten
 * oder abgelaufenen Sitzung ist auch das Schlüsselmaterial nicht mehr abrufbar.
 */
export async function signOutAndWipe(deps: SignOutDeps): Promise<SignOutResult> {
  let localWiped = await deps.wipe().catch(() => false);
  for (const key of LOCAL_CONTENT_KEYS) {
    try {
      deps.storage?.removeItem(key);
    } catch {
      localWiped = false;
    }
  }
  let serverSignedOut = false;
  try {
    const res = await deps.fetchFn("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store"
    });
    serverSignedOut = res.status === 204;
  } catch {
    serverSignedOut = false;
  }
  return { serverSignedOut, localWiped };
}
