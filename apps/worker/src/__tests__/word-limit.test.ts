import { MAX_WORDS_PER_SOURCE, countUniqueWords, countWords } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../config.js";
import {
  SOURCE_WORD_LIMIT_CODE,
  checkTextWordLimit,
  exceedsWordLimit,
  sourceWordLimitProblem
} from "../word-limit.js";

describe("Wortgrenze pro Quelle", () => {
  it("setzt 500.000 Wörter in beiden Profilen", () => {
    expect(MAX_WORDS_PER_SOURCE).toBe(500_000);
    expect(resolveAppConfig({ APP_PROFILE: "demo" }).quotas.maxWordsPerSource).toBe(500_000);
    expect(resolveAppConfig({ APP_PROFILE: "full" }).quotas.maxWordsPerSource).toBe(500_000);
  });

  for (const profile of ["demo", "full"] as const) {
    it(`erlaubt genau 500.000 und lehnt 500.001 Wörter ab (${profile})`, () => {
      const limit = resolveAppConfig({ APP_PROFILE: profile }).quotas.maxWordsPerSource;
      expect(exceedsWordLimit(500_000, limit)).toBe(false);
      expect(exceedsWordLimit(500_001, limit)).toBe(true);

      expect(checkTextWordLimit("wort ".repeat(500_000), limit)).toEqual({
        wordCount: 500_000,
        exceeded: false
      });
      expect(checkTextWordLimit("wort ".repeat(500_001), limit)).toEqual({
        wordCount: 500_001,
        exceeded: true
      });
    });
  }

  it("liefert RFC-9457-Problem mit Code SOURCE_WORD_LIMIT und Status 413", () => {
    const problem = sourceWordLimitProblem(500_001, 500_000, "/api/v1/notebooks/n/sources/url");
    expect(problem.status).toBe(413);
    expect(problem.code).toBe(SOURCE_WORD_LIMIT_CODE);
    expect(SOURCE_WORD_LIMIT_CODE).toBe("SOURCE_WORD_LIMIT");
    expect(problem.instance).toBe("/api/v1/notebooks/n/sources/url");
  });
});

describe("countWords / countUniqueWords", () => {
  it("zählt Wörter über beliebigen Whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords("  eins zwei\ndrei\t vier  ")).toBe(4);
  });

  it("trennt an Unicode-Leerraum, aber nicht an Satzzeichen, Bindestrich oder Zero-Width-Space", () => {
    // Trennzeichen sind alle Zeichen, die auf \s passen (inkl. U+00A0, U+2009, U+2028, U+3000).
    expect(countWords("eins zwei drei vier　fünf")).toBe(5);
    expect(countWords("﻿eins zwei")).toBe(2);
    // Satzzeichen und Bindestriche gehören zum Wort.
    expect(countWords("Hallo, Welt! E-Mail-Adresse.")).toBe(3);
    // Zero-Width-Space (U+200B) und weiches Trennzeichen (U+00AD) trennen nicht.
    expect(countWords("eins​zwei Silben­trennung")).toBe(2);
    // Schriften ohne Leerzeichen zählen je zusammenhängender Folge als ein Wort.
    expect(countWords("日本語のテキスト 中文")).toBe(2);
  });

  it("zählt überlappende Chunks nicht doppelt", () => {
    const text = "a b c d e f";
    const chunks = [
      { chunkIndex: 0, text: "a b c d", startOffset: 0, endOffset: 7 },
      { chunkIndex: 1, text: "c d e f", startOffset: 4, endOffset: 11 }
    ];
    expect(text.slice(4, 11)).toBe("c d e f");
    expect(countUniqueWords(chunks)).toBe(6);
  });

  it("zählt ein mitten im Wort angeschnittenes Wort nur einmal", () => {
    // Chunk 0 deckt bis Offset 10 ab, Chunk 1 beginnt bei Offset 7 mitten im Wort "welt"
    expect(
      countUniqueWords([
        { chunkIndex: 0, text: "hallo welt", startOffset: 0, endOffset: 10 },
        { chunkIndex: 1, text: "welt wie", startOffset: 7, endOffset: 15 }
      ])
    ).toBe(3);
  });

  it("ignoriert Chunks, die vollständig im gezählten Bereich liegen, und zählt getrennte Chunks", () => {
    expect(
      countUniqueWords([
        { chunkIndex: 0, text: "a b c d", startOffset: 0, endOffset: 7 },
        { chunkIndex: 1, text: "b c", startOffset: 2, endOffset: 5 },
        { chunkIndex: 2, text: "e f", startOffset: 8, endOffset: 11 }
      ])
    ).toBe(6);
  });

  it("zählt Chunks ohne Offsets vollständig", () => {
    expect(
      countUniqueWords([
        { chunkIndex: 0, text: "a b" },
        { chunkIndex: 1, text: "c d e" }
      ])
    ).toBe(5);
  });
});
