import {
  type ChunkRow,
  type SearchCitation,
  SearchQueryBodySchema,
  type SearchResponse,
  combineWithRrf,
  createProblemDetails,
  quantizeFloat32ToInt8
} from "@notebook-lm/shared";
import type { Hono } from "hono";
import type { CoreRepository } from "./core-repository.js";
import { buildSafeFts5MatchQuery } from "./fts5-probe.js";
import type { RagRepository } from "./rag-repository.js";

export interface SearchRoutesDependencies {
  readonly ragRepo: RagRepository;
  readonly coreRepo?: CoreRepository | undefined;
}

export interface VectorSearchResultItem {
  chunkId: string;
  sourceId?: string | undefined;
  score: number;
}

/**
 * Executes in-memory vector search against NotebookDO (or in-process fallback if DO not available).
 */
export async function queryNotebookVectorSearch(
  env: Env | undefined,
  ragRepo: RagRepository,
  notebookId: string,
  options: {
    queryVector?: number[];
    quantized?: number[];
    scale?: number;
    limit?: number;
    sourceIds?: string[];
  }
): Promise<VectorSearchResultItem[]> {
  const limit = options.limit ?? 10;

  // 1. If NotebookDO binding is available, call the DO's /vectors/search endpoint
  if (env?.NOTEBOOK_DO) {
    try {
      const doId = env.NOTEBOOK_DO.idFromName(notebookId);
      const doStub = env.NOTEBOOK_DO.get(doId);

      const res = await doStub.fetch("http://internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options)
      });

      if (res.ok) {
        const data = (await res.json()) as { results?: VectorSearchResultItem[] };
        return Array.isArray(data.results) ? data.results : [];
      }
    } catch {
      // Fall through to database fallback if DO call fails
    }
  }

  // 2. Fallback for Node.js / offline / direct database query
  // Load vectors directly from D1 / DatabaseSync
  const chunkVectors = await ragRepo.getChunkVectorsByNotebook(notebookId);
  if (chunkVectors.length === 0) {
    return [];
  }

  let qQuantized: Int8Array;
  let qScale: number;

  if (options.quantized && options.scale !== undefined) {
    qQuantized = new Int8Array(options.quantized);
    qScale = options.scale;
  } else if (options.queryVector && options.queryVector.length > 0) {
    const qRes = quantizeFloat32ToInt8(new Float32Array(options.queryVector));
    qQuantized = qRes.quantized;
    qScale = qRes.scale;
  } else {
    return [];
  }

  const allowedSources =
    options.sourceIds && options.sourceIds.length > 0 ? new Set(options.sourceIds) : null;

  // Get chunks to check source_id if filtering by sources
  let chunkSourceMap: Map<string, string> | null = null;
  if (allowedSources) {
    const chunks = await ragRepo.getChunksByIds(chunkVectors.map((cv) => cv.chunk_id));
    chunkSourceMap = new Map(chunks.map((c) => [c.id, c.source_id]));
  }

  const scored: VectorSearchResultItem[] = [];

  for (const cv of chunkVectors) {
    const sourceId = chunkSourceMap ? chunkSourceMap.get(cv.chunk_id) : undefined;
    if (allowedSources && (!sourceId || !allowedSources.has(sourceId))) {
      continue;
    }

    const rawBytes = new Uint8Array(
      cv.vector instanceof Uint8Array ? cv.vector.buffer : cv.vector,
      cv.vector instanceof Uint8Array ? cv.vector.byteOffset : 0,
      cv.vector instanceof Uint8Array ? cv.vector.byteLength : (cv.vector as ArrayBuffer).byteLength
    );

    const docQuantized = new Int8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const len = Math.min(qQuantized.length, docQuantized.length);
    let dot = 0;
    for (let i = 0; i < len; i++) {
      dot += Number(qQuantized[i]) * Number(docQuantized[i]);
    }
    const score = dot * qScale * cv.scale;

    scored.push({
      chunkId: cv.chunk_id,
      sourceId,
      score
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Creates structured search citations from raw chunks and rank scores.
 */
function createSnippet(text: string, maxLen = 300): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen).trim()}...`;
}

/**
 * Registers the standalone RAG & Hybrid Search API:
 * POST /api/v1/notebooks/:id/search
 */
export function registerSearchRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: SearchRoutesDependencies
): void {
  const { ragRepo, coreRepo } = deps;

  app.post("/api/v1/notebooks/:id/search", async (c) => {
    const startTime = performance.now();
    const notebookId = c.req.param("id");
    const sessionUser = c.get("sessionUser");

    // 1. Authentication Check
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

    // 2. Authorization / Notebook Existence Check (IDOR protection)
    if (coreRepo) {
      const notebook = await coreRepo.getNotebookById(notebookId);
      if (!notebook) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "NOTEBOOK_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }

      let userRole = await coreRepo.getWorkspaceMemberRole(notebook.workspace_id, sessionUser.id);
      if (!userRole) {
        const shares = await coreRepo.db.query<{ role: "editor" | "viewer" }>(
          "SELECT role FROM notebook_shares WHERE notebook_id = ? AND user_id = ?",
          [notebookId, sessionUser.id]
        );
        if (shares.length > 0 && shares[0]) {
          userRole = shares[0].role;
        }
      }

      if (!userRole) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "NOTEBOOK_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    // 3. Body Validation
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

    const parseResult = SearchQueryBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }));
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Content",
        detail: "Validierungsfehler bei den Suchparametern.",
        instance: c.req.path,
        code: "VALIDATION_ERROR",
        errors
      });
      return c.json(problem, 422, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const { query, queryVector, limit, sourceIds, mode } = parseResult.data;

    // 4. Mode-Dependent Search Execution
    // Prepare candidate chunk lookups
    let vectorResults: VectorSearchResultItem[] = [];
    let ftsResults: Array<ChunkRow & { rank: number; source_title?: string }> = [];

    // Semantic Vector Search (if mode is 'hybrid' or 'vector')
    if ((mode === "hybrid" || mode === "vector") && queryVector && queryVector.length > 0) {
      vectorResults = await queryNotebookVectorSearch(c.env, ragRepo, notebookId, {
        queryVector,
        limit: limit * 2, // oversample for RRF fusion
        ...(sourceIds ? { sourceIds } : {})
      });
    }

    // Lexical FTS5 Search (if mode is 'hybrid' or 'fts', or vector fallback)
    if (mode === "hybrid" || mode === "fts" || (mode === "vector" && vectorResults.length === 0)) {
      const matchQuery = buildSafeFts5MatchQuery(query);
      if (matchQuery.length > 0) {
        try {
          ftsResults = await ragRepo.searchChunksFts(notebookId, matchQuery, limit * 2, sourceIds);
        } catch {
          // FTS match syntax or table error handled safely
          ftsResults = [];
        }
      }
    }

    // 5. Ranking & Combination (RRF if hybrid, or direct slice)
    const finalCitations: SearchCitation[] = [];

    if (mode === "hybrid" && vectorResults.length > 0 && ftsResults.length > 0) {
      // Reciprocal Rank Fusion combiner (k = 60)
      interface CandidateItem {
        readonly chunkId: string;
        readonly score: number;
      }

      const list1: CandidateItem[] = vectorResults.map((v) => ({
        chunkId: v.chunkId,
        score: v.score
      }));
      const list2: CandidateItem[] = ftsResults.map((f) => ({
        chunkId: f.id,
        score: f.rank
      }));

      const rrfCombined = combineWithRrf<CandidateItem, string>(
        list1,
        list2,
        (item) => item.chunkId,
        {
          k: 60,
          weight1: 1.0,
          weight2: 1.0,
          getScore1: (c) => c.score,
          getScore2: (c) => c.score
        }
      );

      // Collect IDs to hydrate chunk details
      const topRrf = rrfCombined.slice(0, limit);
      const chunkIdsToFetch = topRrf.map((r) => r.item.chunkId);

      // Map chunk details from ftsResults first, or fetch from DB
      const ftsMap = new Map(ftsResults.map((f) => [f.id, f]));
      const missingIds = chunkIdsToFetch.filter((id) => !ftsMap.has(id));
      const fetchedChunks = await ragRepo.getChunksByIds(missingIds);
      const fetchedMap = new Map(fetchedChunks.map((c) => [c.id, c]));

      for (const entry of topRrf) {
        const id = entry.item.chunkId;
        const chunkData = ftsMap.get(id) || fetchedMap.get(id);
        if (!chunkData) {
          continue;
        }

        finalCitations.push({
          chunkId: chunkData.id,
          sourceId: chunkData.source_id,
          sourceTitle: chunkData.source_title || "Quelle",
          page: chunkData.page_number,
          startOffset: chunkData.start_offset,
          endOffset: chunkData.end_offset,
          score: Math.round(entry.score * 10000) / 10000,
          snippet: createSnippet(chunkData.text),
          vectorRank: entry.rank1 ?? null,
          ftsRank: entry.rank2 ?? null,
          vectorScore: entry.score1 ?? null,
          ftsScore: entry.score2 ?? null
        });
      }
    } else if (vectorResults.length > 0 && mode !== "fts") {
      // Vector-only results
      const topVec = vectorResults.slice(0, limit);
      const chunkIds = topVec.map((v) => v.chunkId);
      const chunks = await ragRepo.getChunksByIds(chunkIds);
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));

      let rank = 1;
      for (const vecItem of topVec) {
        const chunkData = chunkMap.get(vecItem.chunkId);
        if (!chunkData) {
          continue;
        }

        finalCitations.push({
          chunkId: chunkData.id,
          sourceId: chunkData.source_id,
          sourceTitle: chunkData.source_title || "Quelle",
          page: chunkData.page_number,
          startOffset: chunkData.start_offset,
          endOffset: chunkData.end_offset,
          score: Math.round(vecItem.score * 10000) / 10000,
          snippet: createSnippet(chunkData.text),
          vectorRank: rank,
          ftsRank: null,
          vectorScore: vecItem.score,
          ftsScore: null
        });
        rank++;
      }
    } else {
      // FTS-only or fallback
      const topFts = ftsResults.slice(0, limit);
      let rank = 1;
      for (const chunk of topFts) {
        finalCitations.push({
          chunkId: chunk.id,
          sourceId: chunk.source_id,
          sourceTitle: chunk.source_title || "Quelle",
          page: chunk.page_number,
          startOffset: chunk.start_offset,
          endOffset: chunk.end_offset,
          score: Math.round((1.0 / (60 + rank)) * 10000) / 10000,
          snippet: createSnippet(chunk.text),
          vectorRank: null,
          ftsRank: rank,
          vectorScore: null,
          ftsScore: chunk.rank
        });
        rank++;
      }
    }

    const latencyMs = Math.round((performance.now() - startTime) * 100) / 100;

    const responsePayload: SearchResponse = {
      notebookId,
      query,
      mode,
      totalResults: finalCitations.length,
      latencyMs,
      results: finalCitations
    };

    return c.json(responsePayload, 200, {
      "content-type": "application/json; charset=utf-8"
    });
  });
}
