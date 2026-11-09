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

  it("handles very long continuous words without breaking", () => {
    const superLongWord = "a".repeat(1000);
    const chunks = chunkText({ text: superLongWord, maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text.length).toBeGreaterThan(0);
  });
});
