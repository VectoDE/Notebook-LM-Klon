import { describe, expect, it } from "vitest";
import {
  cosineSimilarityFloat32,
  cosineSimilarityInt8,
  dequantizeInt8ToFloat32,
  dotProductFloat32,
  dotProductInt8,
  quantizeFloat32ToInt8
} from "../quantization.js";

describe("Symmetric int8 Scalar Quantization (Issue #95 / #17)", () => {
  it("handles edge cases: empty array and all zeros", () => {
    // Empty
    const empty = new Float32Array(0);
    const qEmpty = quantizeFloat32ToInt8(empty);
    expect(qEmpty.quantized.length).toBe(0);
    expect(qEmpty.scale).toBe(1.0);
    expect(dequantizeInt8ToFloat32(qEmpty.quantized, qEmpty.scale).length).toBe(0);
    expect(dotProductInt8(qEmpty.quantized, 1.0, qEmpty.quantized, 1.0)).toBe(0);
    expect(cosineSimilarityInt8(qEmpty.quantized, qEmpty.quantized)).toBe(0);
    expect(cosineSimilarityFloat32(empty, empty)).toBe(0);
    expect(dotProductFloat32(empty, empty)).toBe(0);

    // All zeros
    const zeros = new Float32Array([0, 0, 0, 0]);
    const qZeros = quantizeFloat32ToInt8(zeros);
    expect(qZeros.scale).toBe(1.0);
    expect(Array.from(qZeros.quantized)).toEqual([0, 0, 0, 0]);
    expect(cosineSimilarityInt8(qZeros.quantized, qZeros.quantized)).toBe(0);
    expect(cosineSimilarityFloat32(zeros, zeros)).toBe(0);

    // Non-finite values
    const nonFinite = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, 0]);
    const qNonFinite = quantizeFloat32ToInt8(nonFinite);
    expect(qNonFinite.scale).toBe(1.0);
    expect(Array.from(qNonFinite.quantized)).toEqual([0, 0, 0]);
  });

  it("quantizes and dequantizes vectors with accurate scaling and clamping", () => {
    const vec = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0]);
    const { quantized, scale } = quantizeFloat32ToInt8(vec);

    // maxAbs is 1.0 -> scale = 1.0 / 127 = ~0.007874
    expect(scale).toBeCloseTo(1.0 / 127.0, 6);
    expect(quantized[0]).toBe(-127);
    expect(quantized[2]).toBe(0);
    expect(quantized[4]).toBe(127);

    const restored = dequantizeInt8ToFloat32(quantized, scale);
    expect(restored[0]).toBeCloseTo(-1.0, 4);
    expect(restored[1]).toBeCloseTo(-0.5, 2);
    expect(restored[2]).toBe(0.0);
    expect(restored[3]).toBeCloseTo(0.5, 2);
    expect(restored[4]).toBeCloseTo(1.0, 4);
  });

  it("clamps values outside 8-bit range properly", () => {
    // If a vector has an extreme value and manual inputs
    const vec = new Float32Array([-127, 0, 127]);
    const { quantized, scale } = quantizeFloat32ToInt8(vec);
    expect(scale).toBe(1.0);
    expect(quantized[0]).toBe(-127);
    expect(quantized[2]).toBe(127);

    // Negative clamping beyond -128
    const negVec = new Float32Array([-128.5, 127]);
    const qNeg = quantizeFloat32ToInt8(negVec);
    expect(qNeg.quantized[0]).toBe(-127);
  });

  it("computes accurate dot products and cosine similarities with different vector lengths", () => {
    const a = new Float32Array([1.0, 2.0, 3.0]);
    const b = new Float32Array([4.0, 5.0, 6.0]);

    const qA = quantizeFloat32ToInt8(a);
    const qB = quantizeFloat32ToInt8(b);

    const f32Dot = dotProductFloat32(a, b);
    const int8Dot = dotProductInt8(qA.quantized, qA.scale, qB.quantized, qB.scale);
    expect(f32Dot).toBe(32); // 1*4 + 2*5 + 3*6 = 4+10+18 = 32
    expect(int8Dot).toBeCloseTo(32, 1);

    const f32Cos = cosineSimilarityFloat32(a, b);
    const int8Cos = cosineSimilarityInt8(qA.quantized, qB.quantized);
    expect(f32Cos).toBeCloseTo(int8Cos, 2);

    // Mismatched lengths
    const c = new Float32Array([1.0, 2.0]);
    expect(dotProductFloat32(a, c)).toBe(5); // 1*1 + 2*2 = 5
    expect(cosineSimilarityFloat32(a, c)).toBeGreaterThan(0);
    expect(dotProductInt8(new Int8Array([1]), 1.0, new Int8Array([]), 1.0)).toBe(0);
  });

  it("achieves cosine similarity error < 0.005 on 768-dimensional synthetic embedding vectors", () => {
    // Generate deterministic pseudo-random 768d unit vectors
    const DIM = 768;
    const NUM_PAIRS = 50;

    let seed = 42;
    function pseudoRandom(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return (seed / 4294967296) * 2 - 1; // [-1, 1]
    }

    function createRandomNormalizedVector(dim: number): Float32Array {
      const vec = new Float32Array(dim);
      let norm = 0;
      for (let i = 0; i < dim; i++) {
        vec[i] = pseudoRandom();
        norm += (vec[i] ?? 0) * (vec[i] ?? 0);
      }
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) {
        vec[i] = (vec[i] ?? 0) / norm;
      }
      return vec;
    }

    let maxError = 0;
    let totalError = 0;

    for (let p = 0; p < NUM_PAIRS; p++) {
      const v1 = createRandomNormalizedVector(DIM);
      const v2 = createRandomNormalizedVector(DIM);

      const f32Cos = cosineSimilarityFloat32(v1, v2);

      const q1 = quantizeFloat32ToInt8(v1);
      const q2 = quantizeFloat32ToInt8(v2);

      const int8Cos = cosineSimilarityInt8(q1.quantized, q2.quantized);

      const error = Math.abs(f32Cos - int8Cos);
      if (error > maxError) maxError = error;
      totalError += error;

      // Every single pair must have cosine error < 0.005
      expect(error).toBeLessThan(0.005);
    }

    const avgError = totalError / NUM_PAIRS;
    expect(avgError).toBeLessThan(0.002);
  });

  it("achieves Recall@10 >= 0.98 on a synthetic 768d corpus search", () => {
    const DIM = 768;
    const CORPUS_SIZE = 200;
    const NUM_QUERIES = 20;
    const K = 10;

    let seed = 1337;
    function pseudoRandom(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return (seed / 4294967296) * 2 - 1;
    }

    function createRandomNormalizedVector(dim: number): Float32Array {
      const vec = new Float32Array(dim);
      let norm = 0;
      for (let i = 0; i < dim; i++) {
        vec[i] = pseudoRandom();
        norm += (vec[i] ?? 0) * (vec[i] ?? 0);
      }
      norm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) {
        vec[i] = (vec[i] ?? 0) / norm;
      }
      return vec;
    }

    // Corpus of 200 768d embeddings
    const corpusF32: Float32Array[] = [];
    const corpusInt8: { quantized: Int8Array; scale: number }[] = [];

    for (let i = 0; i < CORPUS_SIZE; i++) {
      const vec = createRandomNormalizedVector(DIM);
      corpusF32.push(vec);
      corpusInt8.push(quantizeFloat32ToInt8(vec));
    }

    let hits = 0;
    const totalPossible = NUM_QUERIES * K;

    for (let q = 0; q < NUM_QUERIES; q++) {
      const queryF32 = createRandomNormalizedVector(DIM);
      const queryInt8 = quantizeFloat32ToInt8(queryF32);

      // 1. Float32 ground truth top-K
      const f32Scores = corpusF32.map((doc, idx) => ({
        idx,
        score: cosineSimilarityFloat32(queryF32, doc)
      }));
      f32Scores.sort((a, b) => b.score - a.score);
      const topKGroundTruth = new Set(f32Scores.slice(0, K).map((item) => item.idx));

      // 2. Int8 search top-K
      const int8Scores = corpusInt8.map((doc, idx) => ({
        idx,
        score: cosineSimilarityInt8(queryInt8.quantized, doc.quantized)
      }));
      int8Scores.sort((a, b) => b.score - a.score);
      const topKInt8 = int8Scores.slice(0, K).map((item) => item.idx);

      for (const idx of topKInt8) {
        if (topKGroundTruth.has(idx)) {
          hits++;
        }
      }
    }

    const recall = hits / totalPossible;
    // Acceptance criterion: Recall@10 >= 0.98
    expect(recall).toBeGreaterThanOrEqual(0.98);
  });
});
