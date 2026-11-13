import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { RagRepository } from "../rag-repository.js";
import {
  MAX_SOURCE_BYTE_SIZE_LIMIT,
  buildContentDisposition,
  createR2PresignedPutUrl,
  detectMagicBytes,
  registerSourcesUploadRoutes,
  resolveSourceTypeAndExt
} from "../sources-upload.js";

/**
 * Creates in-memory SQLite wrapper mocking D1 with migrations 0001 & 0002.
 */
function createMockD1(): { db: D1Database; adapter: DatabaseAdapter; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  const migration1 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql"),
    "utf-8"
  );
  sqlite.exec(migration1);
  const migration2 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"),
    "utf-8"
  );
  sqlite.exec(migration2);

  const adapter: DatabaseAdapter = {
    async query<T>(query: string, params: unknown[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(query);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(query: string, params: unknown[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(query);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(query: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(query);
      const result = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(result.changes) };
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    }
  };

  const db: unknown = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundParams = args;
          return this;
        },
        async first<T = unknown>(): Promise<T | null> {
          return adapter.queryOne<T>(query, boundParams);
        },
        async all<T = unknown>(): Promise<{ results: T[] }> {
          const results = await adapter.query<T>(query, boundParams);
          return { results };
        },
        async run(): Promise<{ meta: { changes: number } }> {
          const res = await adapter.run(query, boundParams);
          return { meta: { changes: res.changes } };
        }
      };
    }
  };

  return {
    db: db as D1Database,
    adapter,
    close: () => sqlite.close()
  };
}

/**
 * Creates in-memory Mock R2 Bucket.
 */
function createMockR2(): R2Bucket {
  const store = new Map<
    string,
    {
      data: Uint8Array;
      httpMetadata?: Record<string, string> | undefined;
      customMetadata?: Record<string, string> | undefined;
    }
  >();

  return {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | ReadableStream | string | null,
      options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
    ): Promise<R2Object> {
      let data: Uint8Array;
      if (typeof value === "string") {
        data = new TextEncoder().encode(value);
      } else if (value instanceof Uint8Array) {
        data = value;
      } else if (value instanceof ArrayBuffer) {
        data = new Uint8Array(value);
      } else if (value && "getReader" in (value as object)) {
        const reader = (value as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (chunk) {
            chunks.push(chunk);
            total += chunk.length;
          }
        }
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          combined.set(c, offset);
          offset += c.length;
        }
        data = combined;
      } else {
        data = new Uint8Array();
      }

      store.set(key, {
        data,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata
      });

      return {
        key,
        size: data.length,
        etag: `mock-etag-${data.length}`,
        uploaded: new Date(),
        version: "1",
        httpMetadata: options?.httpMetadata
      } as unknown as R2Object;
    },

    async get(
      key: string,
      options?: { range?: { offset?: number; length?: number } }
    ): Promise<R2ObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;

      let slice = entry.data;
      if (options?.range) {
        const offset = options.range.offset ?? 0;
        const length = options.range.length ?? entry.data.length - offset;
        slice = entry.data.slice(offset, offset + length);
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        }
      });

      return {
        key,
        size: entry.data.length,
        etag: `mock-etag-${entry.data.length}`,
        uploaded: new Date(),
        version: "1",
        httpMetadata: entry.httpMetadata,
        body: stream,
        bodyUsed: false,
        async arrayBuffer() {
          return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
        },
        async text() {
          return new TextDecoder().decode(slice);
        }
      } as unknown as R2ObjectBody;
    },

    async delete(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        store.delete(k);
      }
    }
  } as unknown as R2Bucket;
}

