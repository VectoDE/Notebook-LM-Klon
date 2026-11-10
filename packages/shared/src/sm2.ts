/**
 * SM-2 (SuperMemo-2) Spaced Repetition Algorithm Implementation.
 *
 * Implements Sub-Issue #123 (Decision #62, #70) for Spaced Repetition Flashcards.
 *
 * Quality responses (0-5 or simplified user ratings 0=Again, 3=Hard, 4=Good, 5=Easy):
 * - EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
 * - EF min = 1.3
 * - If q < 3: repetitions = 0, interval = 1
 * - If q >= 3:
 *     repetitions == 0 -> interval = 1
 *     repetitions == 1 -> interval = 6
 *     repetitions >= 2 -> interval = round(previous_interval * EF)
 *     repetitions += 1
 */

export type FlashcardRating = "again" | "hard" | "good" | "easy";

export interface SM2State {
  readonly repetitions: number;
  readonly intervalDays: number;
  readonly easeFactor: number;
  readonly lastReviewedAt?: number | undefined;
  readonly nextReviewAt?: number | undefined;
}

export interface SM2ReviewResult extends SM2State {
  readonly rating: FlashcardRating;
  readonly qualityScore: number;
}

export const SM2_DEFAULT_EASE_FACTOR = 2.5;
export const SM2_MINIMUM_EASE_FACTOR = 1.3;

export function ratingToQualityScore(rating: FlashcardRating): number {
  switch (rating) {
    case "again":
      return 1;
    case "hard":
      return 3;
    case "good":
      return 4;
    case "easy":
      return 5;
  }
}

export function createInitialSM2State(): SM2State {
  return {
    repetitions: 0,
    intervalDays: 0,
    easeFactor: SM2_DEFAULT_EASE_FACTOR,
    lastReviewedAt: undefined,
    nextReviewAt: undefined
  };
}

export interface CalculateSM2Options {
  readonly now?: number | undefined;
}

/**
 * Calculates updated SM-2 parameters after reviewing a flashcard with a quality score (0..5) or rating.
 */
export function calculateSM2(
  previousState: SM2State,
  ratingOrScore: FlashcardRating | number,
  options?: CalculateSM2Options
): SM2ReviewResult {
  const quality =
    typeof ratingOrScore === "number"
      ? Math.max(0, Math.min(5, Math.round(ratingOrScore)))
      : ratingToQualityScore(ratingOrScore);

  let rating: FlashcardRating;
  if (typeof ratingOrScore === "string") {
    rating = ratingOrScore;
  } else if (quality < 3) {
    rating = "again";
  } else if (quality === 3) {
    rating = "hard";
  } else if (quality === 4) {
    rating = "good";
  } else {
    rating = "easy";
  }

  const prevEF = previousState.easeFactor;
  const prevReps = previousState.repetitions;
  const prevInterval = previousState.intervalDays;

  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const newEaseFactor = Math.max(SM2_MINIMUM_EASE_FACTOR, Number((prevEF + delta).toFixed(2)));

  let newRepetitions = 0;
  let newIntervalDays = 1;

  if (quality < 3) {
    // Failure / Again: reset repetitions and start interval back at 1
    newRepetitions = 0;
    newIntervalDays = 1;
  } else {
    // Success: increment repetition count
    newRepetitions = prevReps + 1;
    if (newRepetitions === 1) {
      newIntervalDays = 1;
    } else if (newRepetitions === 2) {
      newIntervalDays = 6;
    } else {
      newIntervalDays = Math.max(1, Math.round(prevInterval * newEaseFactor));
    }
  }

  const now = options?.now ?? Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const nextReviewAt = now + newIntervalDays * oneDayMs;

  return {
    repetitions: newRepetitions,
    intervalDays: newIntervalDays,
    easeFactor: newEaseFactor,
    lastReviewedAt: now,
    nextReviewAt,
    rating,
    qualityScore: quality
  };
}
