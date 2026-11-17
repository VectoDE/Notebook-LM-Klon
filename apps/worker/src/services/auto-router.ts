import type {
  LlmProvider,
  ModelCapability,
  ProviderCatalogEntry,
  RouteModelDecision,
  RouteModelRequest
} from "@notebook-lm/shared";

export const KNOWN_MODELS_CATALOG: readonly ModelCapability[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    contextWindow: 1_048_576,
    supportsStreaming: true,
    supportsEmbedding: false,
    supportsJson: true,
    supportsVision: true,
    supportsAudio: true,
    isLocal: false,
    trainingPolicy: "free-tier-trained"
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    contextWindow: 2_097_152,
    supportsStreaming: true,
    supportsEmbedding: false,
    supportsJson: true,
    supportsVision: true,
    supportsAudio: true,
    isLocal: false,
    trainingPolicy: "free-tier-trained"
  },
  {
    id: "gemini-embedding-001",
    name: "Gemini Embedding 001",
    provider: "google",
    contextWindow: 2048,
    supportsStreaming: false,
    supportsEmbedding: true,
    supportsJson: false,
    supportsVision: false,
    supportsAudio: false,
    isLocal: false,
    trainingPolicy: "free-tier-trained",
    defaultEmbeddingDimensions: 768
  },
  {
    id: "llama3",
    name: "Ollama Llama 3 (8B / 70B)",
    provider: "ollama",
    contextWindow: 8192,
    supportsStreaming: true,
    supportsEmbedding: false,
    supportsJson: true,
    supportsVision: false,
    supportsAudio: false,
    isLocal: true,
    trainingPolicy: "air-gapped-local"
  },
  {
    id: "nomic-embed-text",
    name: "Ollama Nomic Embed Text",
    provider: "ollama",
    contextWindow: 2048,
    supportsStreaming: false,
    supportsEmbedding: true,
    supportsJson: false,
    supportsVision: false,
    supportsAudio: false,
    isLocal: true,
    trainingPolicy: "air-gapped-local",
    defaultEmbeddingDimensions: 768
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsEmbedding: false,
    supportsJson: true,
    supportsVision: true,
    supportsAudio: false,
    isLocal: false,
    trainingPolicy: "zero-retention"
  },
  {
    id: "gpt-4o",
    name: "OpenAI GPT-4o",
    provider: "openai",
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsEmbedding: false,
    supportsJson: true,
    supportsVision: true,
    supportsAudio: false,
    isLocal: false,
    trainingPolicy: "zero-retention"
  }
];

export interface AutoRouterConfig {
  readonly providers?: Map<string, LlmProvider>;
  readonly fallbackOrder?: readonly string[];
}

/**
 * RelationFlow 'Auto' model router (Decision #40, Issue #19, #103).
 * Transparent rule-based selection:
 * 1. Privacy Mode / Force Local -> Ollama (Air-Gapped, zero retention)
 * 2. Multi-speaker Audio / TTS -> Google Gemini (Native Audio)
 * 3. Large Context Window (> 128k tokens) -> Gemini 2.5 Pro / Flash
 * 4. Analytical Coding -> Claude 3.7 Sonnet (if BYOK available)
 * 5. General / Default -> Gemini (BYOK or demo) -> Fallback chain
 */
export class AutoRouter {
  private readonly providers: Map<string, LlmProvider>;
  private readonly fallbackOrder: readonly string[];

  constructor(config: AutoRouterConfig = {}) {
    this.providers = config.providers ?? new Map();
    this.fallbackOrder = config.fallbackOrder ?? ["google", "openai", "anthropic", "ollama"];
  }

