import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_LIMIT,
  MAX_OBJECT_BYTES,
  ObjectTooLargeError,
  createLocalR2Adapter,
  resolveRange
} from "../node/fs-r2.js";
import { MAX_SOURCE_BYTE_SIZE_LIMIT } from "../sources-upload.js";

let dir = "";
let mediaDir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nlk-r2-"));
  mediaDir = join(dir, "media");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const md5 = (data: Uint8Array | string) => createHash("md5").update(data).digest("hex");

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

async function readAll(stream: ReadableStream): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of stream as unknown as AsyncIterable<Uint8Array>) parts.push(part);
  return Buffer.concat(parts);
}

describe("resolveRange", () => {
  it("returns undefined without a range and resolves offset/length/suffix", () => {
    expect(resolveRange(undefined, 10)).toBeUndefined();
    expect(resolveRange({ offset: 2, length: 3 }, 10)).toEqual({ offset: 2, length: 3 });
    expect(resolveRange({ offset: 8 }, 10)).toEqual({ offset: 8, length: 2 });
    expect(resolveRange({ length: 4 }, 10)).toEqual({ offset: 0, length: 4 });
    expect(resolveRange({ offset: 8, length: 50 }, 10)).toEqual({ offset: 8, length: 2 });
    expect(resolveRange({ suffix: 3 }, 10)).toEqual({ offset: 7, length: 3 });
    expect(resolveRange({ suffix: 30 }, 10)).toEqual({ offset: 0, length: 10 });
  });

  it("rejects invalid windows", () => {
    expect(() => resolveRange({ offset: 11 }, 10)).toThrow(RangeError);
    expect(() => resolveRange({ offset: -1 }, 10)).toThrow(RangeError);
    expect(() => resolveRange({ offset: 1.5 }, 10)).toThrow(RangeError);
    expect(() => resolveRange({ length: -1 }, 10)).toThrow(RangeError);
    expect(() => resolveRange({ suffix: -1 }, 10)).toThrow(RangeError);
  });
});