describe("MIME and Magic Bytes Detection", () => {
  it("maps supported MIME types to source types and file extensions", () => {
    expect(resolveSourceTypeAndExt("application/pdf")).toEqual({ sourceType: "pdf", ext: "pdf" });
    expect(resolveSourceTypeAndExt("text/plain")).toEqual({ sourceType: "txt", ext: "txt" });
    expect(resolveSourceTypeAndExt("text/markdown")).toEqual({ sourceType: "md", ext: "md" });
    expect(resolveSourceTypeAndExt("text/x-markdown")).toEqual({ sourceType: "md", ext: "md" });
    expect(
      resolveSourceTypeAndExt(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toEqual({ sourceType: "docx", ext: "docx" });
    expect(resolveSourceTypeAndExt("audio/mpeg")).toEqual({ sourceType: "audio", ext: "mp3" });
    expect(resolveSourceTypeAndExt("audio/mp3")).toEqual({ sourceType: "audio", ext: "mp3" });
    expect(resolveSourceTypeAndExt("audio/mp4")).toEqual({ sourceType: "audio", ext: "m4a" });
    expect(resolveSourceTypeAndExt("audio/x-m4a")).toEqual({ sourceType: "audio", ext: "m4a" });
    expect(resolveSourceTypeAndExt("audio/wav")).toEqual({ sourceType: "audio", ext: "wav" });
    expect(resolveSourceTypeAndExt("audio/x-wav")).toEqual({ sourceType: "audio", ext: "wav" });
    expect(resolveSourceTypeAndExt("image/png")).toEqual({ sourceType: "image", ext: "png" });
    expect(resolveSourceTypeAndExt("image/jpeg")).toEqual({ sourceType: "image", ext: "jpg" });
    expect(resolveSourceTypeAndExt("video/webm")).toEqual({ sourceType: "audio", ext: "webm" });
    expect(resolveSourceTypeAndExt("unknown/format")).toBeNull();
  });

  it("identifies valid magic bytes for files", () => {
    // PDF: %PDF
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
    expect(detectMagicBytes(pdfBytes, "application/pdf")).toBe(true);

    // PNG: \x89PNG\r\n\x1a\n
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMagicBytes(pngBytes, "image/png")).toBe(true);

    // JPEG: \xFF\xD8\xFF
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMagicBytes(jpegBytes, "image/jpeg")).toBe(true);

    // DOCX (ZIP): PK\x03\x04
    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(
      detectMagicBytes(
        docxBytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(true);

    // Audio MP3 with ID3
    const id3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00]);
    expect(detectMagicBytes(id3Bytes, "audio/mpeg")).toBe(true);

    // Audio MP3 without ID3 sync frame (\xFF\xFB)
    const mp3Frame = new Uint8Array([0xff, 0xfb, 0x90, 0x64]);
    expect(detectMagicBytes(mp3Frame, "audio/mpeg")).toBe(true);

    // Audio WAV: RIFF....WAVE
    const wavBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45
    ]);
    expect(detectMagicBytes(wavBytes, "audio/wav")).toBe(true);

    // Audio M4A / MP4: ....ftyp
    const m4aBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20
    ]);
    expect(detectMagicBytes(m4aBytes, "audio/mp4")).toBe(true);

    // WebM: EBML header
    const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    expect(detectMagicBytes(webmBytes, "video/webm")).toBe(true);

    // Text / Markdown: Valid UTF-8
    const textBytes = new TextEncoder().encode("# Hello World\nThis is valid markdown.");
    expect(detectMagicBytes(textBytes, "text/markdown")).toBe(true);
    expect(detectMagicBytes(textBytes, "text/plain")).toBe(true);
  });

  it("rejects malicious or mismatched files (e.g. .exe disguised as .pdf)", () => {
    // Windows PE Executable: MZ (0x4D, 0x5A)
    const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectMagicBytes(exeBytes, "application/pdf")).toBe(false);
    expect(detectMagicBytes(exeBytes, "text/plain")).toBe(false);

    // ELF executable header
    const elfBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    expect(detectMagicBytes(elfBytes, "text/plain")).toBe(false);

    // Invalid WAV (too short or missing WAVE)
    expect(detectMagicBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46]), "audio/wav")).toBe(false);
    expect(
      detectMagicBytes(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x4e, 0x4f, 0x54, 0x57]),
        "audio/wav"
      )
    ).toBe(false);

    // Invalid M4A (too short or missing ftyp)
    expect(detectMagicBytes(new Uint8Array([0, 0, 0, 0]), "audio/mp4")).toBe(false);
    expect(
      detectMagicBytes(new Uint8Array([0, 0, 0, 0, 0x6e, 0x6f, 0x70, 0x65]), "audio/mp4")
    ).toBe(false);

    // Invalid UTF-8 sequence for text
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(detectMagicBytes(invalidUtf8, "text/plain")).toBe(false);

    // Unknown mime
    expect(detectMagicBytes(new Uint8Array([1, 2, 3]), "application/unknown")).toBe(false);

    // HTML file disguised as .pdf
    const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Spam</body></html>");
    expect(detectMagicBytes(htmlBytes, "application/pdf")).toBe(false);

    // Zero-length or tiny buffer
    expect(detectMagicBytes(new Uint8Array([]), "application/pdf")).toBe(false);
  });
});

