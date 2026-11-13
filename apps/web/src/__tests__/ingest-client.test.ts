import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IngestFailure,
  type IngestWorkerLike,
  createIngestWorker,
  ingestFile,
  isIngestResponse
} from "../ingest-client.js";
import {
  type IngestParserWorkerRequest,
  type IngestParserWorkerResponse,
  handleParserMessage
} from "../workers/ingest-parser.js";

/** Worker-Attrappe, die den echten Nachrichten-Handler im selben Thread ausführt. */
class InlineWorker implements IngestWorkerLike {
  onmessage: IngestWorkerLike["onmessage"] = null;
  onerror: IngestWorkerLike["onerror"] = null;
  terminated = false;
  transferred: Transferable[] = [];

  postMessage(message: IngestParserWorkerRequest, transfer: Transferable[]): void {
    this.transferred = transfer;
    void handleParserMessage(message, (response) => {
      this.onmessage?.({ data: response } as MessageEvent<IngestParserWorkerResponse>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const textFile = (name: string, content: string, type = "text/plain") => ({
  name,
  type,
  arrayBuffer: async () => new TextEncoder().encode(content).buffer as ArrayBuffer
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ingest-Client für den Web Worker (#88, #154)", () => {
  it("liefert Chunks und Volltext, meldet Fortschritt und beendet den Worker", async () => {
    const worker = new InlineWorker();
    const progress: Array<[string, number]> = [];
    const result = await ingestFile(textFile("notiz.md", "# Titel\n\nInhalt", "text/markdown"), {
      createWorker: () => worker,
      onProgress: (stage, value) => progress.push([stage, value])
    });

    expect(result.text).toBe("# Titel\n\nInhalt");
    expect(result.chunks[0]?.text).toContain("Titel");
    expect(progress.at(-1)).toEqual(["chunking", 100]);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.transferred).toHaveLength(1);
  });

  it("lehnt mit dem Fehlercode des Workers ab", async () => {
    const worker = new InlineWorker();
    const error = await ingestFile(textFile("film.mp4", "x", "video/mp4"), {
      createWorker: () => worker
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestFailure);
    expect((error as IngestFailure).code).toBe("unsupported");
    expect(worker.terminated).toBe(true);
  });

  it("meldet einen abgestürzten Worker als 'failed', auch ohne Meldungstext", async () => {
    for (const message of ["Skriptfehler", ""]) {
      const worker = new InlineWorker();
      worker.postMessage = () => {
        worker.onerror?.({ message } as ErrorEvent);
      };
      const error = (await ingestFile(textFile("a.txt", "a"), {
        createWorker: () => worker
      }).catch((e: unknown) => e)) as IngestFailure;
      expect(error.code).toBe("failed");
      expect(error.message).toBe(message || "Ingest worker failed");
      expect(worker.terminated).toBe(true);
    }
  });

  it("ignoriert fremde Nachrichten im Worker-Kanal (z. B. 'ready' von PDF.js)", async () => {
    const worker = new InlineWorker();
    const original = worker.postMessage.bind(worker);
    worker.postMessage = (message, transfer) => {
      for (const foreign of [null, "text", { action: "ready" }, { type: "OTHER" }]) {
        worker.onmessage?.({
          data: foreign
        } as unknown as MessageEvent<IngestParserWorkerResponse>);
      }
      original(message, transfer);
    };
    await expect(
      ingestFile(textFile("a.txt", "Bleibt stabil."), { createWorker: () => worker })
    ).resolves.toMatchObject({ text: "Bleibt stabil." });
    expect(isIngestResponse({ type: "PROGRESS" })).toBe(true);
    expect(isIngestResponse({ sourceName: "worker", action: "ready" })).toBe(false);
  });

  it("kommt ohne Fortschritts-Callback aus", async () => {
    await expect(
      ingestFile(textFile("a.txt", "Hallo"), { createWorker: () => new InlineWorker() })
    ).resolves.toMatchObject({ text: "Hallo" });
  });

  it("startet standardmäßig einen Modul-Worker aus ingest.worker.ts", async () => {
    const created: Array<{ url: string; options: WorkerOptions }> = [];
    vi.stubGlobal(
      "Worker",
      class extends InlineWorker {
        constructor(url: URL, options: WorkerOptions) {
          super();
          created.push({ url: String(url), options });
        }
      }
    );
    const worker = createIngestWorker();
    expect(worker).toBeInstanceOf(InlineWorker);
    expect(created[0]?.url).toMatch(/workers\/ingest\.worker\.ts$/);
    expect(created[0]?.options).toEqual({ type: "module", name: "ingest" });

    await expect(ingestFile(textFile("b.txt", "Text"))).resolves.toMatchObject({ text: "Text" });
  });
});
