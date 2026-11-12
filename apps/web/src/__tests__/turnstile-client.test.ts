import { describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TEST_SITE_KEY,
  type TurnstileApi,
  authErrorKey,
  loadTurnstileScript,
  requestGuestSession,
  requestMagicLink,
  resolveTurnstileSiteKey
} from "../turnstile-client.js";

const fakeApi: TurnstileApi = {
  render: () => "widget-1",
  reset: () => undefined,
  remove: () => undefined
};

/** Minimaler Script-Knoten: merkt sich Listener und kann load/error auslösen. */
class FakeScript {
  src = "";
  async = false;
  defer = false;
  dataset: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  fire(type: "load" | "error") {
    this.listeners[type]?.();
  }
}

function fakeDocument(existing?: FakeScript) {
  const appended: FakeScript[] = [];
  const doc = {
    querySelector: vi.fn(() => existing ?? null),
    createElement: vi.fn(() => new FakeScript()),
    head: { appendChild: (node: FakeScript) => appended.push(node) }
  };
  return { doc: doc as unknown as Document, appended };
}

describe("resolveTurnstileSiteKey", () => {
  it("uses the configured key and trims it", () => {
    expect(
      resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: " 0x4AAA-real ", DEV: false })
    ).toEqual({ status: "configured", siteKey: "0x4AAA-real", isTestKey: false });
  });

  it("marks the official test key as test key, even when configured explicitly", () => {
    expect(
      resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY, DEV: false })
    ).toEqual({ status: "configured", siteKey: TURNSTILE_TEST_SITE_KEY, isTestKey: true });
  });

  it("falls back to the test key only in development", () => {
    expect(resolveTurnstileSiteKey({ DEV: true })).toEqual({
      status: "configured",
      siteKey: "1x00000000000000000000AA",
      isTestKey: true
    });
    expect(resolveTurnstileSiteKey({ VITE_TURNSTILE_SITE_KEY: "  ", DEV: true }).status).toBe(
      "configured"
    );
  });

  it("reports a missing key in production builds", () => {
    expect(resolveTurnstileSiteKey({ DEV: false })).toEqual({ status: "missing" });
    expect(resolveTurnstileSiteKey({})).toEqual({ status: "missing" });
  });
});

describe("loadTurnstileScript", () => {
  it("returns the API at once when it is already loaded", async () => {
    const { doc, appended } = fakeDocument();
    await expect(loadTurnstileScript(doc, { turnstile: fakeApi })).resolves.toBe(fakeApi);
    expect(appended).toHaveLength(0);
  });

  it("appends the official script once and resolves after load", async () => {
    const { doc, appended } = fakeDocument();
    const win: { turnstile?: TurnstileApi } = {};
    const promise = loadTurnstileScript(doc, win);
    expect(appended).toHaveLength(1);
    const script = appended[0] as FakeScript;
    expect(script.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(script.src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    );
    expect(script.async).toBe(true);
    expect(script.defer).toBe(true);
    expect(script.dataset.turnstileScript).toBe("true");
    win.turnstile = fakeApi;
    script.fire("load");
    await expect(promise).resolves.toBe(fakeApi);
  });

  it("reuses a script tag that is still loading", async () => {
    const existing = new FakeScript();
    const { doc, appended } = fakeDocument(existing);
    const win: { turnstile?: TurnstileApi } = {};
    const promise = loadTurnstileScript(doc, win);
    expect(appended).toHaveLength(0);
    win.turnstile = fakeApi;
    existing.fire("load");
    await expect(promise).resolves.toBe(fakeApi);
  });

  it("rejects when the script fails or loads without an API", async () => {
    const failing = fakeDocument();
    const failed = loadTurnstileScript(failing.doc, {});
    (failing.appended[0] as FakeScript).fire("error");
    await expect(failed).rejects.toThrow("turnstile-script-failed");

    const empty = fakeDocument();
    const noApi = loadTurnstileScript(empty.doc, {});
    (empty.appended[0] as FakeScript).fire("load");
    await expect(noApi).rejects.toThrow("turnstile-unavailable");
  });
});

describe("auth calls", () => {
  it("posts the guest login with token and locale", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 201 }));
    await expect(
      requestGuestSession(fetchFn as unknown as typeof fetch, "tok", "en")
    ).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith("/api/v1/auth/guest", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "tok", locale: "en" })
    });
  });

  it("posts the magic link with email, token and locale", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await requestMagicLink(fetchFn as unknown as typeof fetch, "a@b.de", "tok", "de");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/v1/auth/magic-link",
      expect.objectContaining({
        body: JSON.stringify({ email: "a@b.de", turnstileToken: "tok", locale: "de" })
      })
    );
  });

  it("returns the problem code, the HTTP status or a network error", async () => {
    const problem = vi.fn(async () =>
      Response.json({ code: "TURNSTILE_NOT_CONFIGURED" }, { status: 503 })
    );
    expect(await requestGuestSession(problem as unknown as typeof fetch, "t", "de")).toEqual({
      ok: false,
      code: "TURNSTILE_NOT_CONFIGURED"
    });

    const noCode = vi.fn(async () => Response.json({ title: "x" }, { status: 502 }));
    expect(await requestGuestSession(noCode as unknown as typeof fetch, "t", "de")).toEqual({
      ok: false,
      code: "HTTP_502"
    });

    const notJson = vi.fn(async () => new Response("oops", { status: 500 }));
    expect(await requestGuestSession(notJson as unknown as typeof fetch, "t", "de")).toEqual({
      ok: false,
      code: "HTTP_500"
    });

    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestMagicLink(offline as unknown as typeof fetch, "a@b.de", "t", "de")).toEqual(
      { ok: false, code: "NETWORK_ERROR" }
    );
  });
});

describe("authErrorKey", () => {
  it.each([
    ["TURNSTILE_NOT_CONFIGURED", "signInErrorServerConfig"],
    ["BOT_VERIFICATION_REQUIRED", "signInErrorBot"],
    ["BOT_VERIFICATION_FAILED", "signInErrorBot"],
    ["INVALID_EMAIL", "signInErrorEmail"],
    ["RATE_LIMIT_EXCEEDED", "signInErrorRateLimit"],
    ["HTTP_429", "signInErrorRateLimit"],
    ["EMAIL_DELIVERY_FAILED", "signInErrorMail"],
    ["NETWORK_ERROR", "signInErrorNetwork"],
    ["HTTP_500", "signInErrorGeneric"]
  ])("maps %s to %s", (code, key) => {
    expect(authErrorKey(code)).toBe(key);
  });
});
