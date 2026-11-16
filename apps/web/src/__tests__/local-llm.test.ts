import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_MODEL_DOWNLOAD_BYTES,
  LOCAL_MODEL_STORAGE_KEY,
  LOCAL_MODEL_URL,
  formatGigabytes
} from "../local-llm-config.js";
import {
  type LocalEngine,
  LocalModelController,
  type LocalModelEnv,
  type LocalModelState,
  type LocalRuntime,
  hasRoomFor,
  hasWebGpu
} from "../local-llm.js";

/** Laufzeit im Speicher statt WebLLM: kein Netz, keine GPU, keine echten Gewichte. */
function fakeRuntime(options: { cached?: boolean; failCreate?: boolean; tokens?: string[] } = {}) {
  let cached = options.cached ?? false;
  const calls = { create: 0, delete: 0, unload: 0 };
  const engine: LocalEngine = {
    async *stream(_messages, signal) {
      for (const token of options.tokens ?? ["Hallo", " Welt"]) {
        if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
        yield token;
      }
    },
    unload: async () => {
      calls.unload++;
    }
  };
  const runtime: LocalRuntime = {
    isModelCached: async () => cached,
    createEngine: async (onProgress) => {
      calls.create++;
      if (options.failCreate) throw new Error("Netz weg");
      onProgress({ progress: 0.5, text: "halb" });
      onProgress({ progress: 1.7, text: "fertig" });
      cached = true;
      return engine;
    },
    deleteModel: async () => {
      calls.delete++;
      cached = false;
    }
  };
  return { runtime, calls };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data
  };
}

const gpu = { requestAdapter: async () => ({}) };

function env(extra: Partial<LocalModelEnv> = {}): LocalModelEnv {
  return { gpu, localStorage: memoryStorage(), ...extra };
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const part of iter) out += part;
  return out;
}

describe("WebGPU und Speicher", () => {
  it("erkennt fehlendes WebGPU, fehlenden Adapter und Fehler beim Abfragen", async () => {
    expect(await hasWebGpu(undefined)).toBe(false);
    expect(await hasWebGpu({ requestAdapter: async () => null })).toBe(false);
    expect(
      await hasWebGpu({
        requestAdapter: async () => {
          throw new Error("blockiert");
        }
      })
    ).toBe(false);
    expect(await hasWebGpu(gpu)).toBe(true);
  });

  it("prüft den freien Speicher, ohne Schätzung entscheidet der Browser", async () => {
    expect(await hasRoomFor(undefined, 10)).toBe(true);
    expect(await hasRoomFor({}, 10)).toBe(true);
    expect(await hasRoomFor({ estimate: async () => ({}) }, 10)).toBe(true);
    expect(await hasRoomFor({ estimate: async () => ({ quota: 100 }) }, 10)).toBe(true);
    expect(await hasRoomFor({ estimate: async () => ({ quota: 100, usage: 95 }) }, 10)).toBe(false);
    expect(
      await hasRoomFor(
        {
          estimate: async () => {
            throw new Error("nicht erlaubt");
          }
        },
        10
      )
    ).toBe(true);
  });

  it("nennt die Größe in GB im Zahlenformat der Sprache und pinnt den Modellstand", () => {
    expect(formatGigabytes(LOCAL_MODEL_DOWNLOAD_BYTES, "de")).toBe("0,9");
    expect(formatGigabytes(LOCAL_MODEL_DOWNLOAD_BYTES, "en")).toBe("0.9");
    expect(LOCAL_MODEL_URL).toMatch(/\/resolve\/[0-9a-f]{40}\/$/);
  });
});

