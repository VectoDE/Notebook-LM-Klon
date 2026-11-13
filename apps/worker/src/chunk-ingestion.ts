import {
  IngestChunksBodySchema,
  countUniqueWords,
  createProblemDetails,
  quantizeFloat32ToInt8
} from "@notebook-lm/shared";
import type { Hono } from "hono";
import type { AuditLogger } from "./audit-log.js";
import { resolveAppConfig } from "./config.js";
import type { CoreRepository } from "./core-repository.js";
import type { RagRepository } from "./rag-repository.js";
import { exceedsWordLimit, sourceWordLimitProblem } from "./word-limit.js";

export const D1_STATEMENT_BATCH_LIMIT = 50;

export interface ChunkIngestionRoutesDependencies {
  ragRepo: RagRepository;
  coreRepo?: CoreRepository | undefined;
  d1Database?: D1Database | undefined;
  /** Security audit log (Issue #259); source deletions are recorded when set. */
  auditLogger?: AuditLogger | undefined;
}

/**
 * Notifies the NotebookDO (or in-memory store in Node.js) to update or invalidate its vector cache.
 */
export async function notifyNotebookDO(
  env: Env | undefined,
  notebookId: string,
  action: "update" | "invalidate",
  payload?: {
    sourceId?: string;
    vectors?: Array<{
      chunkId: string;
      sourceId?: string;
      quantized: number[];
      scale: number;
    }>;
  }
): Promise<void> {
  if (!env?.NOTEBOOK_DO) {
    return;
  }

  try {
    const doId = env.NOTEBOOK_DO.idFromName(notebookId);
    const doStub = env.NOTEBOOK_DO.get(doId);

    const path = action === "update" ? "/vectors/update" : "/vectors/invalidate";
    await doStub.fetch(`http://internal${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {})
    });
  } catch {
    // Non-fatal if NotebookDO notification fails
  }
}

/**
 * Registers Chunk & Vector Ingestion endpoints:
 * 1. POST /api/v1/sources/:id/chunks (Batch Ingestion)
 * 2. DELETE /api/v1/sources/:id (Delete Source & invalidate vector cache)
 */
export function registerChunkIngestionRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: ChunkIngestionRoutesDependencies
): void {
  const { ragRepo } = deps;

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/sources/:id/chunks (Batch Ingest into D1 & FTS5)
  // ---------------------------------------------------------------------------
  app.post("/api/v1/sources/:id/chunks", async (c) => {
    const sourceId = c.req.param("id");
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

    // 1. Fetch Source & Verify Existence
    const source = await ragRepo.getSourceById(sourceId);
    if (!source) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: `Quelle '${sourceId}' wurde nicht gefunden.`,
        instance: c.req.path,
        code: "SOURCE_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // 2. Parse & Validate Body
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

    const parseResult = IngestChunksBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: "Ungültige Chunk-Payload.",
        instance: c.req.path,
        code: "VALIDATION_ERROR",
        errors: parseResult.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message
        }))
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const { chunks: chunkItems, model, markReady } = parseResult.data;

    // Word limit per source: existing chunks (replaced by index) plus this batch.
    const wordLimit = resolveAppConfig(c.env as { APP_PROFILE?: string; APP_ORIGIN?: string })
      .quotas.maxWordsPerSource;
    const batchIndexes = new Set(chunkItems.map((item) => item.chunkIndex));
    const existingChunks = (await ragRepo.getChunksBySource(source.id)).filter(
      (row) => !batchIndexes.has(row.chunk_index)
    );
    const totalWords = countUniqueWords([
      ...existingChunks.map((row) => ({
        chunkIndex: row.chunk_index,
        text: row.text,
        startOffset: row.start_offset,
        endOffset: row.end_offset
      })),
      ...chunkItems
    ]);
    if (exceedsWordLimit(totalWords, wordLimit)) {
      return c.json(sourceWordLimitProblem(totalWords, wordLimit, c.req.path), 413, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }
    const now = Date.now();
    const d1 = deps.d1Database ?? c.env.DB;

    // Build statements for chunk and vector insertion
    // Each chunk insertion will also automatically trigger FTS5 chunks_fts via SQLite triggers!
    interface PreparedItem {
      chunkSql: string;
      chunkParams: unknown[];
      vectorSql?: string | undefined;
      vectorParams?: unknown[] | undefined;
      doVector?:
        | {
            chunkId: string;
            sourceId: string;
            quantized: number[];
            scale: number;
          }
        | undefined;
    }

    const preparedItems: PreparedItem[] = [];

    for (const item of chunkItems) {
      const chunkId =
        item.id || `chunk_${source.id}_${item.chunkIndex}_${crypto.randomUUID().slice(0, 8)}`;
      const tokenCount = item.tokenCount ?? Math.max(1, Math.round(item.text.length / 4));

      const chunkSql = `INSERT OR REPLACE INTO chunks (
        id, source_id, notebook_id, chunk_index, page_number,
        start_offset, end_offset, text, token_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const chunkParams = [
        chunkId,
        source.id,
        source.notebook_id,
        item.chunkIndex,
        item.pageNumber ?? null,
        item.startOffset ?? null,
        item.endOffset ?? null,
        item.text,
        tokenCount,
        now
      ];

      let vectorSql: string | undefined;
      let vectorParams: unknown[] | undefined;
      let doVector: PreparedItem["doVector"] | undefined;

      if (item.vector) {
        let quantizedArr: Int8Array;
        let scale: number;
        let dimensions: number;

        if ("quantized" in item.vector) {
          quantizedArr = new Int8Array(item.vector.quantized);
          scale = item.vector.scale;
          dimensions = item.vector.dimensions ?? quantizedArr.length;
        } else {
          // auto-quantize from float32
          const floatArr = new Float32Array(item.vector.float32);
          const q = quantizeFloat32ToInt8(floatArr);
          quantizedArr = q.quantized;
          scale = q.scale;
          dimensions = floatArr.length;
        }

        // Convert int8 quantized array to Uint8Array for SQLite BLOB storage
        const blob = new Uint8Array(
          quantizedArr.buffer,
          quantizedArr.byteOffset,
          quantizedArr.byteLength
        );

        let minVal = Number(quantizedArr[0]) * scale;
        let maxVal = Number(quantizedArr[0]) * scale;
        const qLen = quantizedArr.length;
        for (let j = 1; j < qLen; j++) {
          const v = Number(quantizedArr[j]) * scale;
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }

        vectorSql = `INSERT OR REPLACE INTO chunk_vectors (
          chunk_id, notebook_id, model, dimensions, scale, min_val, max_val, vector, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        vectorParams = [
          chunkId,
          source.notebook_id,
          model,
          dimensions,
          scale,
          minVal,
          maxVal,
          blob,
          now
        ];

        doVector = {
          chunkId,
          sourceId: source.id,
          quantized: Array.from(quantizedArr),
          scale
        };
      }

      preparedItems.push({
        chunkSql,
        chunkParams,
        vectorSql,
        vectorParams,
        doVector
      });
    }

    // Execute in batches using d1.batch if available, or sequential fallback
    const statementsToBatch: Array<{ sql: string; params: unknown[] }> = [];
    const doVectorsToNotify: NonNullable<PreparedItem["doVector"]>[] = [];

    for (const p of preparedItems) {
      statementsToBatch.push({ sql: p.chunkSql, params: p.chunkParams });
      if (p.vectorSql && p.vectorParams) {
        statementsToBatch.push({ sql: p.vectorSql, params: p.vectorParams });
      }
      if (p.doVector) {
        doVectorsToNotify.push(p.doVector);
      }
    }

    // Split statements into sub-batches respecting D1_STATEMENT_BATCH_LIMIT
    for (let i = 0; i < statementsToBatch.length; i += D1_STATEMENT_BATCH_LIMIT) {
      const slice = statementsToBatch.slice(i, i + D1_STATEMENT_BATCH_LIMIT);
      if (d1?.batch && typeof d1.batch === "function") {
        const d1Statements = slice.map((st) => d1.prepare(st.sql).bind(...st.params));
        await d1.batch(d1Statements);
      } else {
        for (const st of slice) {
          await ragRepo.db.run(st.sql, st.params);
        }
      }
    }

    // Update source status to 'ready' if requested
    let updatedStatus = source.status;
    if (markReady) {
      await ragRepo.updateSourceStatus(source.id, "ready", null);
      updatedStatus = "ready";
    }

    // Invalidate / update NotebookDO vector cache
    if (doVectorsToNotify.length > 0) {
      await notifyNotebookDO(c.env, source.notebook_id, "update", {
        sourceId: source.id,
        vectors: doVectorsToNotify
      });
    } else {
      await notifyNotebookDO(c.env, source.notebook_id, "invalidate", {
        sourceId: source.id
      });
    }

    return c.json(
      {
        success: true,
        sourceId: source.id,
        notebookId: source.notebook_id,
        chunksIngested: chunkItems.length,
        vectorsIngested: doVectorsToNotify.length,
        status: updatedStatus
      },
      200,
      {
        "content-type": "application/json; charset=utf-8"
      }
    );
  });

  // ---------------------------------------------------------------------------
  // 2. DELETE /api/v1/sources/:id (Delete Source & Invalidate Vector Cache)
  // ---------------------------------------------------------------------------
  app.delete("/api/v1/sources/:id", async (c) => {
    const sourceId = c.req.param("id");
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

    const source = await ragRepo.getSourceById(sourceId);
    if (!source) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: `Quelle '${sourceId}' wurde nicht gefunden.`,
        instance: c.req.path,
        code: "SOURCE_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Delete source in database (cascades to chunks, chunk_vectors, and FTS triggers)
    await ragRepo.deleteSource(sourceId);
    await deps.auditLogger?.record(c, {
      userId: sessionUser.id,
      action: "source.delete",
      target: `source:${sourceId}`
    });

    // Delete R2 media if key exists
    if (source.r2_key && c.env.MEDIA) {
      try {
        await c.env.MEDIA.delete(source.r2_key);
      } catch {
        // Non-fatal if R2 deletion fails
      }
    }

    // Invalidate NotebookDO vector cache
    await notifyNotebookDO(c.env, source.notebook_id, "invalidate", {
      sourceId
    });

    return c.json(
      {
        success: true,
        deletedSourceId: sourceId,
        notebookId: source.notebook_id
      },
      200,
      {
        "content-type": "application/json; charset=utf-8"
      }
    );
  });
}
