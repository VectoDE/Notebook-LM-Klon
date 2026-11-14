import { IngestChunksBodySchema, type TextChunk, chunkText } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import {
  CHUNK_BATCH_SIZE,
  SourceUploadError,
  resolveUploadMimeType,
  uploadSource
} from "../source-upload-client.js";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
}

/** Fetch-Attrappe des Workers: zeichnet jede Anfrage auf und antwortet wie die echten Routen. */
function fakeWorker(
  overrides: Partial<Record<string, (call: Call) => Response>> = {},
  initBody: Record<string, unknown> = {}
) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    let body: unknown = init.body;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    const call: Call = { url, method, headers, body, credentials: init.credentials };
    calls.push(call);
    const key = `${method} ${url.replace(/src_new/g, ":id")}`;
    const override = overrides[key];
    if (override) return override(call);
    if (key === "POST /api/v1/notebooks/nb_1/sources") {
      return Response.json(
        {
          sourceId: "src_new",
          mode: "worker-upload",
          uploadUrl: "/api/v1/sources/src_new/upload",
          ...initBody
        },
        { status: 201 }
      );
    }
    if (key === "PUT /api/v1/sources/:id/upload") return Response.json({ status: "uploaded" });
    if (key === "POST /api/v1/sources/:id/upload/complete") {
      return Response.json({ status: "ready", verified: true });
    }
    if (key === "POST /api/v1/sources/:id/chunks") {
      const chunks = (body as { chunks: unknown[] }).chunks;
      return Response.json({ success: true, chunksIngested: chunks.length, status: "ready" });
    }
    if (key === "DELETE /api/v1/sources/:id") return Response.json({ success: true });
    if (url.startsWith("https://")) return new Response(null, { status: 200 });
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const textParser = async (file: File) => {
  const text = await file.text();
  return { chunks: chunkText({ text, maxTokens: 64, overlapTokens: 0 }), text };
};