  registerProvider(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  route(req: RouteModelRequest): RouteModelDecision {
    const available = new Set(req.availableKeys ?? ["google"]);

    // 1. Privacy / Local constraint
    if (req.privacyMode || req.forceLocal) {
      return {
        provider: "ollama",
        model: req.task === "embedding" ? "nomic-embed-text" : "llama3",
        reasoning:
          "Datenschutz-Modus aktiv: Air-Gapped Ausfuehrung ohne Drittlandtransfer und ohne Cloud-Datenspeicherung.",
        isLocal: true,
        trainingPolicy: "air-gapped-local"
      };
    }

    // 2. Audio / TTS Task
    if (req.task === "tts") {
      return {
        provider: "google",
        model: "gemini-2.5-flash",
        reasoning:
          "Audio/TTS Synthese: Google Gemini besitzt native Audio- und Sprecherfaehigkeit.",
        isLocal: false,
        trainingPolicy: "free-tier-trained"
      };
    }

    // 3. Huge Context (> 128k tokens)
    if (req.estimatedTokens && req.estimatedTokens > 128_000) {
      const model = req.estimatedTokens > 1_000_000 ? "gemini-2.5-pro" : "gemini-2.5-flash";
      return {
        provider: "google",
        model,
        reasoning: `Grosses Kontextfenster (~${req.estimatedTokens} Tokens): Gemini bietet bis zu 2M Kontextlaenge.`,
        isLocal: false,
        trainingPolicy: "free-tier-trained"
      };
    }

    // 4. Analytical Coding / Architecture Review
    if (req.task === "coding" && available.has("anthropic")) {
      return {
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        reasoning: "Analytisches Coding / Struktur-Review: Anthropic Claude via BYOK-Key.",
        isLocal: false,
        trainingPolicy: "zero-retention"
      };
    }

    // 5. OpenAI available for coding or general preference
    if (req.task === "coding" && available.has("openai")) {
      return {
        provider: "openai",
        model: "gpt-4o",
        reasoning: "Coding-Aufgabe: OpenAI GPT-4o via BYOK-Key gewaehlt.",
        isLocal: false,
        trainingPolicy: "zero-retention"
      };
    }

    // 6. Preferred model requested
    if (req.preferredModel) {
      const found = KNOWN_MODELS_CATALOG.find((m) => m.id === req.preferredModel);
      if (found) {
        return {
          provider: found.provider,
          model: found.id,
          reasoning: `Explizite Modell-Praeferenz '${found.name}' uebernommen.`,
          isLocal: found.isLocal,
          trainingPolicy: found.trainingPolicy
        };
      }
    }

    // 7. Standard default
    return {
      provider: "google",
      model: req.task === "embedding" ? "gemini-embedding-001" : "gemini-2.5-flash",
      reasoning: "Standard-Modell: Schnelle Latenz und hohe Qualitaet mit Gemini 2.5 Flash.",
      isLocal: false,
      trainingPolicy: "free-tier-trained"
    };
  }

  getFallbackProvider(failedProviderId: string): LlmProvider | undefined {
    const idx = this.fallbackOrder.indexOf(failedProviderId);
    if (idx === -1) return undefined;

    for (let i = idx + 1; i < this.fallbackOrder.length; i++) {
      const candidateId = this.fallbackOrder[i];
      if (candidateId && this.providers.has(candidateId)) {
        return this.providers.get(candidateId);
      }
    }
    return undefined;
  }

  getCatalog(configuredProviderIds: readonly string[] = ["google"]): ProviderCatalogEntry[] {
    const configuredSet = new Set(configuredProviderIds);
    const providers: ProviderCatalogEntry[] = [
      {
        id: "google",
        name: "Google Gemini",
        isLocal: false,
        trainingPolicy: "free-tier-trained",
        configured: configuredSet.has("google"),
        models: KNOWN_MODELS_CATALOG.filter((m) => m.provider === "google")
      },
      {
        id: "ollama",
        name: "Ollama (Lokal / Air-Gapped)",
        isLocal: true,
        trainingPolicy: "air-gapped-local",
        configured: configuredSet.has("ollama") || true, // local ollama is always probe-able
        models: KNOWN_MODELS_CATALOG.filter((m) => m.provider === "ollama")
      },
      {
        id: "anthropic",
        name: "Anthropic Claude",
        isLocal: false,
        trainingPolicy: "zero-retention",
        configured: configuredSet.has("anthropic"),
        models: KNOWN_MODELS_CATALOG.filter((m) => m.provider === "anthropic")
      },
      {
        id: "openai",
        name: "OpenAI",
        isLocal: false,
        trainingPolicy: "zero-retention",
        configured: configuredSet.has("openai"),
        models: KNOWN_MODELS_CATALOG.filter((m) => m.provider === "openai")
      }
    ];

    return providers;
  }
}