describe("Sources Upload Flow Endpoints", () => {
  let mockD1: ReturnType<typeof createMockD1>;
  let mockR2: R2Bucket;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  const testUserId = "user-123";
  const testNotebookId = "notebook-456";

  beforeEach(async () => {
    mockD1 = createMockD1();
    mockR2 = createMockR2();
    coreRepo = new CoreRepository(mockD1.adapter);
    ragRepo = new RagRepository(mockD1.adapter);

    // Seed test user, workspace and notebook
    await coreRepo.createUser({
      id: testUserId,
      email: "engineer@relationnotes.de",
      display_name: "Engineer",
      locale: "de",
      is_guest: 0,
      created_at: Date.now(),
      expires_at: null,
      deleted_at: null
    });

    await mockD1.adapter.run(
      "INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)",
      ["ws-1", "Default Workspace", testUserId, Date.now()]
    );

    await mockD1.adapter.run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ["ws-1", testUserId, "owner", Date.now()]
    );

    await mockD1.adapter.run(
      `INSERT INTO notebooks (id, workspace_id, title, emoji, created_by, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [testNotebookId, "ws-1", "AI Research", "book", testUserId, Date.now(), Date.now(), null]
    );

    // Build Hono app with upload routes
    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();

    // Mock session auth
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      c.env = {
        DB: mockD1.db,
        MEDIA: mockR2,
        APP_PROFILE: "demo",
        APP_ORIGIN: "http://localhost:8787"
      } as unknown as Env;
      return next();
    });

    registerSourcesUploadRoutes(app, {
      coreRepo,
      ragRepo
    });
  });

  describe("POST /api/v1/notebooks/:id/sources (Upload Initialization)", () => {
    it("returns 401 when sessionUser is missing", async () => {
      const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      unauthApp.use("*", async (c, next) => {
        c.env = {
          DB: mockD1.db,
          MEDIA: mockR2,
          APP_PROFILE: "demo",
          APP_ORIGIN: "http://localhost:8787"
        } as unknown as Env;
        return next();
      });
      registerSourcesUploadRoutes(unauthApp, { coreRepo, ragRepo });

      const res = await unauthApp.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "doc.pdf", mimeType: "application/pdf", byteSize: 100 })
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 on malformed JSON payload", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json ... "
      });
      expect(res.status).toBe(400);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("INVALID_JSON");
    });

    it("rejects unsupported MIME types with 415 Unsupported Media Type", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "malware.exe",
          mimeType: "application/x-msdownload",
          byteSize: 1024
        })
      });

      expect(res.status).toBe(415);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("rejects non-numeric byteSize in POST /sources", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "test.pdf",
          mimeType: "application/pdf",
          byteSize: "invalid" as unknown as number
        })
      });

      expect(res.status).toBe(413);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("FILE_TOO_LARGE");
    });

    it("handles missing or undefined mimeType gracefully", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "test.pdf",
          mimeType: ""
        })
      });

      expect(res.status).toBe(415);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("limits a single file to 50 MB", () => {
      expect(MAX_SOURCE_BYTE_SIZE_LIMIT).toBe(50 * 1024 * 1024);
    });

    it("rejects a file of 50 MB + 1 byte with 413", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "big.pdf",
          mimeType: "application/pdf",
          byteSize: MAX_SOURCE_BYTE_SIZE_LIMIT + 1
        })
      });

      expect(res.status).toBe(413);
      const problem = (await res.json()) as { code: string; detail: string };
      expect(problem.code).toBe("FILE_TOO_LARGE");
      expect(problem.detail).toContain("50 MB");
      expect(problem.detail).toContain("Dateigröße");
    });

    it("answers FILE_TOO_LARGE in English when the client prefers English", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": "en-US,en;q=0.9" },
        body: JSON.stringify({
          filename: "big.pdf",
          mimeType: "application/pdf",
          byteSize: MAX_SOURCE_BYTE_SIZE_LIMIT + 1
        })
      });
      expect(res.status).toBe(413);
      const problem = (await res.json()) as { code: string; detail: string };
      expect(problem.code).toBe("FILE_TOO_LARGE");
      expect(problem.detail).toBe("The file is 50 MB. Each file may be at most 50 MB.");
    });

    it("accepts a file of exactly 50 MB", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "max.pdf",
          mimeType: "application/pdf",
          byteSize: MAX_SOURCE_BYTE_SIZE_LIMIT
        })
      });

      expect(res.status).toBe(201);
    });

    it("initializes source with default title when filename is empty", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "",
          mimeType: "text/plain",
          byteSize: 100
        })
      });

      expect(res.status).toBe(201);
      const payload = (await res.json()) as { sourceId: string };
      const row = await ragRepo.getSourceById(payload.sourceId);
      expect(row?.title).toBe("Unbenannt");
    });

    it("returns direct-worker-upload fallback when S3 credentials are missing", async () => {
      const res = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "my-document.pdf",
          mimeType: "application/pdf",
          byteSize: 1024 * 50
        })
      });

      expect(res.status).toBe(201);
      const payload = (await res.json()) as {
        sourceId: string;
        mode: string;
        uploadUrl: string;
        r2Key: string;
      };
      expect(payload.sourceId).toBeDefined();
      expect(payload.mode).toBe("worker-upload");
      expect(payload.uploadUrl).toBe(`/api/v1/sources/${payload.sourceId}/upload`);
      expect(payload.r2Key).toContain(
        `notebooks/${testNotebookId}/sources/${payload.sourceId}.pdf`
      );

      // Verify row in D1 created with status 'uploading'
      const row = await ragRepo.getSourceById(payload.sourceId);
      expect(row).not.toBeNull();
      expect(row?.status).toBe("uploading");
      expect(row?.mime_type).toBe("application/pdf");
      expect(row?.source_type).toBe("pdf");
    });

    it("uses default 900 seconds expiration when expiresSeconds is omitted", async () => {
      const url = await createR2PresignedPutUrl({
        accountId: "cf-acc",
        bucketName: "my-bucket",
        accessKeyId: "mock-key",
        secretAccessKey: "mock-secret",
        key: "test/file.pdf"
      });
      expect(url).toContain("X-Amz-Expires=900");
    });

    it("uses custom expiration seconds when provided for presigned URL", async () => {
      const url = await createR2PresignedPutUrl({
        accountId: "cf-acc",
        bucketName: "my-bucket",
        accessKeyId: "mock-key",
        secretAccessKey: "mock-secret",
        key: "test/file.pdf",
        expiresSeconds: 300
      });
      expect(url).toContain("X-Amz-Expires=300");
    });

    it("returns S3 presigned PUT URL when S3 credentials are configured", async () => {
      // Re-configure app with S3 credentials in env
      const s3App = new Hono<{
        Bindings: Env;
        Variables: { sessionUser?: { id: string } };
      }>();
      s3App.use("*", async (c, next) => {
        c.set("sessionUser", { id: testUserId });
        c.env = {
          DB: mockD1.db,
          MEDIA: mockR2,
          APP_PROFILE: "demo",
          APP_ORIGIN: "http://localhost:8787",
          R2_ACCESS_KEY_ID: "mock-access-key",
          R2_SECRET_ACCESS_KEY: "mock-secret-key",
          R2_BUCKET_NAME: "test-media-bucket",
          R2_ACCOUNT_ID: "cf-account-id"
        } as unknown as Env;
        return next();
      });

      registerSourcesUploadRoutes(s3App, { coreRepo, ragRepo });

      const res = await s3App.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "podcast.mp3",
          mimeType: "audio/mpeg",
          byteSize: 1024 * 1024 * 5
        })
      });

      expect(res.status).toBe(201);
      const payload = (await res.json()) as {
        sourceId: string;
        mode: string;
        uploadUrl: string;
      };
      expect(payload.sourceId).toBeDefined();
      expect(payload.mode).toBe("presigned-s3");
      expect(payload.uploadUrl).toContain(
        "https://test-media-bucket.cf-account-id.r2.cloudflarestorage.com"
      );
      expect(payload.uploadUrl).toContain("X-Amz-Signature");
      expect(payload.uploadUrl).toContain("X-Amz-Expires=900");
    });
  });

  describe("PUT /api/v1/sources/:id/upload (Worker Direct / Streaming Fallback)", () => {
    it("returns 404 when source ID is not found", async () => {
      const res = await app.request("/api/v1/sources/non-existent-source/upload", {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: new Uint8Array([1, 2, 3])
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when body stream is empty", async () => {
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "empty.txt", mimeType: "text/plain", byteSize: 0 })
      });
      const { uploadUrl } = (await initRes.json()) as { uploadUrl: string };

      const res = await app.request(uploadUrl, {
        method: "PUT"
      });
      expect(res.status).toBe(400);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("EMPTY_BODY");
    });

    it("streams binary body directly into R2 and updates byte_size", async () => {
      // 1. Init source
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "test.txt",
          mimeType: "text/plain",
          byteSize: 12
        })
      });
      const { sourceId, uploadUrl } = (await initRes.json()) as {
        sourceId: string;
        uploadUrl: string;
      };

      // 2. Stream binary payload
      const fileData = new TextEncoder().encode("Hello World!");
      const uploadRes = await app.request(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "Content-Length": String(fileData.byteLength) },
        body: fileData
      });

      expect(uploadRes.status).toBe(200);
      const uploadPayload = (await uploadRes.json()) as { status: string };
      expect(uploadPayload.status).toBe("uploaded");

      // Verify object exists in R2
      const source = await ragRepo.getSourceById(sourceId);
      expect(source?.r2_key).toBeDefined();
      const r2Obj = await mockR2.get(source?.r2_key ?? "");
      expect(r2Obj).not.toBeNull();
      const text = await r2Obj?.text();
      expect(text).toBe("Hello World!");
    });

    async function initTextSource(
      byteSize: number
    ): Promise<{ sourceId: string; uploadUrl: string }> {
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "limit.txt", mimeType: "text/plain", byteSize })
      });
      return (await initRes.json()) as { sourceId: string; uploadUrl: string };
    }

    it("returns 411 when Content-Length is missing and stores nothing", async () => {
      const { sourceId, uploadUrl } = await initTextSource(12);
      const res = await app.request(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: new TextEncoder().encode("Hello World!")
      });
      expect(res.status).toBe(411);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("LENGTH_REQUIRED");
      const source = await ragRepo.getSourceById(sourceId);
      expect(await mockR2.get(source?.r2_key ?? "")).toBeNull();
    });

    it("returns 411 when Content-Length is not a non-negative integer", async () => {
      const { uploadUrl } = await initTextSource(12);
      const res = await app.request(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "Content-Length": "-5" },
        body: new TextEncoder().encode("Hello World!")
      });
      expect(res.status).toBe(411);
    });

    it("returns 413 when Content-Length exceeds the declared byte_size and stores nothing", async () => {
      const { sourceId, uploadUrl } = await initTextSource(5);
      const fileData = new TextEncoder().encode("Hello World!");
      const res = await app.request(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "Content-Length": String(fileData.byteLength) },
        body: fileData
      });
      expect(res.status).toBe(413);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("UPLOAD_SIZE_MISMATCH");
      const source = await ragRepo.getSourceById(sourceId);
      expect(await mockR2.get(source?.r2_key ?? "")).toBeNull();
    });
  });

  describe("POST /api/v1/sources/:id/upload/complete (Magic-Byte Verification)", () => {
    it("returns 404 when source is missing", async () => {
      const res = await app.request("/api/v1/sources/non-existent-source/upload/complete", {
        method: "POST"
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when R2 object is missing upon completion", async () => {
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "missing.pdf", mimeType: "application/pdf", byteSize: 50 })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };

      const completeRes = await app.request(`/api/v1/sources/${sourceId}/upload/complete`, {
        method: "POST"
      });
      expect(completeRes.status).toBe(400);
      const problem = (await completeRes.json()) as { code: string };
      expect(problem.code).toBe("R2_OBJECT_MISSING");
    });

    it("successfully verifies valid PDF magic bytes and updates status to ready", async () => {
      // 1. Init source
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "paper.pdf",
          mimeType: "application/pdf",
          byteSize: 100
        })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };

      // 2. Put valid PDF bytes into R2
      const source = await ragRepo.getSourceById(sourceId);
      const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
      await mockR2.put(source?.r2_key ?? "", validPdf);

      // 3. Complete
      const completeRes = await app.request(`/api/v1/sources/${sourceId}/upload/complete`, {
        method: "POST"
      });

      expect(completeRes.status).toBe(200);
      const payload = (await completeRes.json()) as { status: string };
      expect(payload.status).toBe("ready");

      const updated = await ragRepo.getSourceById(sourceId);
      expect(updated?.status).toBe("ready");
      expect(updated?.error_message).toBeNull();
    });

    it("rejects disguised executable (.exe as .pdf) with 415 and marks source error", async () => {
      // 1. Init source
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "trojan.pdf",
          mimeType: "application/pdf",
          byteSize: 200
        })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };

      // 2. Put fake .exe payload into R2 (MZ header)
      const source = await ragRepo.getSourceById(sourceId);
      const fakeExe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      await mockR2.put(source?.r2_key ?? "", fakeExe);

      // 3. Complete
      const completeRes = await app.request(`/api/v1/sources/${sourceId}/upload/complete`, {
        method: "POST"
      });

      expect(completeRes.status).toBe(415);
      const problem = (await completeRes.json()) as { code: string };
      expect(problem.code).toBe("MAGIC_BYTES_MISMATCH");

      const updated = await ragRepo.getSourceById(sourceId);
      expect(updated?.status).toBe("error");
      expect(updated?.error_message).toContain("Magic-Byte");
    });
  });

  describe("GET /api/v1/sources/:id/file (Secure Download)", () => {
    it("returns 404 when source record is missing", async () => {
      const res = await app.request("/api/v1/sources/non-existent-source/file");
      expect(res.status).toBe(404);
    });

    it("returns 404 when file body is missing in R2", async () => {
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "notes.txt", mimeType: "text/plain", byteSize: 14 })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };
      const res = await app.request(`/api/v1/sources/${sourceId}/file`);
      expect(res.status).toBe(404);
      const problem = (await res.json()) as { code: string };
      expect(problem.code).toBe("FILE_NOT_FOUND");
    });

    it("streams file with Content-Disposition: attachment and security headers", async () => {
      // 1. Create and complete a valid text source
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "notes.txt",
          mimeType: "text/plain",
          byteSize: 14
        })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };
      const source = await ragRepo.getSourceById(sourceId);

      await mockR2.put(source?.r2_key ?? "", new TextEncoder().encode("Important note"));
      await app.request(`/api/v1/sources/${sourceId}/upload/complete`, { method: "POST" });

      // 2. Download file
      const downloadRes = await app.request(`/api/v1/sources/${sourceId}/file`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(downloadRes.headers.get("content-disposition")).toBe(
        "attachment; filename=\"notes.txt\"; filename*=UTF-8''notes.txt"
      );
      expect(downloadRes.headers.get("x-content-type-options")).toBe("nosniff");

      const bodyText = await downloadRes.text();
      expect(bodyText).toBe("Important note");
    });

    it("returns 404 when source or R2 object is missing", async () => {
      const res = await app.request("/api/v1/sources/non-existent-id/file");
      expect(res.status).toBe(404);
    });

    it("neutralizes CR/LF and quotes in original_name (Content-Disposition header injection)", async () => {
      const maliciousName = 'evil"\r\nSet-Cookie: pwned=1\r\nX-Injected: yes.txt';
      const initRes = await app.request(`/api/v1/notebooks/${testNotebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: maliciousName, mimeType: "text/plain", byteSize: 14 })
      });
      const { sourceId } = (await initRes.json()) as { sourceId: string };
      const source = await ragRepo.getSourceById(sourceId);
      expect(source?.original_name).toBe(maliciousName);

      await mockR2.put(source?.r2_key ?? "", new TextEncoder().encode("Important note"));

      const downloadRes = await app.request(`/api/v1/sources/${sourceId}/file`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("set-cookie")).toBeNull();
      expect(downloadRes.headers.get("x-injected")).toBeNull();

      const disposition = downloadRes.headers.get("content-disposition") ?? "";
      expect(disposition).not.toMatch(/[\r\n]/);
      expect(disposition).toBe(
        "attachment; filename=\"evilSet-Cookie: pwned=1X-Injected: yes.txt\"; filename*=UTF-8''evilSet-Cookie%3A%20pwned%3D1X-Injected%3A%20yes.txt"
      );
      // Exactly two quotes: the ones delimiting the ASCII fallback value
      expect(disposition.split('"')).toHaveLength(3);
    });
  });
});

