import { describe, expect, it } from "vitest";
import { MAX_WORDS_LIMIT, TextTooLargeError, chunkText, estimateTokenCount } from "../chunker.js";

describe("Token and Word Limits", () => {
  it("exports sensible defaults (ca. 800 tokens max, 100 overlap, 500,000 words limit)", () => {
    expect(MAX_WORDS_LIMIT).toBe(500_000);
  });

  it("calculates approximate token count accurately", () => {
    const text = "Hello world! This is a simple test text.";
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(15);
  });

  it("throws TextTooLargeError if text exceeds 500,000 words", () => {
    const hugeWordList = "word ".repeat(500_001);
    expect(() => chunkText({ text: hugeWordList })).toThrow(TextTooLargeError);
    expect(() => chunkText({ text: hugeWordList })).toThrow(/500000 words/);
  });
});

describe("chunkText basic behavior", () => {
  it("returns an empty array for empty or whitespace-only text", () => {
    expect(chunkText({ text: "" })).toEqual([]);
    expect(chunkText({ text: "   \n\n  \t  " })).toEqual([]);
  });

  it("returns a single chunk if text is smaller than maxTokens", () => {
    const text = "Short text under limits.";
    const chunks = chunkText({ text, maxTokens: 800, pageNumber: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      text: "Short text under limits.",
      pageNumber: 1,
      startOffset: 0,
      endOffset: 24
    });
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it("preserves pageNumber across chunks", () => {
    const longText = `${"Sentence one. ".repeat(150)}\n\n${"Sentence two. ".repeat(150)}`;
    const chunks = chunkText({ text: longText, maxTokens: 100, overlapTokens: 20, pageNumber: 42 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageNumber).toBe(42);
    }
  });

  it("sets pageNumber to undefined when omitted", () => {
    const chunks = chunkText({ text: "Hello there." });
    expect(chunks[0]?.pageNumber).toBeUndefined();
  });
});

describe("Boundary preservation (Paragraphs, Sentences, Words)", () => {
  it("splits preferentially along paragraph boundaries (\\n\\n)", () => {
    const p1 = "First paragraph with important content. ".repeat(30).trim();
    const p2 = "Second paragraph starting cleanly here. ".repeat(30).trim();
    const text = `${p1}\n\n${p2}`;

    const chunks = chunkText({ text, maxTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);

    expect(chunks[0]?.text).toContain("First paragraph");
    expect(chunks[chunks.length - 1]?.text).toContain("Second paragraph");
  });

  it("splits along sentence boundaries (. , ! , ? ) when paragraphs are large", () => {
    const s1 = "This is the first complete sentence! ";
    const s2 = "Can we split cleanly after questions? ";
    const s3 = "Indeed we should preserve sentence structure. ";
    const text = (s1 + s2 + s3).repeat(20);

    const chunks = chunkText({ text, maxTokens: 80, overlapTokens: 15 });
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(/^[a-z]/);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it("maintains overlap between consecutive chunks", () => {
    const sentenceList = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} with specific tokens.`
    );
    const text = sentenceList.join(" ");
    const chunks = chunkText({ text, maxTokens: 100, overlapTokens: 25 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1]?.text ?? "";
      const currChunk = chunks[i]?.text ?? "";

      const wordsInCurr = currChunk.split(/\s+/).slice(0, 5).join(" ");
      expect(prevChunk.includes(wordsInCurr) || currChunk.includes(prevChunk.slice(-20))).toBe(
        true
      );
    }
  });

  it("records accurate startOffset and endOffset for each chunk", () => {
    const text =
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.";
    const chunks = chunkText({ text, maxTokens: 15, overlapTokens: 4 });

    for (const chunk of chunks) {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeLessThanOrEqual(text.length);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      const slice = text.slice(chunk.startOffset, chunk.endOffset);
      expect(slice.trim()).toBe(chunk.text.trim());
    }
  });

  it("keeps exact offsets across multiple paragraphs, extra blank lines and leading/trailing breaks (#86)", () => {
    const para = (n: number) =>
      Array.from({ length: 12 }, (_, i) => `Absatz ${n} Satz ${i} mit Inhalt.`).join(" ");
    const text = `\n\n${para(1)}\n\n\n\n${para(2)}\n\n${para(3)}\n\n\n`;
    const chunks = chunkText({ text, maxTokens: 120, overlapTokens: 30 });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      // Der Ausschnitt aus dem Original ist exakt der Chunk-Text
      expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
    expect(chunks[0]?.startOffset).toBe(2);
    expect(chunks[0]?.text.startsWith("Absatz 1 Satz 0")).toBe(true);
    expect(chunks.at(-1)?.text.trimEnd().endsWith("Absatz 3 Satz 11 mit Inhalt.")).toBe(true);
  });

  it("overlaps consecutive chunks by offset without exceeding the overlap budget (#86)", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Satz ${i} beschreibt ein Detail.`).join(" ");
    const chunks = chunkText({ text, maxTokens: 80, overlapTokens: 20 });

    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      if (!prev || !curr) throw new Error("missing chunk");
      // Überlappung: der neue Chunk beginnt vor dem Ende des vorherigen, aber nach dessen Anfang
      expect(curr.startOffset).toBeLessThan(prev.endOffset);
      expect(curr.startOffset).toBeGreaterThan(prev.startOffset);
      const overlapText = text.slice(curr.startOffset, prev.endOffset);
      expect(prev.text.endsWith(overlapText)).toBe(true);
      expect(curr.text.startsWith(overlapText)).toBe(true);
      expect(curr.chunkIndex).toBe(i);
    }
  });

  it("ends every chunk at a sentence boundary when sentences fit (#86)", () => {
    const text = Array.from(
      { length: 50 },
      (_, i) => `Gedanke ${i} endet hier mit einem Punkt.`
    ).join(" ");
    const chunks = chunkText({ text, maxTokens: 90, overlapTokens: 15 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.trimEnd()).toMatch(/\.$/);
      expect(chunk.text).toMatch(/^Gedanke \d+ endet/);
    }
  });

  it("accepts exactly 500,000 words and rejects 500,001 (#86)", () => {
    const exact = "wort ".repeat(MAX_WORDS_LIMIT);
    expect(() => chunkText({ text: exact, maxTokens: 1_000_000_000 })).not.toThrow();
    expect(() => chunkText({ text: `${exact}zuviel` })).toThrow(TextTooLargeError);
  });

  it("handles very long continuous words without breaking", () => {
    const superLongWord = "a".repeat(1000);
    const chunks = chunkText({ text: superLongWord, maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text.length).toBeGreaterThan(0);
  });

  it("returns 0 for empty or whitespace-only estimateTokenCount", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles consecutive paragraph breaks at start or end", () => {
    const text = "\n\nFirst paragraph here.\n\n\n\nSecond paragraph here.\n\n";
    const chunks = chunkText({ text, maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("handles long sentences without punctuation exceeding 150 tokens", () => {
    // Generate a long sentence without sentence terminators (> 150 tokens = > 600 chars)
    // Test case 1: with a remainder in wordBuffer (e.g. 200 words)
    const longSentence = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText({ text: longSentence, maxTokens: 80, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }

    // Test case 2: exact boundary so wordBuffer.length === 0 after loop
    // Each word with space: "word12345 " ~ 10 chars. 20 words = ~50 tokens.
    // 60 words: exactly 3 groups of 20 words.
    const exactWords = Array.from({ length: 80 }, () => "word12345").join(" ");
    const chunksExact = chunkText({ text: exactWords, maxTokens: 50, overlapTokens: 5 });
    expect(chunksExact.length).toBeGreaterThan(0);
  });

  it("handles paragraphs with no sentence regex matches", () => {
    // A string consisting solely of punctuation/symbols that doesn't form a sentence
    const symbolOnly = "--- === *** +++ /// ::: ~~~";
    const chunks = chunkText({ text: symbolOnly, maxTokens: 10 });
    expect(chunks.length).toBe(1);
  });
});
