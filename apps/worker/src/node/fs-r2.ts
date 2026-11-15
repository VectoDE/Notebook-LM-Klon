import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { MAX_SOURCE_BYTE_SIZE_LIMIT } from "../sources-upload.js";

/**
 * Object storage for the Node runtime with the R2 surface the app uses: binary streams,
 * byte ranges, HTTP/custom metadata, MD5 ETags (as R2 for single-part uploads), cursor
 * listing and the same per-object size limit as the Cloudflare path (50 MB per source).
 *
 * Layout under the data directory:
 *   media/<key>            object bytes
 *   media-meta/<key>.json  metadata sidecar (etag, size, uploaded, http/custom metadata)
 *   media-tmp/             partial uploads, renamed into place only when complete
 */

/** Upper bound for a single object, identical to the per-file upload limit on Cloudflare. */
export const MAX_OBJECT_BYTES = MAX_SOURCE_BYTE_SIZE_LIMIT;

/** Default page size of list(), as on R2. */
export const DEFAULT_LIST_LIMIT = 1000;

export class ObjectTooLargeError extends Error {
  constructor(limit: number) {
    super(`Objekt überschreitet die Obergrenze von ${limit} Bytes.`);
    this.name = "ObjectTooLargeError";
  }
}

export interface StoredHttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: string;
}

interface StoredMeta {
  key: string;
  size: number;
  etag: string;
  uploaded: string;
  httpMetadata: StoredHttpMetadata;
  customMetadata: Record<string, string>;
}

interface RangeRequest {
  offset?: number;
  length?: number;
  suffix?: number;
}

interface PutOptions {
  httpMetadata?: StoredHttpMetadata | Headers;
  customMetadata?: Record<string, string>;
}

const HTTP_FIELDS: Array<[keyof StoredHttpMetadata, string]> = [
  ["contentType", "content-type"],
  ["contentLanguage", "content-language"],
  ["contentDisposition", "content-disposition"],
  ["contentEncoding", "content-encoding"],
  ["cacheControl", "cache-control"],
  ["cacheExpiry", "expires"]
];

function normalizeHttpMetadata(input: PutOptions["httpMetadata"]): StoredHttpMetadata {
  const out: StoredHttpMetadata = {};
  if (!input) {
    return out;
  }
  for (const [field, header] of HTTP_FIELDS) {
    const value = input instanceof Headers ? input.get(header) : input[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = value;
    }
  }
  return out;
}

/** Resolves an R2 range request against the object size to an inclusive byte window. */
export function resolveRange(
  range: RangeRequest | undefined,
  size: number
): { offset: number; length: number } | undefined {
  if (!range) {
    return undefined;
  }
  if (range.suffix !== undefined) {
    if (!Number.isInteger(range.suffix) || range.suffix < 0) {
      throw new RangeError("Ungültiger Bereich: suffix muss eine ganze Zahl >= 0 sein.");
    }
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > size) {
    throw new RangeError(`Ungültiger Bereich: offset ${offset} liegt außerhalb von 0..${size}.`);
  }
  const requested = range.length ?? size - offset;
  if (!Number.isInteger(requested) || requested < 0) {
    throw new RangeError("Ungültiger Bereich: length muss eine ganze Zahl >= 0 sein.");
  }
  return { offset, length: Math.min(requested, size - offset) };
}

