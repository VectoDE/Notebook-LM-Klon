import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ProblemDetailsSchema, createProblemDetails, inspectTextEncoding } from "../index.js";

describe("Property-Based & Fuzz Testing – Shared Schemas & Encoding (fast-check, Decision #107)", () => {
  it("fuzzes inspectTextEncoding across arbitrary ASCII/Unicode text without false positives", () => {
    fc.assert(
      fc.property(
        fc
          .string()
          .filter(
            (s) =>
              !s.includes("\uFEFF") &&
              !s.includes("\uFFFD") &&
              !/\p{Extended_Pictographic}/u.test(s) &&
              !/\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]/.test(s)
          ),
        (validText) => {
          const bytes = new TextEncoder().encode(validText);
          const result = inspectTextEncoding(bytes);
          expect(result.valid).toBe(true);
          expect(result.hasBom).toBe(false);
          expect(result.hasReplacementChar).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("validates RFC 9457 ProblemDetailsSchema across arbitrary status codes, titles, and details", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 40 }).map((s) => `ERR_${s.replace(/\W/g, "_")}`),
        (status, title, detail, code) => {
          const problem = createProblemDetails({
            status,
            title,
            detail,
            code,
            instance: "/api/v1/test"
          });
          const parsed = ProblemDetailsSchema.parse(problem);
          expect(parsed.status).toBe(status);
          expect(parsed.title).toBe(title);
          expect(parsed.detail).toBe(detail);
        }
      ),
      { numRuns: 150 }
    );
  });
});
