/**
 * Standard Reciprocal Rank Fusion constant (k = 60).
 */
export const RRF_K_DEFAULT = 60;

export interface RrfScoredItem<T> {
  item: T;
  score: number;
  rank1?: number | undefined;
  rank2?: number | undefined;
  score1?: number | undefined;
  score2?: number | undefined;
}

/**
 * Reciprocal Rank Fusion combiner for two ranked result lists.
 * Formula: RRF(doc) = w1 / (k + rank1) + w2 / (k + rank2)
 */
export function combineWithRrf<T, K extends string | number>(
  list1: readonly T[],
  list2: readonly T[],
  getId: (item: T) => K,
  options?: {
    k?: number | undefined;
    weight1?: number | undefined;
    weight2?: number | undefined;
    getScore1?: ((item: T) => number) | undefined;
    getScore2?: ((item: T) => number) | undefined;
  }
): RrfScoredItem<T>[] {
  const k = options?.k ?? RRF_K_DEFAULT;
  const w1 = options?.weight1 ?? 1.0;
  const w2 = options?.weight2 ?? 1.0;

  const scoreMap = new Map<
    K,
    {
      item: T;
      score: number;
      rank1?: number | undefined;
      rank2?: number | undefined;
      score1?: number | undefined;
      score2?: number | undefined;
    }
  >();

  let rank1 = 1;
  for (const item of list1) {
    const id = getId(item);
    const rrfScore = w1 / (k + rank1);
    const origScore = options?.getScore1 ? options.getScore1(item) : undefined;
    scoreMap.set(id, {
      item,
      score: rrfScore,
      rank1,
      score1: origScore
    });
    rank1++;
  }

  let rank2 = 1;
  for (const item of list2) {
    const id = getId(item);
    const rrfScore = w2 / (k + rank2);
    const origScore = options?.getScore2 ? options.getScore2(item) : undefined;
    const existing = scoreMap.get(id);
    if (existing) {
      existing.score += rrfScore;
      existing.rank2 = rank2;
      existing.score2 = origScore;
    } else {
      scoreMap.set(id, {
        item,
        score: rrfScore,
        rank2,
        score2: origScore
      });
    }
    rank2++;
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}
