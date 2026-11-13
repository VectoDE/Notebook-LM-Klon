import {
  type ChunkRow,
  type SourceRow,
  type ZodIssue,
  chunkText,
  createProblemDetails,
  z
} from "@notebook-lm/shared";
import type { Hono } from "hono";
import { resolveAppConfig } from "./config.js";
import { detectGoogleDocsUrl } from "./gdoc-detector.js";
import { extractArticleFromHtml } from "./html-extractor.js";
import {
  incrementUserQuota,
  localizedQuotaReason,
  quotaDenialStatus,
  verifyQuotaAction
} from "./quota-guard.js";
import type { RagRepository } from "./rag-repository.js";
import {
  type SafeFetchOptions,
  SsrSecurityError,
  StreamTooLargeError,
  safeFetchWithGuard
} from "./ssrf-guard.js";
import { checkTextWordLimit, sourceWordLimitProblem } from "./word-limit.js";

export const ImportUrlRequestSchema = z.object({
  url: z.string().url("Gültige URL erforderlich (http:// oder https://)")
});

export type ImportUrlRequest = z.infer<typeof ImportUrlRequestSchema>;

export interface UrlImportRoutesDependencies {
  readonly ragRepo: RagRepository;
  readonly fetchOptions?: SafeFetchOptions;
}

/**
 * Registers the URL Import route:
 * POST /api/v1/notebooks/:id/sources/url
 */
export function registerUrlImportRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: UrlImportRoutesDependencies
): void {
  const { ragRepo } = deps;

  app.post("/api/v1/notebooks/:id/sources/url", async (c) => {
    const notebookId = c.req.param("id");
    const sessionUser = c.get("sessionUser");

    // 1. Session / Auth Guard
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

    // 2. Parse & Validate Request Body
    let bodyJson: unknown;
    try {
      bodyJson = await c.req.json();
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

    const parsed = ImportUrlRequestSchema.safeParse(bodyJson);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue: ZodIssue) => ({
        field: issue.path.join("."),
        message: issue.message
      }));
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: "Die übermittelte URL ist ungültig.",
        instance: c.req.path,
        code: "VALIDATION_FAILED",
        errors
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const rawUrl = parsed.data.url;

    // Check Google Docs 1-click detection
    const gdocCheck = detectGoogleDocsUrl(rawUrl);
    const fetchTargetUrl =
      gdocCheck.isGoogleDoc && gdocCheck.exportUrl ? gdocCheck.exportUrl : rawUrl;
    const sourceType = gdocCheck.isGoogleDoc ? "gdoc" : "url";

    // 3. Fetch with SSRF Guard, size limit (max 10MB) and timeout
    let fetchResult: Awaited<ReturnType<typeof safeFetchWithGuard>>;
    try {
      fetchResult = await safeFetchWithGuard(fetchTargetUrl, deps.fetchOptions);
    } catch (err: unknown) {
      if (err instanceof SsrSecurityError) {
        const problem = createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: err.message,
          instance: c.req.path,
          code: err.code
        });
        return c.json(problem, 403, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }

      if (err instanceof StreamTooLargeError) {
        const problem = createProblemDetails({
          status: 413,
          title: "Payload Too Large",
          detail: err.message,
          instance: c.req.path,
          code: "PAYLOAD_TOO_LARGE"
        });
        return c.json(problem, 413, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }

      const problem = createProblemDetails({
        status: 502,
        title: "Bad Gateway",
        detail: (err as Error).message,
        instance: c.req.path,
        code: "FETCH_FAILED"
      });
      return c.json(problem, 502, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // 4. Process Content: Text Extraction & Title
    const rawText = new TextDecoder().decode(fetchResult.buffer);
    let title = "";
    let extractedContent = "";

    if (gdocCheck.isGoogleDoc) {
      const docShortId = (gdocCheck.documentId as string).slice(0, 8);
      title = `Google Doc (${docShortId})`;
      extractedContent = rawText.trim();
    } else {
      const extracted = extractArticleFromHtml(rawText);
      title = extracted.title;
      extractedContent = extracted.content;
    }

    if (!extractedContent) {
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Entity",
        detail: "Aus der URL konnte kein lesbarer Textinhalt extrahiert werden.",
        instance: c.req.path,
        code: "EMPTY_CONTENT"
      });
      return c.json(problem, 422, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // 5. Word limit and quota validation (before anything is stored)
    const byteSize = fetchResult.buffer.length;
    const config = resolveAppConfig(c.env as { APP_PROFILE?: string; APP_ORIGIN?: string });

    const wordCheck = checkTextWordLimit(extractedContent, config.quotas.maxWordsPerSource);
    if (wordCheck.exceeded) {
      return c.json(
        sourceWordLimitProblem(wordCheck.wordCount, config.quotas.maxWordsPerSource, c.req.path),
        413,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const quotaCheck = await verifyQuotaAction(
      c.env.DB,
      sessionUser.id,
      { type: "add_source", notebookId, byteSize },
      config.quotas
    );

    if (!quotaCheck.allowed) {
      const status = quotaDenialStatus(quotaCheck.code);
      const problem = createProblemDetails({
        status,
        title: status === 413 ? "Payload Too Large" : "Quota Exceeded",
        detail: localizedQuotaReason(quotaCheck, c.req.header("accept-language")),
        instance: c.req.path,
        code: quotaCheck.code
      });
      return c.json(problem, status, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // 6. Store File in R2
    const sourceId = crypto.randomUUID();
    const r2Key = `notebooks/${notebookId}/sources/${sourceId}.txt`;
    const now = Date.now();

    let r2Etag: string | null = null;
    if (c.env.MEDIA) {
      const r2Obj = await c.env.MEDIA.put(r2Key, fetchResult.buffer, {
        httpMetadata: {
          contentType: "text/plain; charset=utf-8"
        },
        customMetadata: {
          originalUrl: rawUrl,
          sourceType
        }
      });
      r2Etag = r2Obj.etag;
    }

    // 7. Store Source Record in D1
    const sourceRow: SourceRow = {
      id: sourceId,
      notebook_id: notebookId,
      title,
      original_name: rawUrl,
      mime_type: "text/plain",
      source_type: sourceType,
      byte_size: byteSize,
      r2_key: r2Key,
      r2_etag: r2Etag,
      status: "ready",
      error_message: null,
      created_at: now,
      updated_at: now
    };

    await ragRepo.createSource(sourceRow);

    // 8. Generate Semantic Chunks and Store Chunks
    const chunks = chunkText({
      text: extractedContent,
      maxTokens: 800,
      overlapTokens: 100
    });

    const chunkRows: ChunkRow[] = chunks.map((ch) => ({
      id: crypto.randomUUID(),
      source_id: sourceId,
      notebook_id: notebookId,
      chunk_index: ch.chunkIndex,
      page_number: ch.pageNumber ?? 1,
      start_offset: ch.startOffset,
      end_offset: ch.endOffset,
      text: ch.text,
      token_count: ch.tokenCount,
      created_at: now
    }));

    await ragRepo.insertChunks(chunkRows);

    // 9. Increment Quota
    await incrementUserQuota(c.env.DB, sessionUser.id, {
      type: "add_source",
      notebookId,
      byteSize
    });

    return c.json(
      {
        sourceId,
        notebookId,
        title,
        sourceType,
        byteSize,
        chunksCount: chunkRows.length,
        status: "ready"
      },
      201
    );
  });
}
