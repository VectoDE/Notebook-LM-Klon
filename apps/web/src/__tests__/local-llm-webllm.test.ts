import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anbindung an WebLLM mit gemockter Bibliothek: In CI wird nie ein echtes Modell geladen.
 * Geprüft wird, dass Konfiguration, Fortschritt, Stream und Abbruch richtig übergeben werden.
 */
const mocks = vi.hoisted(() => {
  const state = {
    chunks: [] as unknown[],
    abortAfter: -1,
    interrupt: vi.fn(),
    unload: vi.fn(async () => undefined),
    create: vi.fn(),
    lastRequest: null as unknown,
    signalController: null as AbortController | null
  };
  return state;
});

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: vi.fn(
    async (
      _id: string,
      config: { initProgressCallback: (r: { progress: number; text: string }) => void }
    ) => {
      config.initProgressCallback({ progress: 0.25, text: "Lade Gewichte" });
      return {
        interruptGenerate: mocks.interrupt,
        unload: mocks.unload,
        chat: {
          completions: {
            create: async (request: unknown) => {
              mocks.lastRequest = request;
              return (async function* () {
                let i = 0;
                for (const chunk of mocks.chunks) {
                  if (i === mocks.abortAfter) mocks.signalController?.abort();
                  i++;
                  yield chunk;
                }
              })();
            }
          }
        }
      };
    }
  ),
  hasModelInCache: vi.fn(async () => true),
  deleteModelAllInfoInCache: vi.fn(async () => undefined)
}));

const webllm = await import("@mlc-ai/web-llm");
const { APP_CONFIG, MAX_ANSWER_TOKENS, webLlmRuntime } = await import("../local-llm-webllm.js");
const config = await import("../local-llm-config.js");

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const part of iter) out += part;
  return out;
}

beforeEach(() => {
  mocks.chunks = [];
  mocks.abortAfter = -1;
  mocks.signalController = null;
  mocks.interrupt.mockClear();
});

describe("WebLLM-Anbindung", () => {
  it("nutzt gepinnte Adressen, SRI und den Cache Storage", () => {
    const [record] = APP_CONFIG.model_list;
    expect(APP_CONFIG.cacheBackend).toBe("cache");
    expect(record?.model).toBe(config.LOCAL_MODEL_URL);
    expect(record?.model_lib).toBe(config.LOCAL_MODEL_LIB_URL);
    expect(record?.model_lib).toMatch(/binary-mlc-llm-libs\/[0-9a-f]{40}\//);
    expect(record?.integrity?.model_lib).toMatch(/^sha256-/);
    expect(record?.integrity?.config).toMatch(/^sha256-/);
    expect(record?.integrity?.tokenizer?.["tokenizer.json"]).toMatch(/^sha256-/);
    expect(record?.integrity?.onFailure).toBe("error");
    expect(record?.overrides?.context_window_size).toBe(4096);
  });

  it("prüft und löscht den Cache über WebLLM", async () => {
    expect(await webLlmRuntime.isModelCached()).toBe(true);
    expect(webllm.hasModelInCache).toHaveBeenCalledWith(config.LOCAL_MODEL_ID, APP_CONFIG);
    await webLlmRuntime.deleteModel();
    expect(webllm.deleteModelAllInfoInCache).toHaveBeenCalledWith(
      config.LOCAL_MODEL_ID,
      APP_CONFIG
    );
  });

  it("meldet Fortschritt und streamt nur Textanteile", async () => {
    const progress = vi.fn();
    const engine = await webLlmRuntime.createEngine(progress);
    expect(progress).toHaveBeenCalledWith({ progress: 0.25, text: "Lade Gewichte" });
    mocks.chunks = [
      { choices: [{ delta: { content: "Hallo" } }] },
      { choices: [{ delta: {} }] },
      { choices: [] },
      { choices: [{ delta: { content: " Welt" } }] }
    ];
    expect(await collect(engine.stream([{ role: "user", content: "Hi" }]))).toBe("Hallo Welt");
    expect(mocks.lastRequest).toEqual({
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
      temperature: 0.3,
      max_tokens: MAX_ANSWER_TOKENS
    });
    await engine.unload();
    expect(mocks.unload).toHaveBeenCalled();
  });

  it("Abbruch mitten im Stream unterbricht die Erzeugung", async () => {
    const engine = await webLlmRuntime.createEngine(() => undefined);
    mocks.chunks = [
      { choices: [{ delta: { content: "a" } }] },
      { choices: [{ delta: { content: "b" } }] }
    ];
    mocks.abortAfter = 1;
    mocks.signalController = new AbortController();
    await expect(
      collect(engine.stream([{ role: "user", content: "x" }], mocks.signalController.signal))
    ).rejects.toThrow("Abgebrochen");
    expect(mocks.interrupt).toHaveBeenCalled();
  });

  it("Abbruch nach dem letzten Teil zählt ebenfalls als Abbruch", async () => {
    const engine = await webLlmRuntime.createEngine(() => undefined);
    const controller = new AbortController();
    mocks.chunks = [];
    const iter = engine.stream([{ role: "user", content: "x" }], controller.signal);
    controller.abort();
    await expect(collect(iter)).rejects.toThrow("Abgebrochen");
  });
});
