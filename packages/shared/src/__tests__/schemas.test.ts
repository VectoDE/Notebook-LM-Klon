import { describe, expect, it } from "vitest";
import {
  DeploymentProfileSchema,
  HealthResponseSchema,
  ProblemDetailsSchema,
  WORKSPACE_VERSION,
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
});