describe("resolveUploadMimeType", () => {
  it("nimmt den Dateityp des Browsers, wenn der Worker ihn kennt", () => {
    expect(resolveUploadMimeType(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBe(
      "application/pdf"
    );
    expect(resolveUploadMimeType(new File(["x"], "a.txt", { type: "Text/Plain" }))).toBe(
      "text/plain"
    );
  });

  it("leitet den Typ aus der Endung ab, wenn der Browser keinen liefert (Markdown unter Windows)", () => {
    expect(resolveUploadMimeType(new File(["x"], "notes.md"))).toBe("text/markdown");
    expect(resolveUploadMimeType(new File(["x"], "README.MARKDOWN"))).toBe("text/markdown");
    expect(
      resolveUploadMimeType(new File(["x"], "a.txt", { type: "application/octet-stream" }))
    ).toBe("text/plain");
  });

  it("lehnt Dateiarten ab, die der Text-Parser nicht lesen kann", () => {
    expect(resolveUploadMimeType(new File(["x"], "bild.png", { type: "image/png" }))).toBeNull();
    expect(resolveUploadMimeType(new File(["x"], "programm.exe"))).toBeNull();
  });
});

describe("uploadSource: Kette Init, Upload, Prüfung, Chunks", () => {
  it("lädt eine TXT-Datei hoch und übergibt die Chunks dem Index", async () => {
    const { calls, fetchImpl } = fakeWorker();
    const stages: string[] = [];
    const file = new File(["Die Elbe fließt durch Dresden und Hamburg."], "elbe.txt", {
      type: "text/plain"
    });

    const result = await uploadSource({
      notebookId: "nb_1",
      file,
      parse: textParser,
      fetchImpl,
      onStage: (stage) => stages.push(stage)
    });

    expect(result).toEqual({
      sourceId: "src_new",
      mimeType: "text/plain",
      chunksCount: 1,
      text: "Die Elbe fließt durch Dresden und Hamburg."
    });
    expect(stages).toEqual(["parsing", "uploading", "verifying", "indexing"]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/v1/notebooks/nb_1/sources",
      "PUT /api/v1/sources/src_new/upload",
      "POST /api/v1/sources/src_new/upload/complete",
      "POST /api/v1/sources/src_new/chunks"
    ]);
    expect(calls[0]?.body).toEqual({
      filename: "elbe.txt",
      mimeType: "text/plain",
      byteSize: file.size
    });
    expect(calls[1]?.headers["content-type"]).toBe("text/plain");
    expect(calls[1]?.body).toBe(file);
    expect(calls[1]?.credentials).toBe("same-origin");

    // Der Körper erfüllt das Schema der Worker-Route (gemeinsamer Vertrag aus @notebook-lm/shared)
    const parsed = IngestChunksBodySchema.parse(calls[3]?.body);
    expect(parsed.markReady).toBe(true);
    expect(parsed.chunks[0]).toMatchObject({
      chunkIndex: 0,
      text: "Die Elbe fließt durch Dresden und Hamburg.",
      startOffset: 0
    });
  });

  it("schickt viele Chunks in Paketen und setzt die Quelle erst mit dem letzten bereit", async () => {
    const { calls, fetchImpl } = fakeWorker();
    const chunks: TextChunk[] = Array.from({ length: CHUNK_BATCH_SIZE + 3 }, (_, i) => ({
      chunkIndex: i,
      text: `Abschnitt ${i}`,
      tokenCount: 2,
      pageNumber: 2,
      startOffset: i * 10,
      endOffset: i * 10 + 9
    }));
    const file = new File(["%PDF-1.7"], "bericht.pdf", { type: "application/pdf" });

    const result = await uploadSource({
      notebookId: "nb_1",
      file,
      parse: async () => ({ chunks, text: "…" }),
      fetchImpl
    });

    expect(result.chunksCount).toBe(CHUNK_BATCH_SIZE + 3);
    const batches = calls.filter((c) => c.url.endsWith("/chunks"));
    expect(batches).toHaveLength(2);
    const first = IngestChunksBodySchema.parse(batches[0]?.body);
    const second = IngestChunksBodySchema.parse(batches[1]?.body);
    expect(first.chunks).toHaveLength(CHUNK_BATCH_SIZE);
    expect(first.markReady).toBe(false);
    expect(second.chunks.map((c) => c.chunkIndex)).toEqual([
      CHUNK_BATCH_SIZE,
      CHUNK_BATCH_SIZE + 1,
      CHUNK_BATCH_SIZE + 2
    ]);
    expect(second.chunks[0]?.pageNumber).toBe(2);
    expect(second.markReady).toBe(true);
  });

  it("lädt bei vorsignierter R2-Adresse direkt dorthin, ohne Cookies mitzuschicken", async () => {
    const presigned = "https://bucket.account.r2.cloudflarestorage.com/k?X-Amz-Signature=abc";
    const { calls, fetchImpl } = fakeWorker({}, { mode: "presigned-s3", uploadUrl: presigned });
    await uploadSource({
      notebookId: "nb_1",
      file: new File(["Text"], "a.md"),
      parse: textParser,
      fetchImpl
    });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe(presigned);
    expect(put?.credentials).toBe("omit");
    expect(put?.headers["content-type"]).toBe("text/markdown");
  });

  it("bricht bei nicht unterstützter Dateiart ab, bevor der Server etwas anlegt", async () => {
    const { calls, fetchImpl } = fakeWorker();
    const error = await uploadSource({
      notebookId: "nb_1",
      file: new File(["x"], "foto.png", { type: "image/png" }),
      parse: textParser,
      fetchImpl
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceUploadError);
    expect((error as SourceUploadError).code).toBe("UNSUPPORTED_TYPE");
    expect(calls).toHaveLength(0);
  });

  it("legt nichts an, wenn die Datei keinen lesbaren Text enthält", async () => {
    const { calls, fetchImpl } = fakeWorker();
    const error = await uploadSource({
      notebookId: "nb_1",
      file: new File(["   "], "leer.txt", { type: "text/plain" }),
      parse: textParser,
      fetchImpl
    }).catch((e: unknown) => e);
    expect((error as SourceUploadError).code).toBe("NO_TEXT");
    expect(calls).toHaveLength(0);
  });

  it("meldet Problem Details des Servers mit Status und Code", async () => {
    const { fetchImpl } = fakeWorker({
      "POST /api/v1/notebooks/nb_1/sources": () =>
        Response.json(
          { status: 403, detail: "Keine Berechtigung.", code: "INSUFFICIENT_ROLE" },
          { status: 403, headers: { "content-type": "application/problem+json" } }
        )
    });
    const error = (await uploadSource({
      notebookId: "nb_1",
      file: new File(["Text"], "a.txt", { type: "text/plain" }),
      parse: textParser,
      fetchImpl
    }).catch((e: unknown) => e)) as SourceUploadError;
    expect(error).toBeInstanceOf(SourceUploadError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("INSUFFICIENT_ROLE");
    expect(error.message).toBe("Keine Berechtigung.");
  });

  it("räumt die angelegte Quelle wieder ab, wenn ein späterer Schritt scheitert", async () => {
    const { calls, fetchImpl } = fakeWorker({
      "POST /api/v1/sources/:id/upload/complete": () =>
        Response.json(
          {
            status: 415,
            detail: "Magic-Byte-Prüfung fehlgeschlagen.",
            code: "MAGIC_BYTES_MISMATCH"
          },
          { status: 415 }
        )
    });
    const error = (await uploadSource({
      notebookId: "nb_1",
      file: new File(["Text"], "a.txt", { type: "text/plain" }),
      parse: textParser,
      fetchImpl
    }).catch((e: unknown) => e)) as SourceUploadError;
    expect(error.code).toBe("MAGIC_BYTES_MISMATCH");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "/api/v1/sources/src_new" });
  });

  it("meldet Netzwerkfehler mit Status 0", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const error = (await uploadSource({
      notebookId: "nb_1",
      file: new File(["Text"], "a.txt", { type: "text/plain" }),
      parse: textParser,
      fetchImpl
    }).catch((e: unknown) => e)) as SourceUploadError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
  });
});
