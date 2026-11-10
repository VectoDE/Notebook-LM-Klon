import { describe, expect, it } from "vitest";
import {
  SM2_DEFAULT_EASE_FACTOR,
  SM2_MINIMUM_EASE_FACTOR,
  calculateSM2,
  createInitialSM2State,
  ratingToQualityScore
} from "../sm2.js";

describe("SM-2 Spaced Repetition Algorithm (Sub-Issue #123)", () => {
  it("creates initial SM-2 state with default parameters", () => {
    const initial = createInitialSM2State();
    expect(initial.repetitions).toBe(0);
    expect(initial.intervalDays).toBe(0);
    expect(initial.easeFactor).toBe(SM2_DEFAULT_EASE_FACTOR);
    expect(initial.lastReviewedAt).toBeUndefined();
    expect(initial.nextReviewAt).toBeUndefined();
  });

  it("maps user ratings to standard quality scores (0-5)", () => {
    expect(ratingToQualityScore("again")).toBe(1);
    expect(ratingToQualityScore("hard")).toBe(3);
    expect(ratingToQualityScore("good")).toBe(4);
    expect(ratingToQualityScore("easy")).toBe(5);
  });

  it("advances correctly on consecutive successful reviews (good)", () => {
    const fixedNow = 1_700_000_000_000;
    const initial = createInitialSM2State();

    // Review 1: good (q=4)
    const rev1 = calculateSM2(initial, "good", { now: fixedNow });
    expect(rev1.repetitions).toBe(1);
    expect(rev1.intervalDays).toBe(1);
    expect(rev1.rating).toBe("good");
    expect(rev1.qualityScore).toBe(4);
    expect(rev1.easeFactor).toBe(2.5); // 2.5 + (0.1 - 1 * 0.1) = 2.5
    expect(rev1.lastReviewedAt).toBe(fixedNow);
    expect(rev1.nextReviewAt).toBe(fixedNow + 1 * 86_400_000);

    // Review 2: good (q=4)
    const rev2 = calculateSM2(rev1, "good", { now: fixedNow + 86_400_000 });
    expect(rev2.repetitions).toBe(2);
    expect(rev2.intervalDays).toBe(6);
    expect(rev2.easeFactor).toBe(2.5);

    // Review 3: good (q=4) -> interval = 6 * 2.5 = 15
    const rev3 = calculateSM2(rev2, "good", { now: fixedNow + 7 * 86_400_000 });
    expect(rev3.repetitions).toBe(3);
    expect(rev3.intervalDays).toBe(15);
    expect(rev3.easeFactor).toBe(2.5);
  });

  it("increases ease factor on 'easy' (q=5) and extends intervals faster", () => {
    const initial = createInitialSM2State();
    const rev1 = calculateSM2(initial, "easy");
    // delta = 0.1 - 0 = 0.1 -> EF = 2.6
    expect(rev1.easeFactor).toBe(2.6);
    expect(rev1.repetitions).toBe(1);
    expect(rev1.intervalDays).toBe(1);

    const rev2 = calculateSM2(rev1, "easy");
    expect(rev2.easeFactor).toBe(2.7);
    expect(rev2.repetitions).toBe(2);
    expect(rev2.intervalDays).toBe(6);

    const rev3 = calculateSM2(rev2, "easy");
    expect(rev3.easeFactor).toBe(2.8);
    expect(rev3.repetitions).toBe(3);
    // 6 * 2.8 = 16.8 -> 17 days
    expect(rev3.intervalDays).toBe(17);
  });

  it("decreases ease factor on 'hard' (q=3) but still increments repetitions", () => {
    const initial = createInitialSM2State();
    const rev1 = calculateSM2(initial, "hard");
    // delta = 0.1 - (2 * (0.08 + 2 * 0.02)) = 0.1 - (2 * 0.12) = 0.1 - 0.24 = -0.14
    expect(rev1.easeFactor).toBe(2.36);
    expect(rev1.repetitions).toBe(1);
    expect(rev1.intervalDays).toBe(1);
  });

  it("resets repetitions and interval on 'again' (q < 3)", () => {
    const experienced = {
      repetitions: 5,
      intervalDays: 45,
      easeFactor: 2.4,
      lastReviewedAt: 1_700_000_000_000,
      nextReviewAt: 1_700_000_000_000 + 45 * 86_400_000
    };

    const failed = calculateSM2(experienced, "again");
    expect(failed.repetitions).toBe(0);
    expect(failed.intervalDays).toBe(1);
    expect(failed.rating).toBe("again");
    expect(failed.qualityScore).toBe(1);
    // delta = 0.1 - (4 * (0.08 + 4 * 0.02)) = 0.1 - 4 * 0.16 = 0.1 - 0.64 = -0.54
    expect(failed.easeFactor).toBe(1.86);
  });

  it("enforces minimum ease factor floor of 1.3", () => {
    const lowEaseState = {
      repetitions: 2,
      intervalDays: 6,
      easeFactor: 1.35,
      lastReviewedAt: 1_700_000_000_000,
      nextReviewAt: 1_700_000_000_000 + 6 * 86_400_000
    };

    // Rating again drops EF significantly (-0.54), should floor at 1.3
    const result = calculateSM2(lowEaseState, "again");
    expect(result.easeFactor).toBe(SM2_MINIMUM_EASE_FACTOR);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
  });

  it("handles numeric scores and clamps to [0, 5]", () => {
    const initial = createInitialSM2State();
    const clampedHigh = calculateSM2(initial, 10);
    expect(clampedHigh.qualityScore).toBe(5);
    expect(clampedHigh.rating).toBe("easy");

    const clampedLow = calculateSM2(initial, -3);
    expect(clampedLow.qualityScore).toBe(0);
    expect(clampedLow.rating).toBe("again");

    const score3 = calculateSM2(initial, 3);
    expect(score3.rating).toBe("hard");
    expect(score3.qualityScore).toBe(3);

    const score4 = calculateSM2(initial, 4);
    expect(score4.rating).toBe("good");
    expect(score4.qualityScore).toBe(4);
  });
});