describe("createLocalR2Adapter", () => {
  it("uses the Cloudflare per-file limit (50 MB) as default cap", () => {
    expect(MAX_OBJECT_BYTES).toBe(MAX_SOURCE_BYTE_SIZE_LIMIT);
    expect(MAX_OBJECT_BYTES).toBe(50 * 1024 * 1024);
  });

  it("stores binary streams byte-for-byte with an MD5 ETag like R2", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    const original = new Uint8Array(512).map((_, i) => i % 256);
    const put = await r2.put("uploads/a.bin", streamOf(original.slice(0, 1), original.slice(1)));
    expect(put?.size).toBe(512);
    expect(put?.etag).toBe(md5(original));
    expect(put?.httpEtag).toBe(`"${md5(original)}"`);
    expect(put?.uploaded).toBeInstanceOf(Date);

    const got = await r2.get("uploads/a.bin");
    expect(Buffer.compare(await readAll(got?.body as ReadableStream), Buffer.from(original))).toBe(
      0
    );
    expect(got?.etag).toBe(md5(original));
  });

  it("serves byte ranges from disk (offset/length and suffix)", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("doc.txt", "0123456789");

    const head = await r2.get("doc.txt", { range: { offset: 0, length: 4 } });
    expect(await head?.text()).toBe("0123");
    expect((head as unknown as { range: unknown }).range).toEqual({ offset: 0, length: 4 });
    expect(head?.size).toBe(10);

    const middle = await r2.get("doc.txt", { range: { offset: 3, length: 2 } });
    expect(await readAll(middle?.body as ReadableStream)).toEqual(Buffer.from("34"));

    const tail = await r2.get("doc.txt", { range: { suffix: 3 } });
    expect(new Uint8Array((await tail?.arrayBuffer()) as ArrayBuffer)).toEqual(
      new Uint8Array(Buffer.from("789"))
    );

    const empty = await r2.get("doc.txt", { range: { offset: 10 } });
    expect(await readAll(empty?.body as ReadableStream)).toHaveLength(0);
  });

  it("offers body helpers (bytes, json, blob, bodyUsed) and returns the same lazy stream", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("data.json", JSON.stringify({ ok: true }));
    const obj = (await r2.get("data.json")) as unknown as R2ObjectBody & {
      bytes: () => Promise<Uint8Array>;
    };
    expect(obj.bodyUsed).toBe(false);
    expect(await obj.json()).toEqual({ ok: true });
    expect(obj.bodyUsed).toBe(true);
    expect((await obj.bytes()).byteLength).toBe(11);
    expect(await (await obj.blob()).text()).toBe('{"ok":true}');

    const again = await r2.get("data.json");
    const first = again?.body;
    expect(again?.body).toBe(first);
    expect(again?.bodyUsed).toBe(true);
    await readAll(first as ReadableStream);
  });

  it("keeps httpMetadata and customMetadata and writes them as HTTP headers", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("a.pdf", new Uint8Array([1]), {
      httpMetadata: { contentType: "application/pdf", cacheControl: "private" },
      customMetadata: { sourceUrl: "https://example.org" }
    });
    const head = await r2.head("a.pdf");
    expect(head?.httpMetadata).toEqual({ contentType: "application/pdf", cacheControl: "private" });
    expect(head?.customMetadata).toEqual({ sourceUrl: "https://example.org" });
    const headers = new Headers();
    head?.writeHttpMetadata(headers);
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("cache-control")).toBe("private");
    expect(headers.get("content-language")).toBeNull();

    await r2.put("b.txt", "x", {
      httpMetadata: new Headers({ "content-type": "text/plain", "content-language": "de" })
    });
    expect((await r2.head("b.txt"))?.httpMetadata).toEqual({
      contentType: "text/plain",
      contentLanguage: "de"
    });
  });

  it("accepts strings, ArrayBuffer, typed views, Blob, null and other values", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("s.txt", "hello");
    await r2.put("ab.bin", new Uint8Array([1, 2, 3]).buffer);
    await r2.put("dv.bin", new DataView(new Uint16Array([0, 0xffff]).buffer));
    await r2.put("blob.txt", new Blob(["blob"]));
    await r2.put("null.bin", null);
    await r2.put("num.txt", 12345 as unknown as string);
    expect(await (await r2.get("s.txt"))?.text()).toBe("hello");
    expect((await r2.head("ab.bin"))?.size).toBe(3);
    expect((await r2.head("dv.bin"))?.size).toBe(4);
    expect(await (await r2.get("blob.txt"))?.text()).toBe("blob");
    expect((await r2.head("null.bin"))?.size).toBe(0);
    expect(await (await r2.get("num.txt"))?.text()).toBe("12345");
  });

  it("returns null for missing objects", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    expect(await r2.get("missing")).toBeNull();
    expect(await r2.head("missing")).toBeNull();
  });

  it("rebuilds lost or stale metadata from the file itself", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    // A file without sidecar, e.g. written by an older version of the adapter.
    mkdirSync(join(mediaDir, "legacy"), { recursive: true });
    writeFileSync(join(mediaDir, "legacy", "old.txt"), "legacy");
    const head = await r2.head("legacy/old.txt");
    expect(head?.etag).toBe(md5("legacy"));
    expect(existsSync(join(`${mediaDir}-meta`, "legacy", "old.txt.json"))).toBe(true);

    // File replaced behind the adapter's back: size mismatch triggers a rebuild.
    writeFileSync(join(mediaDir, "legacy", "old.txt"), "changed!");
    expect((await r2.head("legacy/old.txt"))?.etag).toBe(md5("changed!"));
  });

  it("rejects streams above the cap and leaves neither object nor temp file", async () => {
    const r2 = createLocalR2Adapter(mediaDir, 1024);
    await expect(
      r2.put("big.bin", streamOf(new Uint8Array(512), new Uint8Array(512), new Uint8Array(1)))
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await r2.head("big.bin")).toBeNull();
    expect(readdirSync(`${mediaDir}-tmp`)).toHaveLength(0);

    const exact = await r2.put("exact.bin", streamOf(new Uint8Array(1024)));
    expect(exact?.size).toBe(1024);
  });

  it("rejects buffered values above the cap", async () => {
    const r2 = createLocalR2Adapter(mediaDir, 4);
    await expect(r2.put("big.bin", new Uint8Array(5))).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(existsSync(join(mediaDir, "big.bin"))).toBe(false);
  });

  it("keeps the previous object when an overwrite fails midway (atomic rename)", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("doc.txt", "old");
    let sent = false;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new Uint8Array([1, 2, 3]));
          return;
        }
        controller.error(new Error("connection reset"));
      }
    });
    await expect(r2.put("doc.txt", failing)).rejects.toThrow("connection reset");
    expect(await (await r2.get("doc.txt"))?.text()).toBe("old");
  });

  it("refuses keys that escape the media directory", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    writeFileSync(join(dir, "escape.txt"), "secret");
    await expect(r2.put("../escape.txt", "pwned")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.put("a/../../escape.txt", "pwned")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.get("../escape.txt")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.head("../escape.txt")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.delete("../escape.txt")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.put("", "x")).rejects.toBeInstanceOf(RangeError);
    await expect(r2.put("a/..", "x")).rejects.toBeInstanceOf(RangeError);
    await r2.put("/inside/ok.txt", "ok");
    expect(existsSync(join(mediaDir, "inside", "ok.txt"))).toBe(true);
  });

  it("deletes objects together with their metadata", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    await r2.put("a.txt", "a");
    await r2.put("b.txt", "b");
    await r2.delete("a.txt");
    await r2.delete(["b.txt", "never-existed.txt"]);
    expect(await r2.head("a.txt")).toBeNull();
    expect(existsSync(join(`${mediaDir}-meta`, "b.txt.json"))).toBe(false);
  });

  it("lists with prefix, limit and cursor in key order", async () => {
    const r2 = createLocalR2Adapter(mediaDir);
    for (const key of ["n/3", "n/1", "n/2", "other/1"]) {
      await r2.put(key, key);
    }
    const page1 = await r2.list({ prefix: "n/", limit: 2 });
    expect(page1.objects.map((o) => o.key)).toEqual(["n/1", "n/2"]);
    expect(page1.truncated).toBe(true);
    const cursor = (page1 as { cursor?: string }).cursor;
    expect(cursor).toBe("n/2");

    const page2 = await r2.list({ prefix: "n/", limit: 2, ...(cursor ? { cursor } : {}) });
    expect(page2.objects.map((o) => o.key)).toEqual(["n/3"]);
    expect(page2.truncated).toBe(false);
    expect((page2 as { cursor?: string }).cursor).toBeUndefined();

    const all = await r2.list();
    expect(all.objects.map((o) => o.key)).toEqual(["n/1", "n/2", "n/3", "other/1"]);
    expect(all.objects[0]?.etag).toBe(md5("n/1"));
    expect(DEFAULT_LIST_LIMIT).toBe(1000);
    expect((await r2.list({ limit: 0 })).objects).toHaveLength(1);
  });
});
