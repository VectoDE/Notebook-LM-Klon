import { describe, expect, it } from "vitest";
import { readBodyLimited } from "../body-limit.js";

function streamOf(chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    }
  });
}

function requestWithStream(chunks: number[][]): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    body: streamOf(chunks),
    duplex: "half"
  } as RequestInit);
}

describe("readBodyLimited", () => {
  it("liefert den vollständigen Körper, wenn er innerhalb der Grenze bleibt", async () => {
    const out = await readBodyLimited(requestWithStream([[1, 2], [3]]), 10);
    expect([...(out ?? [])]).toEqual([1, 2, 3]);
  });

  it("bricht mit null ab, sobald die Grenze überschritten wird", async () => {
    const out = await readBodyLimited(
      requestWithStream([
        [1, 2],
        [3, 4, 5]
      ]),
      4
    );
    expect(out).toBeNull();
  });

  it("liefert einen leeren Körper als leeres Array", async () => {
    const out = await readBodyLimited(new Request("http://localhost/x", { method: "POST" }), 4);
    expect(out?.byteLength).toBe(0);
  });
});
