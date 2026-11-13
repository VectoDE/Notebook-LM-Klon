import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BYOKKeyMetadataSchema,
  BYOKPutKeyBodySchema,
  BYOKRekeyResultSchema,
  ChatRequestBodySchema,
  EnqueueJobBodySchema,
  HealthResponseSchema,
  IngestChunksBodySchema,
  JobKindSchema,
  JobRecordSchema,
  JobStatusSchema,
  ProblemDetailsSchema,
  ProviderTypeSchema,
  SearchQueryBodySchema,
  SearchResponseSchema
} from "../index.js";

/**
 * OpenAPI-Abdeckung (Issue #150).
 *
 * Neue Route im Worker? Dann MUSS sie in docs/openapi.json eingetragen werden. Der Test
 * liest alle Routen direkt aus dem Quellcode von apps/worker/src (app.get/post/put/patch/
 * delete/on und router.*) und verlangt jede davon in der Spezifikation. Umgekehrt darf die
 * Spezifikation keine Route enthalten, die es im Code nicht gibt.
 *
 * Router, die unter einem Präfix eingehängt werden (app.route(prefix, router)), stehen
 * in MOUNT_PREFIX. Eine neue Datei mit relativen Pfaden ohne Eintrag dort lässt den Test
 * absichtlich fehlschlagen.
 */

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const WORKER_SRC = join(REPO_ROOT, "apps/worker/src");

const MOUNT_PREFIX: Readonly<Record<string, string>> = {
  "demo-routes.ts": "/api/v1/demo",
  "guest-magic-link-routes.ts": "/api/v1/auth",
  "passkey-routes.ts": "/api/v1/auth/passkey",
  "provider-routes.ts": "/api/v1"
};

/** Dateien mit Routen, die nicht zur API gehören (SPA-Fallback des Node-Servers). */
const NON_API_FILES = new Set(["node-server.ts"]);

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, SchemaObject>;
    responses: Record<string, ResponseObject>;
    securitySchemes: Record<string, unknown>;
  };
}
interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: unknown;
  responses?: Record<string, ResponseObject>;
}
interface ResponseObject {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}
interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaObject>;
  enum?: unknown[];
  [key: string]: unknown;
}

const spec = JSON.parse(readFileSync(join(REPO_ROOT, "docs/openapi.json"), "utf-8")) as OpenApiSpec;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function collectCodeRoutes(): { routes: Set<string>; problems: string[] } {
  const routes = new Set<string>();
  const problems: string[] = [];
  const literalCall = new RegExp(
    `\\b(?:app|router|rootApp)\\.(${HTTP_METHODS.join("|")})\\(\\s*"([^"]+)"`,
    "g"
  );
  const anyCall = new RegExp(`\\b(?:app|router|rootApp)\\.(?:${HTTP_METHODS.join("|")})\\(`, "g");
  const onCall = /\b(?:app|router|rootApp)\.on\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g;

  for (const file of listSourceFiles(WORKER_SRC)) {
    const name = file.slice(WORKER_SRC.length + 1).replaceAll("\\", "/");
    if (NON_API_FILES.has(name)) continue;
    const source = readFileSync(file, "utf-8");

    const literalCount = [...source.matchAll(literalCall)].length;
    const totalCount = [...source.matchAll(anyCall)].length;
    if (literalCount !== totalCount) {
      problems.push(
        `${name}: Route mit nicht-literalem Pfad, bitte als String-Literal registrieren.`
      );
    }

    const found: [string, string][] = [
      ...[...source.matchAll(literalCall)].map((m): [string, string] => [
        (m[1] ?? "").toUpperCase(),
        m[2] ?? ""
      ]),
      ...[...source.matchAll(onCall)].map((m): [string, string] => [m[1] ?? "", m[2] ?? ""])
    ];

    for (const [method, path] of found) {
      if (path.startsWith("/api/")) {
        routes.add(`${method} ${toOpenApiPath(path)}`);
      } else if (path.startsWith("/") && MOUNT_PREFIX[name] !== undefined) {
        routes.add(`${method} ${toOpenApiPath(`${MOUNT_PREFIX[name]}${path}`)}`);
      } else {
        problems.push(
          `${name}: Pfad '${path}' ist relativ, aber die Datei fehlt in MOUNT_PREFIX dieses Tests.`
        );
      }
    }
  }
  return { routes, problems };
}

function specRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
      routes.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes;
}

function resolveRef(ref: string): unknown {
  expect(ref.startsWith("#/"), `Nur lokale $ref erlaubt: ${ref}`).toBe(true);
  let node: unknown = spec;
  for (const part of ref.slice(2).split("/")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node;
}

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

function operations(): { route: string; path: string; method: string; op: OpenApiOperation }[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({
      route: `${method.toUpperCase()} ${path}`,
      path,
      method,
      op
    }))
  );
}

function resolvedResponse(op: OpenApiOperation, status: string): ResponseObject | undefined {
  const response = op.responses?.[status];
  if (response?.$ref !== undefined) return resolveRef(response.$ref) as ResponseObject;
  return response;
}

function propertyKeys(schemaName: string): string[] {
  return Object.keys(spec.components.schemas[schemaName]?.properties ?? {}).sort();
}

describe("docs/openapi.json: Struktur (OpenAPI 3.1)", () => {
  it("is an OpenAPI 3.1.x document with info, paths and components", () => {
    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(spec.info.title.length).toBeGreaterThan(0);
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(Object.keys(spec.components.schemas).length).toBeGreaterThan(0);
    expect(spec.components.securitySchemes).toHaveProperty("sessionCookie");
  });

  it("documents only /api/v1 paths with valid methods", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      expect(path.startsWith("/api/v1/"), `Pfad außerhalb /api/v1: ${path}`).toBe(true);
      for (const method of Object.keys(item)) {
        expect(HTTP_METHODS as readonly string[], `${method} ${path}`).toContain(
          method as HttpMethod
        );
      }
    }
  });

  it("gives every operation a unique operationId, tag, summary and a success response", () => {
    const ids = new Set<string>();
    for (const { route, op } of operations()) {
      expect(op.operationId, `${route}: operationId fehlt`).toBeTruthy();
      expect(ids.has(op.operationId ?? ""), `${route}: operationId doppelt`).toBe(false);
      ids.add(op.operationId ?? "");
      expect(op.tags?.length, `${route}: tags fehlen`).toBeGreaterThan(0);
      expect(op.summary, `${route}: summary fehlt`).toBeTruthy();
      const statuses = Object.keys(op.responses ?? {});
      expect(statuses.length, `${route}: responses fehlen`).toBeGreaterThan(0);
      expect(
        statuses.some((s) => /^2\d\d$/.test(s)),
        `${route}: keine 2xx-Antwort`
      ).toBe(true);
    }
  });

  it("declares every path parameter and resolves every $ref", () => {
    for (const { route, path, op } of operations()) {
      const declared = new Set(
        (op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name)
      );
      for (const match of path.matchAll(/\{([^}]+)\}/g)) {
        expect(declared.has(match[1] ?? ""), `${route}: Pfadparameter ${match[1]} fehlt`).toBe(
          true
        );
      }
    }
    for (const ref of collectRefs(spec)) {
      expect(resolveRef(ref), `$ref nicht auflösbar: ${ref}`).toBeDefined();
    }
  });

  it("documents RFC 9457 problem responses and 401 for protected operations", () => {
    const problem = spec.components.schemas.ProblemDetails;
    expect(problem?.required).toEqual(
      expect.arrayContaining(["type", "title", "status", "detail"])
    );
    for (const { route, op } of operations()) {
      const errorStatuses = Object.keys(op.responses ?? {}).filter((s) => Number(s) >= 400);
      expect(errorStatuses.length, `${route}: keine Fehlerantwort`).toBeGreaterThan(0);
      for (const status of errorStatuses) {
        const content = resolvedResponse(op, status)?.content ?? {};
        const isProblem =
          JSON.stringify(content["application/problem+json"]?.schema) ===
          JSON.stringify({ $ref: "#/components/schemas/ProblemDetails" });
        const isDocumentedException =
          (route === "POST /api/v1/keys/{provider}/test" ||
            route === "POST /api/v1/providers/custom/test") &&
          status === "422";
        expect(isProblem || isDocumentedException, `${route} ${status}: kein Problem-Schema`).toBe(
          true
        );
      }
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      if (!isPublic) {
        expect(op.responses, `${route}: 401 fehlt`).toHaveProperty("401");
      }
    }
  });

  it("includes the standalone RAG search endpoint with its request and response schema", () => {
    const op = spec.paths["/api/v1/notebooks/{id}/search"]?.post;
    expect(op?.operationId).toBe("searchNotebook");
    expect(JSON.stringify(op)).toContain("#/components/schemas/SearchRequest");
    expect(JSON.stringify(op)).toContain("#/components/schemas/SearchResponse");
  });
});