async function md5OfFile(filePath: string): Promise<string> {
  const hash = createHash("md5");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function createLocalR2Adapter(
  mediaDir: string,
  maxObjectBytes: number = MAX_OBJECT_BYTES
): R2Bucket {
  const rootDir = resolve(mediaDir);
  const metaDir = `${rootDir}-meta`;
  const tmpDir = `${rootDir}-tmp`;
  for (const dir of [rootDir, metaDir, tmpDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // Keys come from callers (R2 keys are opaque strings). Resolve them against the
  // media root and refuse anything that lands outside it (`../`, absolute paths,
  // other drives) or on the root itself.
  const objectPath = (key: string): string => {
    const safeKey = key.replace(/^[/\\]+/, "");
    const target = resolve(rootDir, safeKey);
    if (!target.startsWith(`${rootDir}${sep}`)) {
      throw new RangeError(`Ungültiger Objektschlüssel: '${key}'.`);
    }
    return target;
  };
  const metaPath = (filePath: string): string =>
    `${join(metaDir, filePath.slice(rootDir.length + 1))}.json`;
  const keyOf = (filePath: string): string =>
    filePath
      .slice(rootDir.length + 1)
      .split(sep)
      .join("/");

  const readMeta = async (filePath: string): Promise<StoredMeta | null> => {
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    try {
      const meta = JSON.parse(await readFile(metaPath(filePath), "utf8")) as StoredMeta;
      if (meta.size === info.size) {
        return meta;
      }
    } catch {
      // No or unreadable sidecar (e.g. file written by an older version): rebuild below.
    }
    const rebuilt: StoredMeta = {
      key: keyOf(filePath),
      size: info.size,
      etag: await md5OfFile(filePath),
      uploaded: info.mtime.toISOString(),
      httpMetadata: {},
      customMetadata: {}
    };
    await writeMeta(filePath, rebuilt);
    return rebuilt;
  };

  const writeMeta = async (filePath: string, meta: StoredMeta): Promise<void> => {
    const target = metaPath(filePath);
    mkdirSync(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(meta));
  };

  const toObject = (meta: StoredMeta, range?: { offset: number; length: number }) => ({
    key: meta.key,
    version: meta.etag,
    size: meta.size,
    etag: meta.etag,
    httpEtag: `"${meta.etag}"`,
    uploaded: new Date(meta.uploaded),
    httpMetadata: { ...meta.httpMetadata },
    customMetadata: { ...meta.customMetadata },
    checksums: { md5: Buffer.from(meta.etag, "hex").buffer },
    storageClass: "Standard",
    ...(range ? { range } : {}),
    writeHttpMetadata: (headers: Headers) => {
      for (const [field, header] of HTTP_FIELDS) {
        const value = meta.httpMetadata[field];
        if (value !== undefined) {
          headers.set(header, value);
        }
      }
    }
  });

  const readWindow = async (filePath: string, offset: number, length: number) => {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  };

  /** Streams `value` into a temp file (size cap and MD5 on the fly), then renames it in place. */
  const writeAtomically = async (
    filePath: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null
  ): Promise<{ size: number; etag: string }> => {
    const source = await toNodeReadable(value, maxObjectBytes);
    const tmpPath = join(tmpDir, randomUUID());
    const hash = createHash("md5");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength;
        if (size > maxObjectBytes) {
          callback(new ObjectTooLargeError(maxObjectBytes));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    try {
      await pipeline(source, meter, createWriteStream(tmpPath));
      mkdirSync(dirname(filePath), { recursive: true });
      await rename(tmpPath, filePath);
    } catch (err) {
      await rm(tmpPath, { force: true, maxRetries: 5, retryDelay: 50 });
      throw err;
    }
    return { size, etag: hash.digest("hex") };
  };

  const listAll = async (): Promise<string[]> => {
    const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => keyOf(join(entry.parentPath, entry.name)))
      .sort();
  };

  return {
    head: async (key: string) => {
      const meta = await readMeta(objectPath(key));
      return meta ? toObject(meta) : null;
    },
    get: async (key: string, options?: { range?: RangeRequest }) => {
      const filePath = objectPath(key);
      const meta = await readMeta(filePath);
      if (!meta) {
        return null;
      }
      const range = resolveRange(options?.range, meta.size);
      const window = range ?? { offset: 0, length: meta.size };
      let stream: ReadableStream | undefined;
      let bodyUsed = false;
      const readBytes = async (): Promise<Buffer> => {
        bodyUsed = true;
        return readWindow(filePath, window.offset, window.length);
      };
      return {
        ...toObject(meta, range),
        // Opened lazily, so a caller that only reads metadata leaves no file handle open.
        get body(): ReadableStream {
          if (!stream) {
            bodyUsed = true;
            stream =
              window.length === 0
                ? new ReadableStream({ start: (controller) => controller.close() })
                : (Readable.toWeb(
                    createReadStream(filePath, {
                      start: window.offset,
                      end: window.offset + window.length - 1
                    })
                  ) as unknown as ReadableStream);
          }
          return stream;
        },
        get bodyUsed(): boolean {
          return bodyUsed;
        },
        arrayBuffer: async () => {
          const data = await readBytes();
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
        bytes: async () => new Uint8Array(await readBytes()),
        text: async () => (await readBytes()).toString("utf8"),
        json: async () => JSON.parse((await readBytes()).toString("utf8")),
        blob: async () => new Blob([await readBytes()])
      };
    },
    put: async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: PutOptions
    ) => {
      const filePath = objectPath(key);
      const { size, etag } = await writeAtomically(filePath, value);
      const meta: StoredMeta = {
        key: keyOf(filePath),
        size,
        etag,
        uploaded: new Date().toISOString(),
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        customMetadata: { ...(options?.customMetadata ?? {}) }
      };
      await writeMeta(filePath, meta);
      return toObject(meta);
    },
    delete: async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const paths = keyList.map(objectPath);
      for (const filePath of paths) {
        await rm(filePath, { force: true });
        await rm(metaPath(filePath), { force: true });
      }
    },
    list: async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
      const prefix = options?.prefix ?? "";
      const limit = Math.max(1, Math.min(options?.limit ?? DEFAULT_LIST_LIMIT, DEFAULT_LIST_LIMIT));
      const cursor = options?.cursor;
      const keys = (await listAll()).filter(
        (key) => key.startsWith(prefix) && (cursor === undefined || key > cursor)
      );
      const page = keys.slice(0, limit);
      // An object deleted between listing and reading is skipped, as on R2.
      const metas = await Promise.all(page.map((key) => readMeta(objectPath(key))));
      const objects = metas
        .filter((meta): meta is StoredMeta => meta !== null)
        .map((m) => toObject(m));
      const truncated = keys.length > limit;
      return {
        objects,
        truncated,
        ...(truncated ? { cursor: page[page.length - 1] } : {}),
        delimitedPrefixes: []
      };
    }
  } as unknown as R2Bucket;
}

async function toNodeReadable(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
  maxObjectBytes: number
): Promise<Readable> {
  if (value instanceof ReadableStream) {
    return Readable.fromWeb(value as unknown as NodeWebReadableStream<Uint8Array>);
  }
  let buf: Buffer;
  if (value === null) {
    buf = Buffer.alloc(0);
  } else if (typeof value === "string") {
    buf = Buffer.from(value, "utf8");
  } else if (ArrayBuffer.isView(value)) {
    buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    buf = Buffer.from(value);
  } else if (typeof (value as Blob).arrayBuffer === "function") {
    buf = Buffer.from(await (value as Blob).arrayBuffer());
  } else {
    buf = Buffer.from(String(value), "utf8");
  }
  if (buf.byteLength > maxObjectBytes) {
    throw new ObjectTooLargeError(maxObjectBytes);
  }
  return Readable.from([buf]);
}
