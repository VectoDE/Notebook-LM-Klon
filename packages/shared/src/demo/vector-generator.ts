/**
 * Deterministic 768-dimensional float32 vector generator for demo chunks.
 * Uses a tokenized bag-of-words hash projection normalized to unit Euclidean length.
 * This guarantees stable, zero-network, reproducible embeddings matching cosine similarities.
 */

export function generateDeterministicEmbedding(text: string, dimensions = 768): Float32Array {
  const norm = text.toLowerCase().normalize("NFKC");
  const vec = new Float32Array(dimensions);

  // Split into word tokens and character n-grams (3-grams) for robust semantic overlap
  const words = norm.split(/\s+/).filter((w) => w.length > 0);
  for (let w = 0; w < words.length; w++) {
    const word = words[w] as string;
    let wordHash = 0;
    for (let c = 0; c < word.length; c++) {
      wordHash = (wordHash * 31 + word.charCodeAt(c)) | 0;
    }
    const bucket = Math.abs(wordHash) % dimensions;
    const currentVal = vec[bucket] as number;
    vec[bucket] = currentVal + 2.0;

    // Character trigrams for morphological similarity (e.g., DSGVO vs. dsgvo-konform)
    for (let i = 0; i <= word.length - 3; i++) {
      const tri = word.slice(i, i + 3);
      let triHash = 0;
      for (let j = 0; j < 3; j++) {
        triHash = (triHash * 17 + tri.charCodeAt(j)) | 0;
      }
      const triBucket = Math.abs(triHash) % dimensions;
      const currentTri = vec[triBucket] as number;
      vec[triBucket] = currentTri + 0.5;
    }
  }

  // Normalize vector to unit length (L2 norm)
  let sumSq = 0;
  for (let i = 0; i < dimensions; i++) {
    const val = vec[i] as number;
    sumSq += val * val;
  }

  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] = (vec[i] as number) / magnitude;
    }
  }

  return vec;
}
