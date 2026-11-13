import type { ReviewStatus } from "./entity-graph.js";

/** Status eines Eintrags setzen (Timeline, Tabelle, Kennzahlen gleichermaßen). */
export function setReviewStatus<T extends { readonly id: string; readonly status: ReviewStatus }>(
  items: readonly T[],
  id: string,
  status: ReviewStatus
): T[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}
