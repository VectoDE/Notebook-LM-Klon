import { afterAll, describe, expect, it, vi } from "vitest";
import type {
  IngestParserWorkerRequest,
  IngestParserWorkerResponse
} from "../workers/ingest-parser.js";

/** Einstieg des Web Workers (#88): Nachrichten annehmen, Antworten zurückschicken. */
const posted: IngestParserWorkerResponse[] = [];
const scope: {
  location: { origin: string };
  postMessage: (message: IngestParserWorkerResponse) => void;
  onmessage: ((event: { data: IngestParserWorkerRequest; origin: string }) => void) | null;
} = {
  location: { origin: "https://app.example" },
  postMessage: (message) => posted.push(message),
  onmessage: null
};
vi.stubGlobal("self", scope);
await import("../workers/ingest.worker.js");
afterAll(() => vi.unstubAllGlobals());

const request: IngestParserWorkerRequest = {
  type: "PARSE_DOCUMENT",
  payload: {
    fileData: new TextEncoder().encode("Hallo aus dem Worker."),
    fileName: "hallo.txt",
    mimeType: "text/plain"
  }
};

describe("ingest.worker.ts (#88)", () => {
  it("verarbeitet Nachrichten aus dem eigenen Kontext und antwortet mit Fortschritt und Chunks", async () => {
    scope.onmessage?.({ data: request, origin: "" });
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe("CHUNKS_EXTRACTED"));
    expect(posted[0]).toMatchObject({ type: "PROGRESS", stage: "reading" });
  });

  it("ignoriert Nachrichten fremder Herkunft", async () => {
    posted.length = 0;
    scope.onmessage?.({ data: request, origin: "https://fremd.example" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).toEqual([]);
    scope.onmessage?.({ data: request, origin: "https://app.example" });
    await vi.waitFor(() => expect(posted.at(-1)?.type).toBe("CHUNKS_EXTRACTED"));
  });
});
