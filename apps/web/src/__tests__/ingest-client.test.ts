import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  INGEST_PARSE_TIMEOUT_MS,
  type IngestWorkerLike,
  parseFileInWorker
} from "../ingest-client.js";
import { SourceUploadError } from "../source-upload-client.js";
import { DOCX_MIME_TYPE } from "../workers/docx-parser.js";
import {
  type IngestParserWorkerRequest,
  type IngestParserWorkerResponse,
  handleParserMessage,
  parseDocument
} from "../workers/ingest-parser.js";
import { buildDocx } from "./zip-fixture.js";

// mammoth beim ersten Import kalt zu laden dauert auf ausgelasteten Rechnern mehrere Sekunden
beforeAll(async () => {
  await import("mammoth");
}, 120_000);

/** Worker-Attrappe: führt den echten Parser im selben Thread aus, asynchron wie ein Worker. */
function inProcessWorker(log: { terminated: number; transferred: number }): IngestWorkerLike {
  const worker: IngestWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: IngestParserWorkerRequest, transfer: Transferable[]) {
      log.transferred += transfer.length;
      queueMicrotask(() => {
        void handleParserMessage(message, (response) => {
          worker.onmessage?.({ data: response } as MessageEvent<IngestParserWorkerResponse>);
        });
      });
    },
    terminate() {
      log.terminated += 1;
    }
  };
  return worker;
}

describe("parseDocument liefert Chunks und Volltext", () => {
  it("Markdown: Volltext ist der Dateiinhalt", async () => {
    const md = "# Titel\n\nDie Elbe fließt durch Dresden.";
    const result = await parseDocument({
      fileData: new TextEncoder().encode(md),
      fileName: "notes.md",
      mimeType: "text/markdown"
    });
    expect(result.text).toBe(md);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("PDF: Volltext sind die Seiten mit Leerzeile getrennt, Chunks tragen die Seite", async () => {
    const result = await parseDocument({
      fileData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      fileName: "a.pdf",
      mimeType: "application/pdf",
      customPdfExtractor: async () => [
        { pageNumber: 1, text: "Seite eins." },
        { pageNumber: 2, text: "   " },
        { pageNumber: 3, text: "Seite drei." }
      ]
    });
    expect(result.text).toBe("Seite eins.\n\nSeite drei.");
    expect(result.chunks.map((c) => c.pageNumber)).toEqual([1, 3]);
  });

  it("die Worker-Nachricht CHUNKS_EXTRACTED enthält den Volltext", async () => {
    const out: IngestParserWorkerResponse[] = [];
    await handleParserMessage(
      {
        type: "PARSE_DOCUMENT",
        payload: {
          fileData: new TextEncoder().encode("Hallo Welt"),
          fileName: "a.txt",
          mimeType: "text/plain"
        }
      },
      (m) => out.push(m)
    );
    const done = out.find((m) => m.type === "CHUNKS_EXTRACTED");
    expect(done).toMatchObject({ type: "CHUNKS_EXTRACTED", text: "Hallo Welt" });
  });
});

describe("parseFileInWorker", () => {
  it("liest die Datei im Worker, überträgt den Puffer und beendet den Worker", async () => {
    const log = { terminated: 0, transferred: 0 };
    const file = new File(["Die Elbe fließt durch Dresden."], "elbe.txt", { type: "" });

    const result = await parseFileInWorker(file, "text/plain", {
      createWorker: () => inProcessWorker(log)
    });

    expect(result.text).toBe("Die Elbe fließt durch Dresden.");
    expect(result.chunks[0]?.text).toBe("Die Elbe fließt durch Dresden.");
    expect(log).toEqual({ terminated: 1, transferred: 1 });
  });

  it("gibt Parserfehler als Ablehnung weiter", async () => {
    const log = { terminated: 0, transferred: 0 };
    const error = await parseFileInWorker(new File(["x"], "a.bin"), "application/x-unknown", {
      createWorker: () => inProcessWorker(log)
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Unsupported mime type");
    expect(log.terminated).toBe(1);
  });

  it("lehnt ab, wenn der Worker selbst abstürzt", async () => {
    const worker: IngestWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => worker.onerror?.({ message: "Skript fehlt" } as ErrorEvent));
      },
      terminate() {}
    };
    const error = await parseFileInWorker(new File(["x"], "a.txt"), "text/plain", {
      createWorker: () => worker
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("Skript fehlt");
  });

  it("liest eine Word-Datei (.docx) im Worker", async () => {
    const log = { terminated: 0, transferred: 0 };
    const file = new File([buildDocx(["Die Elbe fließt durch Dresden."])], "elbe.docx");
    const result = await parseFileInWorker(file, DOCX_MIME_TYPE, {
      createWorker: () => inProcessWorker(log)
    });
    expect(result.text).toBe("Die Elbe fließt durch Dresden.");
    expect(result.chunks).toHaveLength(1);
    expect(log.terminated).toBe(1);
  });

  it("gibt Grenzverletzungen mit Code als SourceUploadError weiter (Zip-Bombe)", async () => {
    const log = { terminated: 0, transferred: 0 };
    const bomb = buildDocx(["A".repeat(5 * 1024 * 1024)]);
    const error = await parseFileInWorker(new File([bomb], "bombe.docx"), DOCX_MIME_TYPE, {
      createWorker: () => inProcessWorker(log)
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceUploadError);
    expect(error).toMatchObject({ status: 0, code: "DOCX_TOO_COMPLEX" });
    expect(log.terminated).toBe(1);
  });

  it("beendet einen hängenden Worker nach dem Zeitlimit", async () => {
    expect(INGEST_PARSE_TIMEOUT_MS).toBe(60_000);
    let terminated = 0;
    const worker: IngestWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        // Antwortet nie, wie ein Parser in einer Endlosschleife
      },
      terminate() {
        terminated += 1;
      }
    };
    const error = await parseFileInWorker(new File(["x"], "a.docx"), DOCX_MIME_TYPE, {
      createWorker: () => worker,
      timeoutMs: 20
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceUploadError);
    expect(error).toMatchObject({ status: 0, code: "PARSE_TIMEOUT" });
    expect(terminated).toBe(1);
    expect(worker.onmessage).toBeNull();
  });

  it("räumt das Zeitlimit nach einer Antwort ab (keine doppelte Beendigung)", async () => {
    vi.useFakeTimers();
    try {
      let terminated = 0;
      const worker: IngestWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage() {
          queueMicrotask(() =>
            worker.onmessage?.({
              data: { type: "CHUNKS_EXTRACTED", chunks: [], text: "ok" }
            } as unknown as MessageEvent<IngestParserWorkerResponse>)
          );
        },
        terminate() {
          terminated += 1;
        }
      };
      const result = await parseFileInWorker(new File(["x"], "a.txt"), "text/plain", {
        createWorker: () => worker,
        timeoutMs: 50
      });
      vi.advanceTimersByTime(100);
      expect(result.text).toBe("ok");
      expect(terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignoriert fremde Nachrichten im Worker-Kanal (PDF.js meldet sich selbst)", async () => {
    const worker: IngestWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => {
          worker.onmessage?.({
            data: { action: "ready" }
          } as unknown as MessageEvent<IngestParserWorkerResponse>);
          worker.onmessage?.({
            data: { type: "CHUNKS_EXTRACTED", chunks: [], text: "ok" }
          } as unknown as MessageEvent<IngestParserWorkerResponse>);
        });
      },
      terminate() {}
    };
    const result = await parseFileInWorker(new File(["x"], "a.txt"), "text/plain", {
      createWorker: () => worker
    });
    expect(result.text).toBe("ok");
  });
});
