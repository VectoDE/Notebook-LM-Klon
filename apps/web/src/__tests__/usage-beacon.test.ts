import { describe, expect, it, vi } from "vitest";
import { USAGE_ENDPOINT, allowsUsageCount, sendUsageBeacon } from "../usage-beacon.js";

describe("Cookieloser Nutzungszähler im Browser (Issue #262)", () => {
  it("sendet genau einen Zähler ohne Cookies und ohne Kennung", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const ok = await sendUsageBeacon({
      fetch: fetchMock as unknown as typeof fetch,
      navigator: {},
      production: true
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(USAGE_ENDPOINT);
    expect(init.credentials).toBe("omit");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ metric: "page_view" });
    expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization/i);
  });

  it("schreibt nichts auf das Gerät", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    const doc = { cookie: "" };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("document", doc);
    await sendUsageBeacon({
      fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      navigator: {},
      production: true
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(doc.cookie).toBe("");
    vi.unstubAllGlobals();
  });

  it("zählt nicht bei Global Privacy Control, Do Not Track oder im Entwicklungsserver", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const f = fetchMock as unknown as typeof fetch;
    expect(
      await sendUsageBeacon({
        fetch: f,
        navigator: { globalPrivacyControl: true },
        production: true
      })
    ).toBe(false);
    expect(
      await sendUsageBeacon({ fetch: f, navigator: { doNotTrack: "1" }, production: true })
    ).toBe(false);
    expect(await sendUsageBeacon({ fetch: f, navigator: {}, production: false })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(allowsUsageCount({ doNotTrack: "0", globalPrivacyControl: false })).toBe(true);
    expect(allowsUsageCount({ doNotTrack: null })).toBe(true);
  });

  it("meldet Fehler still zurück", async () => {
    const rejected = await sendUsageBeacon({
      fetch: (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
      navigator: {},
      production: true
    });
    const serverError = await sendUsageBeacon({
      fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
      navigator: {},
      production: true
    });
    expect(rejected).toBe(false);
    expect(serverError).toBe(false);
  });
});
