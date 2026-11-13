import {
  type ChatMessagesResponse,
  ChatRequestBodySchema,
  type GroundedChunkInput,
  type LlmProvider,
  type ProviderType,
  buildGroundedContext,
  createProblemDetails,
  validateAndCleanCitations
} from "@notebook-lm/shared";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AutoRouter } from "./auto-router.js";
import type { CoreRepository } from "./core-repository.js";
import { buildSafeFts5MatchQuery } from "./fts5-probe.js";
import { GeminiProvider } from "./gemini-provider.js";
import { type KeyVault, deserializeEncryptedPayload } from "./key-vault.js";
import { OllamaLocalProvider } from "./ollama-provider.js";
import type { RagRepository } from "./rag-repository.js";
import { queryNotebookVectorSearch } from "./search-routes.js";

export interface ChatRoutesDependencies {
  readonly ragRepo: RagRepository;
  readonly coreRepo?: CoreRepository | undefined;
  readonly autoRouter?: AutoRouter | undefined;
  readonly keyVault?: KeyVault | undefined;
  readonly defaultGeminiKey?: string | undefined;
  readonly ollamaBaseUrl?: string | undefined;
  /**
   * Liefert den eigenen OpenAI-kompatiblen Endpunkt des Nutzers (BYOM, Issue #247),
   * wenn der Chat mit `model: "custom"` angefragt wird.
   */
  readonly resolveCustomProvider?: ((userId: string) => Promise<LlmProvider | null>) | undefined;
}

