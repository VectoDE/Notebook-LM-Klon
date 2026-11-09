import { describe, expect, it } from "vitest";
import { AutoRouter, KNOWN_MODELS_CATALOG } from "../auto-router.js";
import { GeminiProvider } from "../gemini-provider.js";
import { OllamaLocalProvider } from "../ollama-provider.js";

describe("AutoRouter (Issue #103)", () => {
  it("initializes with catalog and default routing rules", () => {
    const router = new AutoRouter();
    expect(KNOWN_MODELS_CATALOG.length).toBeGreaterThan(0);
    expect(router.getCatalog()).toHaveLength(4);
  });

  it("routes to Ollama in privacy mode (Air-Gapped)", () => {
    const router = new AutoRouter();
    const chatDecision = router.route({ privacyMode: true });
    expect(chatDecision.provider).toBe("ollama");
    expect(chatDecision.model).toBe("llama3");
    expect(chatDecision.isLocal).toBe(true);
    expect(chatDecision.trainingPolicy).toBe("air-gapped-local");
    expect(chatDecision.reasoning).toContain("Datenschutz-Modus aktiv");

    const embedDecision = router.route({ forceLocal: true, task: "embedding" });
    expect(embedDecision.provider).toBe("ollama");
    expect(embedDecision.model).toBe("nomic-embed-text");
  });

  it("routes to Gemini for TTS audio task", () => {
    const router = new AutoRouter();
    const decision = router.route({ task: "tts" });
    expect(decision.provider).toBe("google");
    expect(decision.model).toBe("gemini-2.5-flash");
    expect(decision.reasoning).toContain("Audio/TTS");
  });

  it("routes to Gemini 2.5 Pro for massive context windows (> 1M tokens)", () => {
    const router = new AutoRouter();
    const decisionPro = router.route({ estimatedTokens: 1_200_000 });
    expect(decisionPro.provider).toBe("google");
    expect(decisionPro.model).toBe("gemini-2.5-pro");
    expect(decisionPro.reasoning).toContain("Grosses Kontextfenster");

    const decisionFlash = router.route({ estimatedTokens: 200_000 });
    expect(decisionFlash.provider).toBe("google");
    expect(decisionFlash.model).toBe("gemini-2.5-flash");
  });

  it("routes coding task to Claude or OpenAI if BYOK key is available", () => {
    const router = new AutoRouter();

    // Anthropic available
    const decisionClaude = router.route({
      task: "coding",
      availableKeys: ["google", "anthropic"]
    });
    expect(decisionClaude.provider).toBe("anthropic");
    expect(decisionClaude.model).toBe("claude-3-7-sonnet");
    expect(decisionClaude.trainingPolicy).toBe("zero-retention");

    // Only OpenAI available
    const decisionOpenAI = router.route({
      task: "coding",
      availableKeys: ["google", "openai"]
    });
    expect(decisionOpenAI.provider).toBe("openai");
    expect(decisionOpenAI.model).toBe("gpt-4o");

    // Neither available -> fallback to default
    const decisionDefault = router.route({
      task: "coding",
      availableKeys: ["google"]
    });
    expect(decisionDefault.provider).toBe("google");
    expect(decisionDefault.model).toBe("gemini-2.5-flash");

    // Unknown preferredModel falls through to standard default
    const decisionUnknown = router.route({ preferredModel: "non-existent-model" });
    expect(decisionUnknown.provider).toBe("google");
    expect(decisionUnknown.model).toBe("gemini-2.5-flash");

    // Standard embedding fallback
    const decisionEmbedDefault = router.route({ task: "embedding" });
    expect(decisionEmbedDefault.provider).toBe("google");
    expect(decisionEmbedDefault.model).toBe("gemini-embedding-001");
  });

  it("respects explicit preferredModel if in catalog", () => {
    const router = new AutoRouter();
    const decision = router.route({ preferredModel: "claude-3-7-sonnet" });
    expect(decision.provider).toBe("anthropic");
    expect(decision.model).toBe("claude-3-7-sonnet");
    expect(decision.reasoning).toContain("Explizite Modell-Praeferenz");
  });

  it("provides fallback provider according to fallback chain", () => {
    const router = new AutoRouter();
    const gemini = new GeminiProvider({ apiKey: "AIzaDummy" });
    const ollama = new OllamaLocalProvider();

    router.registerProvider(gemini);
    router.registerProvider(ollama);

    expect(router.getProvider("google")).toBe(gemini);
    expect(router.getProvider("ollama")).toBe(ollama);

    // Fallback from google -> openai/anthropic not registered -> ollama
    const fallback = router.getFallbackProvider("google");
    expect(fallback).toBe(ollama);

    // No fallback from unknown or end of chain
    expect(router.getFallbackProvider("ollama")).toBeUndefined();
    expect(router.getFallbackProvider("unknown-provider")).toBeUndefined();
  });
});
