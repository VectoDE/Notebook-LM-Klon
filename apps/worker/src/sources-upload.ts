import { type SourceRow, type SourceType, createProblemDetails } from "@notebook-lm/shared";
import { AwsClient } from "aws4fetch";
import type { Hono } from "hono";
import type { CoreRepository } from "./core-repository.js";
import type { RagRepository } from "./rag-repository.js";

/**
 * 50 MB maximum size limit per file (product decision: 50 MB per file, 200 MB per notebook).
 */
export const MAX_SOURCE_BYTE_SIZE_LIMIT = 50 * 1024 * 1024;

/**
 * Allowed MIME types mapping to SourceType and file extension.
 */
export const ALLOWED_SOURCE_MIME_TYPES: Record<string, { sourceType: SourceType; ext: string }> = {
  "application/pdf": { sourceType: "pdf", ext: "pdf" },
  "text/plain": { sourceType: "txt", ext: "txt" },
  "text/markdown": { sourceType: "md", ext: "md" },
  "text/x-markdown": { sourceType: "md", ext: "md" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    sourceType: "docx",
    ext: "docx"
  },
  "audio/mpeg": { sourceType: "audio", ext: "mp3" },
  "audio/mp3": { sourceType: "audio", ext: "mp3" },
  "audio/mp4": { sourceType: "audio", ext: "m4a" },
  "audio/x-m4a": { sourceType: "audio", ext: "m4a" },
  "audio/wav": { sourceType: "audio", ext: "wav" },
  "audio/x-wav": { sourceType: "audio", ext: "wav" },
  "image/png": { sourceType: "image", ext: "png" },
  "image/jpeg": { sourceType: "image", ext: "jpg" },
  "video/webm": { sourceType: "audio", ext: "webm" }
};

export function resolveSourceTypeAndExt(
  mimeType: string
): { sourceType: SourceType; ext: string } | null {
  const normalized = mimeType.trim().toLowerCase();
  return ALLOWED_SOURCE_MIME_TYPES[normalized] ?? null;
}

/**
 * Validates the first bytes (magic bytes / file signature) against MIME type.
 * Protects against MIME-spoofing and disguised executables/HTML.
 */
export function detectMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.length === 0) return false;
  const mime = mimeType.trim().toLowerCase();

  // PDF: starts with %PDF (0x25, 0x50, 0x44, 0x46)
  if (mime === "application/pdf") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    );
  }

  // PNG: \x89PNG\r\n\x1a\n (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
  if (mime === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  // JPEG: starts with \xFF\xD8\xFF
  if (mime === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  // DOCX: ZIP archive header PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    );
  }

  // Audio MP3: ID3 header (0x49, 0x44, 0x33) or MPEG sync frame (0xFF, 0xFB/0xFA/0xF3/0xF2)
  if (mime === "audio/mpeg" || mime === "audio/mp3") {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return true;
    }
    return (
      bytes.length >= 2 && bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0
    );
  }

  // Audio WAV: RIFF....WAVE
  if (mime === "audio/wav" || mime === "audio/x-wav") {
    if (bytes.length < 12) return false;
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isWave =
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    return isRiff && isWave;
  }

  // Audio M4A: starts with ....ftyp
  if (mime === "audio/mp4" || mime === "audio/x-m4a") {
    if (bytes.length < 8) return false;
    return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  }

  // WebM: EBML header 0x1A, 0x45, 0xDF, 0xA3
  if (mime === "video/webm") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  }

  // Text / Markdown: check for valid UTF-8 and ensure it does not start with executable/HTML headers
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/x-markdown") {
    // Disallow DOS MZ header (0x4D, 0x5A)
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return false;
    }
    // Disallow ELF header (0x7F, 0x45, 0x4C, 0x46)
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x7f &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x4c &&
      bytes[3] === 0x46
    ) {
      return false;
    }

    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.slice(0, 512));
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Builds a safe `Content-Disposition: attachment` header value from an untrusted
 * filename (RFC 6266 with RFC 5987 `filename*` encoding).
 *
 * - Removes control characters (incl. CR/LF/NUL/DEL), double quotes, backslashes
 *   and path separators, so the value can neither break out of the header line
 *   (header injection / response splitting) nor out of the quoted-string
 *   (parameter smuggling such as `"; filename="evil.exe`).
 * - `filename` carries a printable-ASCII fallback for legacy clients.
 * - `filename*` carries the full UTF-8 name, percent-encoded to RFC 5987 attr-chars.
 */
export function buildContentDisposition(filename: string): string {
  let cleaned = "";
  for (const ch of filename) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '"' || ch === "\\" || ch === "/") {
      continue;
    }
    cleaned += ch;
  }
  cleaned = cleaned.trim();
  const safeName = cleaned.length > 0 ? cleaned : "download";

  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export interface SourcesUploadRoutesDependencies {
  coreRepo: CoreRepository;
  ragRepo: RagRepository;
}

