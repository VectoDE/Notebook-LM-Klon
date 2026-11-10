import {
  AudioInterjectRequestSchema,
  AudioInterjectResponseSchema,
  type GroundedChunkInput,
  type ProviderType,
  buildAudioInterjectPrompt,
  buildGroundedContext,
  createProblemDetails,
  parseAudioHostTurns,
  validateAndCleanCitations
} from "@notebook-lm/shared";
import type { Hono } from "hono";
import { AutoRouter } from "./auto-router.js";
import type { CoreRepository } from "./core-repository.js";
import { buildSafeFts5MatchQuery } from "./fts5-probe.js";
import { GeminiProvider } from "./gemini-provider.js";
import { type KeyVault, deserializeEncryptedPayload } from "./key-vault.js";
import { OllamaLocalProvider } from "./ollama-provider.js";
import type { RagRepository } from "./rag-repository.js";
import { queryNotebookVectorSearch } from "./search-routes.js";

export interface AudioRoutesDependencies {
  readonly ragRepo: RagRepository;
  readonly coreRepo?: CoreRepository | undefined;
  readonly autoRouter?: AutoRouter | undefined;
  readonly keyVault?: KeyVault | undefined;
  readonly defaultGeminiKey?: string | undefined;
  readonly ollamaBaseUrl?: string | undefined;
}