export function registerChatRoutes(
  app: Hono<{
    Bindings: Env;
    Variables: { sessionUser?: { id: string } };
  }>,
  deps: ChatRoutesDependencies
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
      return {
        ok: false,
        status: 404,
        problem: createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
          instance: `/api/v1/notebooks/${notebookId}/chat`,
          code: "NOTEBOOK_NOT_FOUND"
        })
      };
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
      return {
        ok: false,
        status: 404,
        problem: createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
          instance: `/api/v1/notebooks/${notebookId}/chat`,
          code: "NOTEBOOK_NOT_FOUND"
        })
      };
    }
    return { ok: true, status: 200 };
  }

  /**
   * POST /api/v1/notebooks/:id/chat
   * SSE Streaming endpoint for grounded RAG chat with EU AI Act metadata.
   */
  app.post("/api/v1/notebooks/:id/chat", async (c) => {
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

    const parseResult = ChatRequestBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }));
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Content",
        detail: "Validierungsfehler bei der Chat-Anfrage.",
        instance: c.req.path,
        code: "VALIDATION_ERROR",
        errors
      });
      return c.json(problem, 422, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const {
      message,
      chatId: existingChatId,
      model: requestedModel,
      sourceIds,
      maxChunks
    } = parseResult.data;

    // 1. Resolve or create chat
    const now = Date.now();
    let chatId = existingChatId;
    if (chatId) {
      const existingChat = await deps.ragRepo.getChatById(chatId);
      if (!existingChat) {
        // If chat id does not exist, initialize it
        await deps.ragRepo.createChat({
          id: chatId,
          notebook_id: notebookId,
          user_id: sessionUser.id,
          title: message.slice(0, 40),
          model_used: requestedModel ?? "auto",
          created_at: now,
          updated_at: now
        });
      } else {
        await deps.ragRepo.updateChatTimestamp(chatId, now);
      }
    } else {
      chatId = `chat_${crypto.randomUUID()}`;
      await deps.ragRepo.createChat({
        id: chatId,
        notebook_id: notebookId,
        user_id: sessionUser.id,
        title: message.slice(0, 40),
        model_used: requestedModel ?? "auto",
        created_at: now,
        updated_at: now
      });
    }

    // 2. Persist user message
    const userMessageId = `msg_${crypto.randomUUID()}`;
    await deps.ragRepo.createMessage({
      id: userMessageId,
      chat_id: chatId,
      role: "user",
      content: message,
      citations_json: null,
      latency_ms: null,
      token_usage_json: null,
      ai_generated: 0,
      created_at: now
    });

    // 3. Retrieve relevant context chunks via Hybrid / FTS5 search
    const searchLimit = maxChunks;
    const matchQuery = buildSafeFts5MatchQuery(message);
    let ftsChunks: Array<{ id: string }> = [];
    if (matchQuery.length > 0) {
      ftsChunks = await deps.ragRepo.searchChunksFts(
        notebookId,
        matchQuery,
        searchLimit,
        sourceIds && sourceIds.length > 0 ? sourceIds : undefined
      );
    }

    // Attempt vector search if available
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
      chunks = fetchedChunks.slice(0, searchLimit).map((c) => ({
        chunkId: c.id,
        sourceId: c.source_id,
        sourceTitle: c.source_title || "Quelle",
        page: c.page_number,
        startOffset: c.start_offset,
        endOffset: c.end_offset,
        text: c.text
      }));
    }

    // 4. Build Grounded Context & System Prompt with Prompt Injection Neutralisation
    const grounded = buildGroundedContext(chunks);

    // 5. Select Provider and Model: own endpoint (BYOM) or AutoRouter
    let customProvider: LlmProvider | null = null;
    if (requestedModel === "custom") {
      try {
        customProvider = deps.resolveCustomProvider
          ? await deps.resolveCustomProvider(sessionUser.id)
          : null;
      } catch {
        customProvider = null;
      }
      if (!customProvider) {
        const problem = createProblemDetails({
          status: 503,
          title: "Service Unavailable",
          detail: "Kein eigener Endpunkt eingerichtet oder Schlüssel nicht lesbar.",
          instance: c.req.path,
          code: "CUSTOM_ENDPOINT_UNAVAILABLE"
        });
        return c.json(problem, 503, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    const routingDecision: { provider: string; model: string | undefined } = customProvider
      ? { provider: "custom", model: undefined }
      : routerInstance.route({
          preferredModel: requestedModel,
          task: "chat"
        });

    const provider = customProvider ?? routerInstance.getProvider(routingDecision.provider);
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

    // Load user's BYOK key if available in vault
    let apiKey: string | undefined;
    if (!customProvider && deps.keyVault && deps.ragRepo) {
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

    const startTime = Date.now();

    // 6. Return Server-Sent Events (SSE) Stream
    return streamSSE(c, async (stream) => {
      let fullAssistantText = "";

      try {
        const streamIterable = provider.chatStream(
          [
            { role: "system", content: grounded.systemPrompt },
            { role: "user", content: message }
          ],
          {
            model: routingDecision.model ?? "custom",
            apiKey
          }
        );

        for await (const chunk of streamIterable) {
          fullAssistantText += chunk.deltaText;
          await stream.writeSSE({
            event: "token",
            data: JSON.stringify({
              delta: chunk.deltaText,
              chatId
            })
          });
        }

        const latencyMs = Date.now() - startTime;

        // Sub-Issue #105: Validate citations & Hallucination validation
        const citationValidation = validateAndCleanCitations(
          fullAssistantText,
          grounded.sourceMap,
          {
            hallucinationAction: "remove"
          }
        );

        // SSE Event: citations
        await stream.writeSSE({
          event: "citations",
          data: JSON.stringify({
            chatId,
            citations: citationValidation.citations,
            validIndices: citationValidation.validIndices,
            hallucinatedIndices: citationValidation.hallucinatedIndices
          })
        });

        // SSE Event: metadata (EU AI Act Art. 50 Pflichtangaben)
        const aiActMetadata = {
          aiGenerated: true as const,
          provider: routingDecision.provider,
          model: routingDecision.model ?? "custom",
          timestamp: new Date().toISOString(),
          latencyMs
        };

        await stream.writeSSE({
          event: "metadata",
          data: JSON.stringify(aiActMetadata)
        });

        // SSE Event: done
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            chatId,
            messageId: `msg_${crypto.randomUUID()}`
          })
        });

        // 7. Persist assistant message in database
        const assistantMessageId = `msg_${crypto.randomUUID()}`;
        await deps.ragRepo.createMessage({
          id: assistantMessageId,
          chat_id: chatId,
          role: "assistant",
          content: fullAssistantText,
          citations_json: JSON.stringify(citationValidation.citations),
          latency_ms: latencyMs,
          token_usage_json: null,
          ai_generated: 1,
          created_at: Date.now()
        });
      } catch (err: unknown) {
        const errorMessage = (err as Error).message;
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: errorMessage,
            chatId
          })
        });
      }
    });
  });

  /**
   * GET /api/v1/chats/:id/messages
   * Returns conversation history with citations and EU AI Act metadata.
   */
  app.get("/api/v1/chats/:id/messages", async (c) => {
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

    const chatId = c.req.param("id");
    const chat = await deps.ragRepo.getChatById(chatId);
    if (!chat) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: `Chat '${chatId}' wurde nicht gefunden.`,
        instance: c.req.path,
        code: "CHAT_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Verify user access to chat or notebook
    if (chat.user_id !== sessionUser.id) {
      const access = await checkNotebookAccess(chat.notebook_id, sessionUser.id);
      if (!access.ok) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Chat '${chatId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "CHAT_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    const rawMessages = await deps.ragRepo.getMessagesByChat(chatId);

    const messages = rawMessages.map((m) => {
      let citations: Record<string, unknown>[] | null = null;
      if (m.citations_json) {
        try {
          citations = JSON.parse(m.citations_json);
        } catch {
          citations = null;
        }
      }

      let tokenUsage: Record<string, unknown> | null = null;
      if (m.token_usage_json) {
        try {
          tokenUsage = JSON.parse(m.token_usage_json);
        } catch {
          tokenUsage = null;
        }
      }

      return {
        id: m.id,
        chatId: m.chat_id,
        role: m.role,
        content: m.content,
        citations,
        latencyMs: m.latency_ms,
        tokenUsage,
        aiGenerated: m.ai_generated === 1,
        createdAt: m.created_at
      };
    });

    const responsePayload: ChatMessagesResponse = {
      chatId,
      messages
    };

    return c.json(responsePayload, 200, {
      "content-type": "application/json; charset=utf-8"
    });
  });
}
