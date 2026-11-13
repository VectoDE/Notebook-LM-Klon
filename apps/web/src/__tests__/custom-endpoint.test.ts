import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomEndpointSettings } from "../CustomEndpointSettings.js";
import {
  EndpointApiError,
  deleteCustomEndpoint,
  loadCustomEndpoint,
  saveCustomEndpoint,
  testCustomEndpoint
} from "../custom-endpoint-client.js";
import { ENDPOINT_TEXT_KEYS, endpointText } from "../custom-endpoint-i18n.js";
import { ThemeProvider } from "../useTheme.js";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("custom-endpoint-client (Issue #247)", () => {
  it("lädt den Zustand mit Cookie-Sitzung", async () => {
    const state = {
      enabled: true,
      configured: false,
      baseUrl: null,
      chatModel: null,
      embedModel: null,
      hasKey: false
    };
    const { fn, calls } = fakeFetch([Response.json(state)]);
    expect(await loadCustomEndpoint(fn)).toEqual(state);
    expect(calls[0]).toMatchObject({
      url: "/api/v1/providers/custom",
      init: { method: "GET", credentials: "same-origin" }
    });
  });

  it("speichert Adresse und Modelle, den Schlüssel nur wenn angegeben", async () => {
    const ok = () => Response.json({});
    const a = fakeFetch([ok(), ok()]);
    await saveCustomEndpoint(
      {
        baseUrl: " https://x.example/v1 ",
        chatModel: " m ",
        embedModel: " e ",
        apiKey: " key123456789 "
      },
      a.fn
    );
    expect(JSON.parse(String(a.calls[0]?.init.body))).toEqual({
      baseUrl: "https://x.example/v1",
      chatModel: "m",
      embedModel: "e"
    });
    expect(a.calls[1]?.url).toBe("/api/v1/keys/custom");
    expect(JSON.parse(String(a.calls[1]?.init.body))).toEqual({ apiKey: "key123456789" });

    const b = fakeFetch([ok()]);
    await saveCustomEndpoint(
      { baseUrl: "https://x.example", chatModel: "m", embedModel: " ", apiKey: "" },
      b.fn
    );
    expect(b.calls).toHaveLength(1);
    expect(JSON.parse(String(b.calls[0]?.init.body))).not.toHaveProperty("embedModel");

    const c = fakeFetch([ok()]);
    await saveCustomEndpoint({ baseUrl: "https://x.example", chatModel: "m" }, c.fn);
    expect(c.calls).toHaveLength(1);
  });

  it("übersetzt Problem-Antworten und Netzwerkfehler in EndpointApiError", async () => {
    const problem = fakeFetch([
      Response.json({ detail: "Host nicht erlaubt", code: "ENDPOINT_NOT_ALLOWED" }, { status: 422 })
    ]);
    const err = await deleteCustomEndpoint(problem.fn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EndpointApiError);
    expect(err).toMatchObject({
      status: 422,
      code: "ENDPOINT_NOT_ALLOWED",
      message: "Host nicht erlaubt"
    });

    const plain = fakeFetch([new Response("kein json", { status: 500 })]);
    await expect(loadCustomEndpoint(plain.fn)).rejects.toMatchObject({
      status: 500,
      code: undefined,
      message: "HTTP 500"
    });

    const offline = fakeFetch([new TypeError("offline")]);
    await expect(loadCustomEndpoint(offline.fn)).rejects.toMatchObject({ status: 0 });
  });

  it("liefert fehlgeschlagene Verbindungstests als Ergebnis", async () => {
    const ok = fakeFetch([Response.json({ ok: true, latencyMs: 12, models: ["a"] })]);
    expect(await testCustomEndpoint(ok.fn)).toEqual({ ok: true, latencyMs: 12, models: ["a"] });

    const fail = fakeFetch([
      Response.json({ ok: false, latencyMs: 3, message: "Endpunkt-Fehler (401)" }, { status: 422 })
    ]);
    expect(await testCustomEndpoint(fail.fn)).toMatchObject({
      ok: false,
      message: "Endpunkt-Fehler (401)"
    });

    const missing = fakeFetch([Response.json({ code: "ENDPOINT_NOT_FOUND" }, { status: 404 })]);
    await expect(testCustomEndpoint(missing.fn)).rejects.toMatchObject({ status: 404 });
  });

  it("nutzt ohne Angabe das globale fetch", async () => {
    const { fn } = fakeFetch([
      Response.json({}),
      Response.json({}),
      Response.json({ ok: true, latencyMs: 1 }),
      Response.json({ enabled: true })
    ]);
    vi.stubGlobal("fetch", fn);
    await saveCustomEndpoint({ baseUrl: "https://x.example", chatModel: "m" });
    await deleteCustomEndpoint();
    expect((await testCustomEndpoint()).ok).toBe(true);
    expect((await loadCustomEndpoint()).enabled).toBe(true);
  });
});

describe("custom-endpoint-i18n", () => {
  it("hat für jeden Schlüssel deutsche und englische Texte", () => {
    for (const key of ENDPOINT_TEXT_KEYS) {
      expect(endpointText("de", key)).not.toBe(key);
      expect(endpointText("en", key)).not.toBe(key);
    }
  });

  it("ersetzt Platzhalter und lässt unbekannte stehen", () => {
    expect(endpointText("de", "testOk", { ms: 5, n: 2 })).toBe(
      "Verbindung steht (5 ms, 2 Modelle gefunden)."
    );
    expect(endpointText("en", "testFail")).toBe("Connection failed: {msg}");
    expect(endpointText("en", "gibt-es-nicht")).toBe("gibt-es-nicht");
  });
});

describe("CustomEndpointSettings", () => {
  it("rendert beschriftete Felder, Passwortfeld und Live-Region", () => {
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(CustomEndpointSettings))
    );
    expect(html).toContain('data-testid="custom-endpoint-settings"');
    expect(html).toContain('aria-labelledby="custom-endpoint-title"');
    expect(html).toContain("Eigener Endpunkt (OpenAI-kompatibel)");
    expect(html).toContain('for="custom-endpoint-url"');
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-describedby="custom-endpoint-key-hint"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Wird geladen …");
    expect(html).toContain('data-testid="custom-endpoint-test"');
  });
});