describe("docs/openapi.json: Abdeckung aller Worker-Routen", () => {
  const { routes, problems } = collectCodeRoutes();

  it("derives routes from the worker sources without unknown registration styles", () => {
    expect(problems).toEqual([]);
    expect(routes.size).toBeGreaterThanOrEqual(30);
    expect(routes.has("POST /api/v1/notebooks/{id}/search")).toBe(true);
    expect(routes.has("GET /api/v1/health")).toBe(true);
  });

  it("documents every registered route (new routes must be added to docs/openapi.json)", () => {
    const documented = specRoutes();
    const missing = [...routes].filter((route) => !documented.has(route)).sort();
    expect(missing, `In docs/openapi.json fehlen: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents no route that does not exist in the code", () => {
    const stale = [...specRoutes()].filter((route) => !routes.has(route)).sort();
    expect(stale, `Veraltet in docs/openapi.json: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("docs/openapi.json: Schemas bleiben synchron zu den Zod-Schemas", () => {
  const keys = (shape: Record<string, unknown>) => Object.keys(shape).sort();

  it("matches ProblemDetails, Health, Search, Chat and Ingest field names", () => {
    expect(propertyKeys("ProblemDetails")).toEqual(keys(ProblemDetailsSchema.shape));
    expect(propertyKeys("HealthResponse")).toEqual(keys(HealthResponseSchema.shape));
    expect(propertyKeys("SearchRequest")).toEqual(keys(SearchQueryBodySchema.shape));
    expect(propertyKeys("SearchResponse")).toEqual(keys(SearchResponseSchema.shape));
    expect(propertyKeys("ChatRequest")).toEqual(keys(ChatRequestBodySchema.shape));
    expect(propertyKeys("IngestChunksRequest")).toEqual(keys(IngestChunksBodySchema.shape));
  });

  it("matches job, BYOK and provider enums and fields", () => {
    expect(propertyKeys("JobRecord")).toEqual(keys(JobRecordSchema.shape));
    expect(propertyKeys("EnqueueJobRequest")).toEqual(keys(EnqueueJobBodySchema.shape));
    expect(propertyKeys("BYOKKeyMetadata")).toEqual(keys(BYOKKeyMetadataSchema.shape));
    expect(propertyKeys("BYOKPutKeyRequest")).toEqual(keys(BYOKPutKeyBodySchema.shape));
    expect(propertyKeys("BYOKRekeyResult")).toEqual(keys(BYOKRekeyResultSchema.shape));
    expect(spec.components.schemas.JobKind?.enum).toEqual([...JobKindSchema.options]);
    expect(spec.components.schemas.JobStatus?.enum).toEqual([...JobStatusSchema.options]);
    expect(spec.components.schemas.ProviderType?.enum).toEqual([...ProviderTypeSchema.options]);
  });
});
