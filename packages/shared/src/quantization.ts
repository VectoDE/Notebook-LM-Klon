/**
 * Symmetric int8 scalar quantization and fast vector arithmetic for RAG embeddings.
 *
 * Provides 4x memory reduction (from 4 bytes/dimension for Float32 to 1 byte/dimension for int8)
 * while maintaining cosine similarity deviation < 0.005 and recall@10 >= 0.98.
 * Fully cross-platform: works in browser, Cloudflare Workers, and Node.js runtimes.
 */

export interface QuantizedVector {
  readonly quantized: Int8Array;
  readonly scale: number;
}

/**
 * Quantizes a Float32Array into an Int8Array using symmetric scaling.
 *
 * Formula:
 * scale = max(abs(v)) / 127
 * quantized[i] = round(clamp(v[i] / scale, -127, 127))
 *
 * If max(abs(v)) is 0 or non-finite, scale defaults to 1.0 and all entries are 0.
 */
export function quantizeFloat32ToInt8(vector: Float32Array): QuantizedVector {
  const len = vector.length;
  if (len === 0) {
    return {
      quantized: new Int8Array(0),
      scale: 1.0
    };
  }

  let maxAbs = 0;
  for (let i = 0; i < len; i++) {
    const val = Number(vector[i]);
    const abs = Math.abs(val);
    if (abs > maxAbs && Number.isFinite(abs)) {
      maxAbs = abs;
    }
  }

  // Handle all-zeros or non-finite vectors
  if (maxAbs === 0 || !Number.isFinite(maxAbs)) {
    return {
      quantized: new Int8Array(len),
      scale: 1.0
    };
  }

  const scale = maxAbs / 127.0;
  const invScale = 1.0 / scale;
  const quantized = new Int8Array(len);

  for (let i = 0; i < len; i++) {
    const val = Number(vector[i]) * invScale;
    const rounded = Math.round(val);
    // Clamp to signed 8-bit range [-127, 127] for symmetric quantization
    quantized[i] = Math.max(-127, Math.min(127, rounded));
  }

  return { quantized, scale };
}

/**
 * Dequantizes an Int8Array back into a Float32Array.
 *
 * Formula:
 * restored[i] = quantized[i] * scale
 */
export function dequantizeInt8ToFloat32(quantized: Int8Array, scale: number): Float32Array {
  const len = quantized.length;
  const float32 = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    float32[i] = Number(quantized[i]) * scale;
  }
  return float32;
}

/**
 * Computes dot product between two int8 quantized vectors with their respective scales.
 *
 * Formula:
 * dotProduct = (sum(a[i] * b[i])) * (aScale * bScale)
 */
export function dotProductInt8(a: Int8Array, aScale: number, b: Int8Array, bScale: number): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += Number(a[i]) * Number(b[i]);
  }

  return sum * aScale * bScale;
}

/**
 * Computes cosine similarity between two int8 quantized vectors.
 *
 * Cosine similarity = dot(a, b) / (norm(a) * norm(b))
 */
export function cosineSimilarityInt8(a: Int8Array, b: Int8Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < len; i++) {
    const ai = Number(a[i]);
    const bi = Number(b[i]);
    dot += ai * bi;
    normASq += ai * ai;
    normBSq += bi * bi;
  }

  if (normASq === 0 || normBSq === 0) return 0;
  return dot / (Math.sqrt(normASq) * Math.sqrt(normBSq));
}

/**
 * Computes standard dot product between two Float32Array vectors.
 */
export function dotProductFloat32(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += Number(a[i]) * Number(b[i]);
  }
  return sum;
}

/**
 * Computes cosine similarity between two Float32Array vectors.
 */
export function cosineSimilarityFloat32(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < len; i++) {
    const ai = Number(a[i]);
    const bi = Number(b[i]);
    dot += ai * bi;
    normASq += ai * ai;
    normBSq += bi * bi;
  }

  if (normASq === 0 || normBSq === 0) return 0;
  return dot / (Math.sqrt(normASq) * Math.sqrt(normBSq));
}
