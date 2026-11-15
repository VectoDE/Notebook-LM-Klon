import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_TOKENS, chunkText } from "../chunker.js";
import {
  MAX_CITATION_RANGE_SPAN,
  extractCitationIndices,
  validateAndCleanCitations
} from "../citation-parser.js";
import {
  cosineSimilarityFloat32,
  cosineSimilarityInt8,
  dequantizeInt8ToFloat32,
  quantizeFloat32ToInt8
} from "../quantization.js";

/** Fixed seed and 1,000 runs per property, so failures are reproducible in CI. */
const RUNS = { numRuns: 1000, seed: 20261113 } as const;

const word = fc.stringMatching(/^[A-Za-zÄÖÜäöüß0-9]{1,12}$/);
const separator = fc.constantFrom(" ", "  ", "\n", "\n\n", ". ", "! ", "? ", "\t");
const document = fc
  .array(fc.tuple(word, separator), { minLength: 1, maxLength: 400 })
  .map((parts) => parts.map(([w, s]) => w + s).join(""));

describe("fuzz: chunkText", () => {
  it("keeps every chunk inside the source text, in order and within the token budget", () => {
    fc.assert(
      fc.property(
        document,
        fc.integer({ min: 20, max: DEFAULT_MAX_TOKENS }),
        fc.integer({ min: 0, max: 15 }),
        (text, maxTokens, overlapTokens) => {
          const chunks = chunkText({ text, maxTokens, overlapTokens });
          if (text.trim().length === 0) {
            expect(chunks).toEqual([]);
            return;
          }
          expect(chunks.length).toBeGreaterThan(0);
          let previousStart = -1;
          chunks.forEach((chunk, i) => {
            expect(chunk.chunkIndex).toBe(i);
            expect(chunk.text.trim().length).toBeGreaterThan(0);
            expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens);
            const start = chunk.startOffset as number;
            const end = chunk.endOffset as number;
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeLessThanOrEqual(text.length);
            expect(start).toBeLessThan(end);
            expect(start).toBeGreaterThanOrEqual(previousStart);
            previousStart = start;
          });
          // Coverage: the first chunk starts at the first word, the last ends at the last word.
          const firstWord = text.search(/\S/);
          const lastWordEnd = text.trimEnd().length;
          expect(chunks[0]?.startOffset).toBeLessThanOrEqual(firstWord);
          expect(chunks.at(-1)?.endOffset).toBeGreaterThanOrEqual(lastWordEnd);
        }
      ),
      RUNS
    );
  });
});

describe("fuzz: citation parser", () => {
  const citationText = fc
    .array(
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.nat({ max: 60 }).map((n) => `[${n}]`),
        fc.tuple(fc.nat({ max: 60 }), fc.nat({ max: 60 })).map(([a, b]) => `[${a}, ${b}]`),
        fc.tuple(fc.nat({ max: 60 }), fc.nat({ max: 60 })).map(([a, b]) => `[${a}-${b}]`),
        fc.constantFrom("[", "]", "[-]", "[,]", "[ 1 ,, 2 ]", "[1-]", "[999999999999]")
      ),
      { maxLength: 30 }
    )
    .map((parts) => parts.join(" "));

  const sources = fc
    .uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 15 })
    .map((indices) =>
      indices.map((index) => ({
        index,
        chunkId: `c${index}`,
        sourceId: `s${index}`,
        sourceTitle: `Quelle ${index}`,
        snippet: `Ausschnitt ${index}`
      }))
    );

  it("splits every index into valid or hallucinated and never keeps an unknown citation", () => {
    fc.assert(
      fc.property(citationText, sources, (text, available) => {
        const known = new Set(available.map((s) => s.index));
        const { indices } = extractCitationIndices(text);
        const result = validateAndCleanCitations(text, available);

        for (const index of result.validIndices) {
          expect(known.has(index)).toBe(true);
        }
        for (const index of result.hallucinatedIndices) {
          expect(known.has(index)).toBe(false);
        }
        expect(
          [...result.validIndices, ...result.hallucinatedIndices].sort((a, b) => a - b)
        ).toEqual(indices);
        expect(result.citations.map((c) => c.index)).toEqual(result.validIndices);

        // After cleaning, every remaining marker points to a known source.
        for (const index of extractCitationIndices(result.cleanedText).indices) {
          expect(known.has(index)).toBe(true);
        }
      }),
      RUNS
    );
  });

  it("ignores ranges wider than the allowed span instead of expanding them", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: MAX_CITATION_RANGE_SPAN, max: 2_000_000_000 }),
        (start, width) => {
          const text = `Satz [${start}-${start + width}] Ende`;
          expect(extractCitationIndices(text).indices).toEqual([]);
          const result = validateAndCleanCitations(text, []);
          expect(result.hallucinatedIndices).toEqual([]);
          expect(result.cleanedText).toBe("Satz Ende");
        }
      ),
      RUNS
    );
  });
});

describe("fuzz: int8 quantization", () => {
  const vector = fc
    .array(fc.float({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }), {
      minLength: 1,
      maxLength: 768
    })
    .map((values) => Float32Array.from(values));

  it("stays in [-127, 127], keeps the length and restores each value within half a step", () => {
    fc.assert(
      fc.property(vector, (input) => {
        const { quantized, scale } = quantizeFloat32ToInt8(input);
        expect(quantized.length).toBe(input.length);
        expect(scale).toBeGreaterThan(0);
        for (const q of quantized) {
          expect(q).toBeGreaterThanOrEqual(-127);
          expect(q).toBeLessThanOrEqual(127);
        }
        const restored = dequantizeInt8ToFloat32(quantized, scale);
        for (let i = 0; i < input.length; i++) {
          expect(Math.abs((restored[i] as number) - (input[i] as number))).toBeLessThanOrEqual(
            scale / 2 + 1e-3
          );
        }
      }),
      RUNS
    );
  });

  it("keeps cosine similarity of 768d vectors close to the float32 value", () => {
    const dense = fc
      .array(fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: 768,
        maxLength: 768
      })
      .map((values) => Float32Array.from(values))
      .filter((v) => v.some((x) => Math.abs(x) > 0.1));

    fc.assert(
      fc.property(dense, dense, (a, b) => {
        const exact = cosineSimilarityFloat32(a, b);
        const approx = cosineSimilarityInt8(
          quantizeFloat32ToInt8(a).quantized,
          quantizeFloat32ToInt8(b).quantized
        );
        expect(Number.isFinite(approx)).toBe(true);
        expect(Math.abs(approx - exact)).toBeLessThan(0.05);
      }),
      RUNS
    );
  });
});
