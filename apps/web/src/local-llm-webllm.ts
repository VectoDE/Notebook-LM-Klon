import {
  type AppConfig,
  CreateMLCEngine,
  type MLCEngineInterface,
  deleteModelAllInfoInCache,
  hasModelInCache
} from "@mlc-ai/web-llm";
import {
  LOCAL_MODEL_CONTEXT_TOKENS,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_INTEGRITY,
  LOCAL_MODEL_LIB_URL,
  LOCAL_MODEL_URL,
  LOCAL_MODEL_VRAM_MB
} from "./local-llm-config.js";
import type { LocalEngine, LocalRuntime } from "./local-llm.js";

/**
 * WebLLM-Anbindung (Issue #346). Dieses Modul wird nur per import() geladen und landet so in
 * einem eigenen Chunk außerhalb des Start-Bundles. Gewichte speichert WebLLM im Cache Storage
 * des Browsers (Standard-Backend "cache") und lädt sie beim nächsten Mal von dort.
 */

export const APP_CONFIG: AppConfig = {
  cacheBackend: "cache",
  model_list: [
    {
      model: LOCAL_MODEL_URL,
      model_id: LOCAL_MODEL_ID,
      model_lib: LOCAL_MODEL_LIB_URL,
      vram_required_MB: LOCAL_MODEL_VRAM_MB,
      low_resource_required: true,
      overrides: { context_window_size: LOCAL_MODEL_CONTEXT_TOKENS },
      integrity: {
        ...LOCAL_MODEL_INTEGRITY,
        tokenizer: { ...LOCAL_MODEL_INTEGRITY.tokenizer }
      }
    }
  ]
};

/** Höchstzahl erzeugter Token je Antwort; hält die Antwortzeit auf schwacher Hardware im Rahmen. */
export const MAX_ANSWER_TOKENS = 768;

function wrap(engine: MLCEngineInterface): LocalEngine {
  return {
    async *stream(messages, signal) {
      const onAbort = () => engine.interruptGenerate();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const chunks = await engine.chat.completions.create({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
          temperature: 0.3,
          max_tokens: MAX_ANSWER_TOKENS
        });
        for await (const chunk of chunks) {
          if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        }
        if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    unload: () => engine.unload()
  };
}

export const webLlmRuntime: LocalRuntime = {
  isModelCached: () => hasModelInCache(LOCAL_MODEL_ID, APP_CONFIG),
  async createEngine(onProgress) {
    const engine = await CreateMLCEngine(LOCAL_MODEL_ID, {
      appConfig: APP_CONFIG,
      initProgressCallback: (report) => onProgress({ progress: report.progress, text: report.text })
    });
    return wrap(engine);
  },
  deleteModel: () => deleteModelAllInfoInCache(LOCAL_MODEL_ID, APP_CONFIG)
};

export default webLlmRuntime;
