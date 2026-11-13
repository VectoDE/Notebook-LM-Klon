import { describe, expect, it, vi } from "vitest";
import { LOCAL_CONTENT_KEYS, fetchLocalKey, signOutAndWipe } from "../local-session.js";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchLocalKey (Issue #348)", () => {
  it("liefert 32 Byte Material ohne Zwischenspeicher", async () => {
    const bytes = new Uint8Array(32).map((_, i) => 250 - i);
    const fetchFn = vi.fn(async () => json({ version: 1, keyMaterial: b64url(bytes) }));
    const result = await fetchLocalKey(fetchFn);
    expect(result).toEqual({ status: "ok", material: bytes });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/v1/auth/local-key",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" })
    );
  });

  it("401 heißt abgemeldet", async () => {
    expect(await fetchLocalKey(async () => json({}, 401))).toEqual({ status: "signed-out" });
  });

  it("Netzfehler, 503 und kaputte Antworten heißen nicht verfügbar", async () => {
    const unavailable = { status: "unavailable" };
    expect(
      await fetchLocalKey(async () => {
        throw new TypeError("offline");
      })
    ).toEqual(unavailable);
    expect(await fetchLocalKey(async () => json({}, 503))).toEqual(unavailable);
    expect(await fetchLocalKey(async () => new Response("kein json"))).toEqual(unavailable);
    expect(await fetchLocalKey(async () => json({ version: 2, keyMaterial: "AAAA" }))).toEqual(
      unavailable
    );
    expect(await fetchLocalKey(async () => json({ version: 1, keyMaterial: 5 }))).toEqual(
      unavailable
    );
    expect(await fetchLocalKey(async () => json({ version: 1, keyMaterial: "a+b/" }))).toEqual(
      unavailable
    );
    expect(
      await fetchLocalKey(async () => json({ version: 1, keyMaterial: b64url(new Uint8Array(8)) }))
    ).toEqual(unavailable);
  });
});

describe("signOutAndWipe", () => {
  it("löscht lokal zuerst und beendet dann die Sitzung", async () => {
    const order: string[] = [];
    const storage = { removeItem: vi.fn((key: string) => order.push(`remove:${key}`)) };
    const result = await signOutAndWipe({
      wipe: async () => {
        order.push("wipe");
        return true;
      },
      fetchFn: async (input, init) => {
        order.push(`${init?.method} ${input}`);
        return new Response(null, { status: 204 });
      },
      storage
    });
    expect(result).toEqual({ serverSignedOut: true, localWiped: true });
    expect(order).toEqual([
      "wipe",
      ...LOCAL_CONTENT_KEYS.map((k) => `remove:${k}`),
      "POST /api/v1/auth/logout"
    ]);
  });

  it("löscht lokal auch offline", async () => {
    const result = await signOutAndWipe({
      wipe: async () => true,
      fetchFn: async () => {
        throw new TypeError("offline");
      }
    });
    expect(result).toEqual({ serverSignedOut: false, localWiped: true });
  });

  it("meldet gescheitertes Löschen ehrlich", async () => {
    const rejected = await signOutAndWipe({
      wipe: async () => {
        throw new Error("blockiert");
      },
      fetchFn: async () => new Response(null, { status: 500 })
    });
    expect(rejected).toEqual({ serverSignedOut: false, localWiped: false });

    const storageFails = await signOutAndWipe({
      wipe: async () => true,
      fetchFn: async () => new Response(null, { status: 204 }),
      storage: {
        removeItem: () => {
          throw new Error("gesperrt");
        }
      }
    });
    expect(storageFails).toEqual({ serverSignedOut: true, localWiped: false });
  });
});