export function registerAudioRoutes(
  app: Hono<{
    Bindings: Env;
    Variables: { sessionUser?: { id: string } };
  }>,
  deps: AudioRoutesDependencies
): void {
  const routerInstance = deps.autoRouter ?? new AutoRouter();

  // Ensure default providers are registered in router if not already present
  if (!routerInstance.getProvider("google")) {
    routerInstance.registerProvider(
      new GeminiProvider(deps.defaultGeminiKey ? { apiKey: deps.defaultGeminiKey } : {})
    );
  }
  if (!routerInstance.getProvider("ollama")) {
    routerInstance.registerProvider(
      new OllamaLocalProvider(deps.ollamaBaseUrl ? { baseUrl: deps.ollamaBaseUrl } : {})
    );
  }

  /**
   * Helper to verify notebook access.
   */
  async function checkNotebookAccess(
    notebookId: string,
    userId: string
  ): Promise<{ ok: boolean; status: number; problem?: ReturnType<typeof createProblemDetails> }> {
    if (!deps.coreRepo) {
      return { ok: true, status: 200 };
    }

    const notebook = await deps.coreRepo.getNotebookById(notebookId);
    if (!notebook) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
        instance: `/api/v1/notebooks/${notebookId}/audio-interject`,
        code: "NOTEBOOK_NOT_FOUND"
      });
      return { ok: false, status: 404, problem };
    }

    let userRole = await deps.coreRepo.getWorkspaceMemberRole(notebook.workspace_id, userId);
    if (!userRole) {
      const shares = await deps.coreRepo.db.query<{ role: "editor" | "viewer" }>(
        "SELECT role FROM notebook_shares WHERE notebook_id = ? AND user_id = ?",
        [notebookId, userId]
      );
      if (shares.length > 0 && shares[0]) {
        userRole = shares[0].role;
      }
    }

    if (!userRole) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: `Notebook '${notebookId}' wurde nicht gefunden oder Zugriff verweigert.`,
        instance: `/api/v1/notebooks/${notebookId}/audio-interject`,
        code: "NOTEBOOK_NOT_FOUND"
      });
      return { ok: false, status: 404, problem };
    }

    return { ok: true, status: 200 };
  }

  /**
   * POST /api/v1/notebooks/:id/audio-interject
   * Contextual host response endpoint during active audio podcast playback.
   */
  app.post("/api/v1/notebooks/:id/audio-interject", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Authentifizierung erforderlich.",
        instance: c.req.path,
        code: "UNAUTHORIZED"
      });
      return c.json(problem, 401, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const notebookId = c.req.param("id");
    const access = await checkNotebookAccess(notebookId, sessionUser.id);
    if (!access.ok && access.problem) {
      return c.json(access.problem, access.status as 401 | 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "Ungültiges JSON im Request-Body.",
        instance: c.req.path,
        code: "INVALID_JSON"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const parseResult = AudioInterjectRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }));
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Content",
        detail: "Validierungsfehler bei der Interject-Anfrage.",
        instance: c.req.path,
        code: "VALIDATION_ERROR",
        errors
      });
      return c.json(problem, 422, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const {
      userQuestion,
      currentTimeMs,
      podcastContext,
      sourceIds,
      voiceMode,
      host1Name,
      host2Name
    } = parseResult.data;

    // 1. Retrieve grounded context chunks via Hybrid (FTS5 + Vector) search
    const searchLimit = 6;
    const matchQuery = buildSafeFts5MatchQuery(userQuestion);
    let ftsChunks: Array<{ id: string }> = [];
    if (matchQuery.length > 0) {
      ftsChunks = await deps.ragRepo.searchChunksFts(
        notebookId,
        matchQuery,
        searchLimit,
        sourceIds && sourceIds.length > 0 ? sourceIds : undefined
      );
    }

    let vectorItems: { chunkId: string }[] = [];
    try {
      vectorItems = await queryNotebookVectorSearch(
        c.env,
        deps.ragRepo,
        notebookId,
        sourceIds && sourceIds.length > 0
          ? { limit: searchLimit, sourceIds }
          : { limit: searchLimit }
      );
    } catch {
      // Vector search optional
    }

    const candidateChunkIds = new Set<string>();
    for (const f of ftsChunks) {
      candidateChunkIds.add(f.id);
    }
    for (const v of vectorItems) {
      candidateChunkIds.add(v.chunkId);
    }

    let chunks: GroundedChunkInput[] = [];
    if (candidateChunkIds.size > 0) {
      const fetchedChunks = await deps.ragRepo.getChunksByIds(Array.from(candidateChunkIds));
      chunks = fetchedChunks.slice(0, searchLimit).map((item) => ({
        chunkId: item.id,
        sourceId: item.source_id,
        sourceTitle: item.source_title || "Quelle",
        page: item.page_number,
        startOffset: item.start_offset,
        endOffset: item.end_offset,
        text: item.text
      }));
    }

    const grounded = buildGroundedContext(chunks);

    // 2. Select Provider via AutoRouter for audio/synthesis task
    const routingDecision = routerInstance.route({
      task: "tts"
    });

    const provider = routerInstance.getProvider(routingDecision.provider);
    if (!provider) {
      const problem = createProblemDetails({
        status: 503,
        title: "Service Unavailable",
        detail: `Kein aktiver LLM-Provider für '${routingDecision.provider}' verfügbar.`,
        instance: c.req.path,
        code: "PROVIDER_UNAVAILABLE"
      });
      return c.json(problem, 503, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Load BYOK key if available
    let apiKey: string | undefined;
    if (deps.keyVault && deps.ragRepo) {
      try {
        const storedKey = await deps.ragRepo.getProviderKey(
          sessionUser.id,
          routingDecision.provider as ProviderType
        );
        if (storedKey) {
          const payload = deserializeEncryptedPayload(storedKey.encrypted_key);
          apiKey = await deps.keyVault.decrypt(payload, {
            userId: sessionUser.id,
            provider: routingDecision.provider as ProviderType
          });
        }
      } catch {
        // Fall back to default provider API key
      }
    }

    // 3. Build two-speaker interject prompt
    const prompt = buildAudioInterjectPrompt({
      userQuestion,
      currentTimeMs,
      podcastContext,
      groundedXml: grounded.contextSourcesXml,
      host1Name,
      host2Name,
      voiceMode
    });

    const startTime = Date.now();
    let rawHostText = "";

    try {
      const streamIterable = provider.chatStream(
        [
          { role: "system", content: grounded.systemPrompt },
          { role: "user", content: prompt }
        ],
        {
          model: routingDecision.model,
          apiKey
        }
      );

      for await (const chunk of streamIterable) {
        rawHostText += chunk.deltaText;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const problem = createProblemDetails({
        status: 502,
        title: "Bad Gateway",
        detail: `LLM-Generierung für Host-Antwort fehlgeschlagen: ${message}`,
        instance: c.req.path,
        code: "LLM_GENERATION_FAILED"
      });
      return c.json(problem, 502, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const latencyMs = Date.now() - startTime;

    // 4. Validate citations and parse dialogue turns
    const citationCleaned = validateAndCleanCitations(rawHostText, grounded.sources, {
      hallucinationAction: "remove"
    });

    const turns = parseAudioHostTurns(citationCleaned.cleanedText, host1Name, host2Name);

    // Map extracted citations
    const citations = citationCleaned.citations.map((item) => ({
      index: item.index,
      chunkId: item.chunkId,
      sourceId: item.sourceId,
      sourceTitle: item.sourceTitle,
      page: item.page,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      quote: item.quote
    }));

    // Generate speech synthesis cues for each turn
    const speechCues = turns.map((turn) => ({
      speaker: turn.speaker,
      speakerName: turn.speakerName,
      text: turn.text,
      voiceName:
        turn.speaker === "host1"
          ? "de-DE-Neural2-F" // Female voice for Host 1
          : "de-DE-Neural2-B", // Male voice for Host 2
      rate: 1.0
    }));

    // Estimate duration: approx 150 words per minute -> 2.5 words per second
    const totalWords = citationCleaned.cleanedText.split(/\s+/).filter(Boolean).length;
    const estimatedDurationMs = Math.max(3000, Math.round((totalWords / 2.5) * 1000));

    const responsePayload = AudioInterjectResponseSchema.parse({
      notebookId,
      question: userQuestion,
      currentTimeMs,
      turns,
      fullAnswer: citationCleaned.cleanedText,
      citations,
      speechSynthesis: {
        mode: voiceMode,
        estimatedDurationMs,
        cues: speechCues
      },
      aiMetadata: {
        aiGenerated: true,
        provider: routingDecision.provider,
        model: routingDecision.model,
        latencyMs,
        timestamp: new Date().toISOString()
      }
    });

    return c.json(responsePayload, 200, {
      "content-type": "application/json; charset=utf-8"
    });
  });
}