describe("buildContentDisposition (RFC 6266 / RFC 5987)", () => {
  it("keeps plain ASCII names and adds an identical filename* parameter", () => {
    expect(buildContentDisposition("notes.txt")).toBe(
      "attachment; filename=\"notes.txt\"; filename*=UTF-8''notes.txt"
    );
  });

  it("encodes non-ASCII names in filename* and replaces them in the ASCII fallback", () => {
    expect(buildContentDisposition("Präsentation Ü.pdf")).toBe(
      "attachment; filename=\"Pr_sentation _.pdf\"; filename*=UTF-8''Pr%C3%A4sentation%20%C3%9C.pdf"
    );
  });

  it("strips control characters, quotes, backslashes and path separators", () => {
    const value = buildContentDisposition('a\u0000b\u001fc\u007fd"e\\f/g\th.txt');
    expect(value).toBe("attachment; filename=\"abcdefgh.txt\"; filename*=UTF-8''abcdefgh.txt");
  });

  it("percent-encodes characters that are not RFC 5987 attr-chars", () => {
    expect(buildContentDisposition("it's (draft)*.md")).toBe(
      "attachment; filename=\"it's (draft)*.md\"; filename*=UTF-8''it%27s%20%28draft%29%2A.md"
    );
  });

  it("falls back to 'download' when nothing usable remains", () => {
    expect(buildContentDisposition('"\r\n" ')).toBe(
      "attachment; filename=\"download\"; filename*=UTF-8''download"
    );
  });
});
