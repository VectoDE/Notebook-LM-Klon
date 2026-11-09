import { describe, expect, it } from "vitest";
import {
  DeploymentProfileSchema,
  HealthResponseSchema,
  ProblemDetailsSchema,
  SearchQueryBodySchema,
  SearchResponseSchema,
  WORKSPACE_VERSION,
  combineWithRrf,
  createProblemDetails
} from "../index.js";

describe("Base Zod Schemas & RFC 9457 ProblemDetails", () => {
  it("validates DeploymentProfileSchema for demo and full profiles", () => {
    expect(DeploymentProfileSchema.parse("demo")).toBe("demo");
    expect(DeploymentProfileSchema.parse("full")).toBe("full");
    expect(() => DeploymentProfileSchema.parse("invalid")).toThrow();
  });

  it("validates a well-formed HealthResponseSchema payload", () => {
    const validPayload = {
      status: "ok" as const,
      version: WORKSPACE_VERSION,
      profile: "demo" as const,
      timestamp: "2026-11-09T14:00:00.000Z",
      services: {
        d1: "ok" as const,
        r2: "ok" as const,
        durableObjects: "ok" as const
      }
    };

    const parsed = HealthResponseSchema.parse(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("rejects an invalid HealthResponseSchema payload", () => {
    const invalidPayload = {
      status: "broken",
      version: "",
      profile: "demo",
      timestamp: "not-a-timestamp",
      services: {
        d1: "ok",
        r2: "ok",
        durableObjects: "ok"
      }
    };

    const result = HealthResponseSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("validates and constructs RFC 9457 ProblemDetails objects", () => {
    const problem = createProblemDetails({
      status: 422,
      title: "Unprocessable Content",
      detail: "Das Feld 'title' darf nicht leer sein.",
      type: "https://notebooklm-klon.dev/problems/validation-error",
      instance: "/api/v1/notebooks",
      code: "VALIDATION_ERROR",
      errors: [{ field: "title", message: "Required" }]
    });

    const parsed = ProblemDetailsSchema.parse(problem);
    expect(parsed.status).toBe(422);
    expect(parsed.title).toBe("Unprocessable Content");
    expect(parsed.detail).toContain("darf nicht leer sein");
    expect(parsed.type).toBe("https://notebooklm-klon.dev/problems/validation-error");
    expect(parsed.code).toBe("VALIDATION_ERROR");
    expect(parsed.errors).toHaveLength(1);
  });

  it("applies default type 'about:blank' when type is omitted in createProblemDetails", () => {
    const problem = createProblemDetails({
      status: 404,
      title: "Not Found",
      detail: "Das angeforderte Notebook wurde nicht gefunden."
    });

    expect(problem.type).toBe("about:blank");
    expect(ProblemDetailsSchema.parse(problem).status).toBe(404);
  });

  it("validates SearchQueryBodySchema and SearchResponseSchema (Issue #18, #99, #100)", () => {
    const validQuery = {
      query: "Künstliche Intelligenz und RAG",
      limit: 5,
      mode: "hybrid" as const,
      sourceIds: ["src_1", "src_2"]
    };

    const parsedQuery = SearchQueryBodySchema.parse(validQuery);
    expect(parsedQuery.limit).toBe(5);
    expect(parsedQuery.mode).toBe("hybrid");

    // Defaults test
    const defaultQuery = SearchQueryBodySchema.parse({ query: "Test Suche" });
    expect(defaultQuery.limit).toBe(10);
    expect(defaultQuery.mode).toBe("hybrid");

    // Invalid limit / empty query
    expect(() => SearchQueryBodySchema.parse({ query: "   " })).toThrow();
    expect(() => SearchQueryBodySchema.parse({ query: "Test", limit: 0 })).toThrow();
    expect(() => SearchQueryBodySchema.parse({ query: "Test", limit: 200 })).toThrow();
    expect(() => SearchQueryBodySchema.parse({ query: "Test", mode: "invalid" })).toThrow();

    // Valid search response
    const validResponse = {
      notebookId: "nb_123",
      query: "Test",
      mode: "hybrid" as const,
      totalResults: 1,
      latencyMs: 3.5,
      results: [
        {
          chunkId: "chk_1",
          sourceId: "src_1",
          sourceTitle: "Dokument.pdf",
          page: 1,
          startOffset: 0,
          endOffset: 100,
          score: 0.032,
          snippet: "Relevanter Textausschnitt...",
          vectorRank: 1,
          ftsRank: 2,
          vectorScore: 0.89,
          ftsScore: -2.34
        }
      ]
    };
    const parsedResponse = SearchResponseSchema.parse(validResponse);
    expect(parsedResponse.results[0]?.chunkId).toBe("chk_1");
  });

  it("combines result lists with Reciprocal Rank Fusion (Sub-Issue #99)", () => {
    interface TestItem {
      id: string;
      title: string;
      scoreVal?: number;
    }

    const vectorList: TestItem[] = [
      { id: "A", title: "Doc A", scoreVal: 0.95 },
      { id: "B", title: "Doc B", scoreVal: 0.85 },
      { id: "C", title: "Doc C", scoreVal: 0.75 }
    ];

    const ftsList: TestItem[] = [
      { id: "B", title: "Doc B", scoreVal: -1.0 },
      { id: "D", title: "Doc D", scoreVal: -2.0 },
      { id: "A", title: "Doc A", scoreVal: -3.0 }
    ];

    const combined = combineWithRrf(vectorList, ftsList, (x) => x.id, {
      k: 60,
      weight1: 1.0,
      weight2: 1.0,
      getScore1: (x) => x.scoreVal ?? 0,
      getScore2: (x) => x.scoreVal ?? 0
    });

    // Rank 1: Doc B appears in both (rank 2 in vec, rank 1 in fts) -> 1/(60+2) + 1/(60+1) = 1/62 + 1/61 = 0.016129 + 0.016393 = ~0.0325
    // Rank 2: Doc A appears in both (rank 1 in vec, rank 3 in fts) -> 1/(60+1) + 1/(60+3) = 1/61 + 1/63 = 0.016393 + 0.015873 = ~0.0322
    expect(combined[0]?.item.id).toBe("B");
    expect(combined[0]?.rank1).toBe(2);
    expect(combined[0]?.rank2).toBe(1);
    expect(combined[0]?.score1).toBe(0.85);
    expect(combined[0]?.score2).toBe(-1.0);

    expect(combined[1]?.item.id).toBe("A");
    expect(combined[1]?.rank1).toBe(1);
    expect(combined[1]?.rank2).toBe(3);

    // Doc C only in vec
    const docC = combined.find((x) => x.item.id === "C");
    expect(docC?.rank1).toBe(3);
    expect(docC?.rank2).toBeUndefined();

    // Doc D only in fts
    const docD = combined.find((x) => x.item.id === "D");
    expect(docD?.rank1).toBeUndefined();
    expect(docD?.rank2).toBe(2);

    // Test with custom weights and default options (no getScore1 / no getScore2)
    const defaultRrf = combineWithRrf(vectorList, ftsList, (x) => x.id);
    expect(defaultRrf).toHaveLength(4);
    expect(defaultRrf[0]?.item.id).toBe("B");
    expect(defaultRrf[0]?.score1).toBeUndefined();
    expect(defaultRrf[0]?.score2).toBeUndefined();
  });
});