export interface SourceInitRequest {
  filename: string;
  mimeType: string;
  byteSize: number;
}

/**
 * Generates an S3 presigned PUT URL for Cloudflare R2 via aws4fetch.
 */
export async function createR2PresignedPutUrl(options: {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  key: string;
  expiresSeconds?: number;
}): Promise<string> {
  const expires = options.expiresSeconds ?? 900; // 15 minutes
  const endpoint = `https://${options.bucketName}.${options.accountId}.r2.cloudflarestorage.com/${options.key}?X-Amz-Expires=${expires}`;

  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: "auto"
  });

  const signedRequest = await client.sign(endpoint, {
    method: "PUT",
    aws: { signQuery: true }
  });

  return signedRequest.url;
}

/**
 * Registers R2 Upload Flow endpoints into Hono application:
 * 1. POST /api/v1/notebooks/:id/sources (Init upload)
 * 2. PUT /api/v1/sources/:id/upload (Worker streaming upload fallback)
 * 3. POST /api/v1/sources/:id/upload/complete (Magic-byte check & mark ready)
 * 4. GET /api/v1/sources/:id/file (Secure download with Content-Disposition)
 */
export function registerSourcesUploadRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: SourcesUploadRoutesDependencies
): void {
  const { ragRepo } = deps;

  // ---------------------------------------------------------------------------
  // 1. POST /api/v1/notebooks/:id/sources (Init Upload)
  // ---------------------------------------------------------------------------
  app.post("/api/v1/notebooks/:id/sources", async (c) => {
    const notebookId = c.req.param("id");
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

    let body: SourceInitRequest;
    try {
      body = await c.req.json<SourceInitRequest>();
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

    const { filename, mimeType, byteSize } = body;

    // Validate MIME whitelist
    const resolvedType = resolveSourceTypeAndExt(mimeType || "");
    if (!resolvedType) {
      const problem = createProblemDetails({
        status: 415,
        title: "Unsupported Media Type",
        detail: `Dateityp '${mimeType}' wird nicht unterstützt. Erlaubt sind PDF, TXT, MD, DOCX, MP3/M4A/WAV, PNG/JPEG, WEBM.`,
        instance: c.req.path,
        code: "UNSUPPORTED_MEDIA_TYPE"
      });
      return c.json(problem, 415, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Validate maximum file size
    const sizeNumber = typeof byteSize === "number" ? byteSize : 0;
    if (typeof byteSize !== "number" || sizeNumber > MAX_SOURCE_BYTE_SIZE_LIMIT) {
      const problem = createProblemDetails({
        status: 413,
        title: "Payload Too Large",
        detail: `Dateigröße (${Math.round(sizeNumber / 1024 / 1024)} MB) überschreitet das Limit von ${Math.round(MAX_SOURCE_BYTE_SIZE_LIMIT / 1024 / 1024)} MB.`,
        instance: c.req.path,
        code: "FILE_TOO_LARGE"
      });
      return c.json(problem, 413, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Generate unique Source ID and R2 Object Key
    const sourceId = crypto.randomUUID();
    const r2Key = `notebooks/${notebookId}/sources/${sourceId}.${resolvedType.ext}`;
    const now = Date.now();

    // Check if S3 credentials are configured in env
    const env = c.env as unknown as Record<string, string | undefined>;
    const s3AccessKey = env.R2_ACCESS_KEY_ID;
    const s3SecretKey = env.R2_SECRET_ACCESS_KEY;
    const s3Bucket = env.R2_BUCKET_NAME;
    const s3AccountId = env.R2_ACCOUNT_ID;

    let uploadUrl: string;
    let mode: "presigned-s3" | "worker-upload";

    if (s3AccessKey && s3SecretKey && s3Bucket && s3AccountId) {
      uploadUrl = await createR2PresignedPutUrl({
        accountId: s3AccountId,
        bucketName: s3Bucket,
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
        key: r2Key,
        expiresSeconds: 900 // 15 Min
      });
      mode = "presigned-s3";
    } else {
      uploadUrl = `/api/v1/sources/${sourceId}/upload`;
      mode = "worker-upload";
    }

    // Persist source record with status 'uploading'
    const finalTitle = filename.trim().length > 0 ? filename : "Unbenannt";
    const sourceRow: SourceRow = {
      id: sourceId,
      notebook_id: notebookId,
      title: finalTitle,
      original_name: finalTitle,
      mime_type: mimeType,
      source_type: resolvedType.sourceType,
      byte_size: byteSize,
      r2_key: r2Key,
      r2_etag: null,
      status: "uploading",
      error_message: null,
      created_at: now,
      updated_at: now
    };

    await ragRepo.createSource(sourceRow);

    return c.json(
      {
        sourceId,
        mode,
        uploadUrl,
        r2Key,
        expiresInSeconds: 900
      },
      201
    );
  });

  // ---------------------------------------------------------------------------
  // 2. PUT /api/v1/sources/:id/upload (Worker Streaming Upload Fallback)
  // ---------------------------------------------------------------------------
  app.put("/api/v1/sources/:id/upload", async (c) => {
    const sourceId = c.req.param("id");
    const source = await ragRepo.getSourceById(sourceId);

    if (!source || !source.r2_key) {
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

    const bodyStream = c.req.raw.body;
    if (!bodyStream) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "Upload-Body fehlt.",
        instance: c.req.path,
        code: "EMPTY_BODY"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // The body may not be larger than the size declared at init (source.byte_size,
    // already capped by quota). Content-Length is mandatory so the check cannot be
    // skipped by chunked streaming.
    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader === undefined || !/^\d+$/.test(contentLengthHeader)) {
      const problem = createProblemDetails({
        status: 411,
        title: "Length Required",
        detail: "Für den Upload ist ein gültiger Content-Length-Header erforderlich.",
        instance: c.req.path,
        code: "LENGTH_REQUIRED"
      });
      return c.json(problem, 411, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }
    if (Number(contentLengthHeader) > source.byte_size) {
      const problem = createProblemDetails({
        status: 413,
        title: "Payload Too Large",
        detail: `Upload (${contentLengthHeader} Bytes) ist größer als die angemeldete Dateigröße (${source.byte_size} Bytes).`,
        instance: c.req.path,
        code: "UPLOAD_SIZE_MISMATCH"
      });
      return c.json(problem, 413, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Direct streaming into R2 bucket without buffering in Worker RAM
    const r2Result = await c.env.MEDIA.put(source.r2_key, bodyStream, {
      httpMetadata: {
        contentType: source.mime_type
      }
    });

    return c.json(
      {
        status: "uploaded",
        sourceId,
        etag: r2Result.etag
      },
      200
    );
  });

  // ---------------------------------------------------------------------------
  // 3. POST /api/v1/sources/:id/upload/complete (Magic-Byte Verification)
  // ---------------------------------------------------------------------------
  app.post("/api/v1/sources/:id/upload/complete", async (c) => {
    const sourceId = c.req.param("id");
    const source = await ragRepo.getSourceById(sourceId);

    if (!source || !source.r2_key) {
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

    // Read first 512 bytes from R2 object for magic byte inspection
    const headObject = await c.env.MEDIA.get(source.r2_key, {
      range: { offset: 0, length: 512 }
    });

    if (!headObject) {
      await ragRepo.updateSourceStatus(sourceId, "error", "Datei wurde nicht in R2 gefunden.");
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "Datei wurde nicht in R2 gefunden.",
        instance: c.req.path,
        code: "R2_OBJECT_MISSING"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const buffer = await headObject.arrayBuffer();
    const firstBytes = new Uint8Array(buffer);

    const isValid = detectMagicBytes(firstBytes, source.mime_type);
    if (!isValid) {
      await ragRepo.updateSourceStatus(
        sourceId,
        "error",
        "Magic-Byte-Verifikation fehlgeschlagen: Dateiformat stimmt nicht mit deklariertem MIME-Type überein."
      );

      const problem = createProblemDetails({
        status: 415,
        title: "Unsupported Media Type",
        detail:
          "Die Datei entspricht nicht dem angegebenen Format (Magic-Byte-Prüfung fehlgeschlagen).",
        instance: c.req.path,
        code: "MAGIC_BYTES_MISMATCH"
      });
      return c.json(problem, 415, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Update source status to ready
    await ragRepo.updateSourceStatus(sourceId, "ready", null);

    return c.json(
      {
        status: "ready",
        sourceId,
        verified: true
      },
      200
    );
  });

  // ---------------------------------------------------------------------------
  // 4. GET /api/v1/sources/:id/file (Secure Download)
  // ---------------------------------------------------------------------------
  app.get("/api/v1/sources/:id/file", async (c) => {
    const sourceId = c.req.param("id");
    const source = await ragRepo.getSourceById(sourceId);

    if (!source || !source.r2_key) {
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

    const object = await c.env.MEDIA.get(source.r2_key);
    if (!object || !object.body) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Datei nicht im Speicher gefunden.",
        instance: c.req.path,
        code: "FILE_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // Secure download headers:
    // - Content-Disposition: attachment; filename="..."; filename*=UTF-8''...
    //   (original_name is user-controlled and must be sanitized, see buildContentDisposition)
    // - X-Content-Type-Options: nosniff
    const contentType = source.mime_type;

    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": `${contentType}; charset=utf-8`,
        "content-disposition": buildContentDisposition(source.original_name),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-cache"
      }
    });
  });
}