describe("LocalModelController", () => {
  it("ohne WebGPU: unsupported, kein Laden und keine Laufzeit", async () => {
    const loader = vi.fn(async () => fakeRuntime().runtime);
    const c = new LocalModelController(env({ gpu: undefined }), loader);
    expect(c.getState()).toEqual({ kind: "checking" });
    expect(await c.init()).toEqual({ kind: "unsupported" });
    expect(await c.load({ consented: true })).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(c.isAvailable()).toBe(false);
  });

  it("ohne frühere Zustimmung bleibt die Laufzeit ungeladen (nichts im Start-Bundle)", async () => {
    const loader = vi.fn(async () => fakeRuntime().runtime);
    const c = new LocalModelController(env(), loader);
    expect(await c.init()).toEqual({ kind: "absent" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("lädt nur mit Zustimmung, meldet Fortschritt und merkt sich das Modell", async () => {
    const { runtime, calls } = fakeRuntime();
    const storage = memoryStorage();
    const persist = vi.fn(async () => true);
    const c = new LocalModelController(
      env({ localStorage: storage, storage: { persist } }),
      async () => runtime
    );
    await c.init();
    const states: LocalModelState[] = [];
    const unsubscribe = c.subscribe((s) => states.push(s));
    await expect(c.load({ consented: false })).rejects.toThrow("Zustimmung fehlt");
    expect(calls.create).toBe(0);

    const engine = await c.load({ consented: true });
    expect(engine).not.toBeNull();
    expect(states).toEqual([
      { kind: "loading", progress: 0 },
      { kind: "loading", progress: 0.5 },
      { kind: "loading", progress: 1 },
      { kind: "ready" }
    ]);
    expect(persist).toHaveBeenCalled();
    expect(storage.data.get(LOCAL_MODEL_STORAGE_KEY)).toBe("1");
    expect(c.isAvailable()).toBe(true);
    // Zweiter Aufruf nutzt die geladene Engine
    expect(await c.load({ consented: true })).toBe(engine);
    expect(calls.create).toBe(1);
    unsubscribe();
  });

  it("gleichzeitige Ladeaufrufe starten nur einen Download", async () => {
    const { runtime, calls } = fakeRuntime();
    const c = new LocalModelController(env(), async () => runtime);
    await c.init();
    const [a, b] = await Promise.all([c.load({ consented: true }), c.load({ consented: true })]);
    expect(a).toBe(b);
    expect(calls.create).toBe(1);
  });

  it("aus dem Cache: Zustand cached, Chat lädt ohne neue Zustimmung, kein Speichertest", async () => {
    const { runtime } = fakeRuntime({ cached: true });
    const estimate = vi.fn(async () => ({ quota: 1, usage: 1 }));
    const c = new LocalModelController(
      env({
        localStorage: memoryStorage({ [LOCAL_MODEL_STORAGE_KEY]: "1" }),
        storage: { estimate }
      }),
      async () => runtime
    );
    expect(await c.init()).toEqual({ kind: "cached" });
    expect(c.isAvailable()).toBe(true);
    expect(await collect(c.stream([{ role: "user", content: "Hi" }]))).toBe("Hallo Welt");
    expect(estimate).not.toHaveBeenCalled();
    expect(c.getState()).toEqual({ kind: "ready" });
  });

  it("Merker ohne Cache-Inhalt wird gelöscht; Laufzeitfehler beim Prüfen gilt als absent", async () => {
    const storage = memoryStorage({ [LOCAL_MODEL_STORAGE_KEY]: "1" });
    const c = new LocalModelController(
      env({ localStorage: storage }),
      async () => fakeRuntime().runtime
    );
    expect(await c.init()).toEqual({ kind: "absent" });
    expect(storage.data.has(LOCAL_MODEL_STORAGE_KEY)).toBe(false);

    const broken = new LocalModelController(
      env({ localStorage: memoryStorage({ [LOCAL_MODEL_STORAGE_KEY]: "1" }) }),
      async () => {
        throw new Error("Chunk fehlt");
      }
    );
    expect(await broken.init()).toEqual({ kind: "absent" });
  });

  it("lädt nie stillschweigend: ohne Modell wirft stream()", async () => {
    const { runtime, calls } = fakeRuntime();
    const c = new LocalModelController(env(), async () => runtime);
    await c.init();
    await expect(collect(c.stream([{ role: "user", content: "x" }]))).rejects.toThrow(
      "nicht verfügbar"
    );
    expect(calls.create).toBe(0);
  });

  it("zu wenig Speicher: Fehler storage ohne Download", async () => {
    const { runtime, calls } = fakeRuntime();
    const c = new LocalModelController(
      env({ storage: { estimate: async () => ({ quota: 10, usage: 0 }) } }),
      async () => runtime
    );
    await c.init();
    expect(await c.load({ consented: true })).toBeNull();
    expect(c.getState()).toEqual({ kind: "error", reason: "storage" });
    expect(calls.create).toBe(0);
  });

  it("Downloadfehler und fehlende Laufzeit werden unterschieden", async () => {
    const failing = new LocalModelController(
      env(),
      async () => fakeRuntime({ failCreate: true }).runtime
    );
    await failing.init();
    expect(await failing.load({ consented: true })).toBeNull();
    expect(failing.getState()).toEqual({ kind: "error", reason: "load" });

    const noRuntime = new LocalModelController(env(), async () => {
      throw new Error("offline");
    });
    await noRuntime.init();
    expect(await noRuntime.load({ consented: true })).toBeNull();
    expect(noRuntime.getState()).toEqual({ kind: "error", reason: "runtime" });
  });

  it("persist darf fehlschlagen, ohne das Laden zu stören", async () => {
    const c = new LocalModelController(
      env({
        storage: {
          persist: async () => {
            throw new Error("abgelehnt");
          }
        }
      }),
      async () => fakeRuntime().runtime
    );
    await c.init();
    expect(await c.load({ consented: true })).not.toBeNull();
  });

  it("Entfernen räumt Engine, Cache und Merker; ohne WebGPU danach unsupported", async () => {
    const { runtime, calls } = fakeRuntime();
    const storage = memoryStorage();
    const c = new LocalModelController(env({ localStorage: storage }), async () => runtime);
    await c.init();
    await c.load({ consented: true });
    await c.remove();
    expect(calls).toEqual({ create: 1, delete: 1, unload: 1 });
    expect(storage.data.has(LOCAL_MODEL_STORAGE_KEY)).toBe(false);
    expect(c.getState()).toEqual({ kind: "absent" });

    const gpuGone = { requestAdapter: vi.fn(async (): Promise<unknown> => ({})) };
    const d = new LocalModelController(env({ gpu: gpuGone }), async () => runtime);
    await d.init();
    gpuGone.requestAdapter.mockResolvedValue(null);
    await d.remove();
    expect(d.getState()).toEqual({ kind: "unsupported" });
  });

  it("Entfernen klappt auch, wenn das Entladen der Engine scheitert", async () => {
    const { runtime, calls } = fakeRuntime();
    const c = new LocalModelController(env(), async () => ({
      ...runtime,
      createEngine: async (onProgress) => ({
        ...(await runtime.createEngine(onProgress)),
        unload: async () => {
          throw new Error("GPU verloren");
        }
      })
    }));
    await c.init();
    await c.load({ consented: true });
    await c.remove();
    expect(calls.delete).toBe(1);
    expect(c.getState()).toEqual({ kind: "absent" });
  });

  it("Entfernen meldet Fehler der Laufzeit weiter, setzt den Zustand aber zurück", async () => {
    const runtime: LocalRuntime = {
      ...fakeRuntime().runtime,
      deleteModel: async () => {
        throw new Error("Cache gesperrt");
      }
    };
    const c = new LocalModelController(env(), async () => runtime);
    await c.init();
    await expect(c.remove()).rejects.toThrow("Cache gesperrt");
    expect(c.getState()).toEqual({ kind: "absent" });
  });

  it("übersteht ein gesperrtes localStorage", async () => {
    const locked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      }
    };
    const c = new LocalModelController(
      env({ localStorage: locked }),
      async () => fakeRuntime().runtime
    );
    expect(await c.init()).toEqual({ kind: "absent" });
    expect(await c.load({ consented: true })).not.toBeNull();
    await c.remove();
    expect(c.getState()).toEqual({ kind: "absent" });
  });

  it("Abbruch während des Streams wird als AbortError weitergegeben", async () => {
    const c = new LocalModelController(env(), async () => fakeRuntime().runtime);
    await c.init();
    await c.load({ consented: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(c.stream([{ role: "user", content: "x" }], controller.signal))
    ).rejects.toThrow("Abgebrochen");
  });
});
