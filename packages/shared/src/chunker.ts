export const DEFAULT_MAX_TOKENS = 800;
export const DEFAULT_OVERLAP_TOKENS = 100;
export const MAX_WORDS_LIMIT = 500_000;

export class TextTooLargeError extends Error {
  constructor(wordCount: number, limit: number = MAX_WORDS_LIMIT) {
    super(`Input text has ${wordCount} words, exceeding maximum limit of ${limit} words.`);
    this.name = "TextTooLargeError";
  }
}

export interface ChunkInput {
  text: string;
  maxTokens?: number | undefined;
  overlapTokens?: number | undefined;
  pageNumber?: number | undefined;
}

export interface TextChunk {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  pageNumber?: number | undefined;
  startOffset: number;
  endOffset: number;
}

/**
 * Estimates token count based on standard English/code heuristics:
 * Average ~4 characters per token (or ~0.75 words per token).
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const charTokens = Math.ceil(text.length / 4);
  const wordTokens = Math.ceil(words.length * 1.3);
  return Math.max(1, Math.round((charTokens + wordTokens) / 2));
}

interface TextSegment {
  text: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

/**
 * Splits text into segments while preserving offsets and boundaries.
 */
function splitIntoUnits(text: string): TextSegment[] {
  // First split by paragraphs (\n\n+)
  const paragraphs: { text: string; start: number; end: number }[] = [];
  let currentOffset = 0;

  for (const part of text.split(/\n{2,}/).filter(Boolean)) {
    paragraphs.push({
      text: part,
      start: currentOffset,
      end: currentOffset + part.length
    });
    currentOffset += part.length + 2; // Approximate/boundary offset
  }

  const units: TextSegment[] = [];

  for (const para of paragraphs) {
    // If paragraph is already reasonably small, keep it as a unit
    const paraTokens = estimateTokenCount(para.text);
    if (paraTokens <= 150) {
      units.push({
        text: para.text,
        startOffset: para.start,
        endOffset: para.end,
        tokenCount: paraTokens
      });
      continue;
    }

    // Split large paragraph into sentences (. , ! , ? followed by space or newline)
    const sentenceRegex = /[^.!?\n]+(?:[.!?]+|\n|$)/g;

    while (true) {
      const sMatch = sentenceRegex.exec(para.text);
      if (sMatch === null) break;
      const sText = sMatch[0];
      if (sText.trim().length === 0) continue;
      const sStart = para.start + sMatch.index;
      const sEnd = sStart + sText.length;
      const sTokens = estimateTokenCount(sText);

      // If a sentence itself is huge (e.g. without punctuation > 150 tokens), split by words
      if (sTokens > 150) {
        const wordMatches = Array.from(sText.matchAll(/\S+\s*/g));
        let wordBuffer = "";
        let wStart = sStart;

        for (let wIdx = 0; wIdx < wordMatches.length; wIdx++) {
          const wMatch = wordMatches[wIdx] as RegExpMatchArray;
          const w = wMatch[0];
          wordBuffer += w;
          const isLastWord = wIdx === wordMatches.length - 1;
          const shouldFlush = isLastWord || estimateTokenCount(wordBuffer) >= 50;
          if (shouldFlush) {
            const matchOffset = wMatch.index as number;
            const wEnd = sStart + matchOffset + w.length;
            units.push({
              text: wordBuffer,
              startOffset: wStart,
              endOffset: wEnd,
              tokenCount: estimateTokenCount(wordBuffer)
            });
            wordBuffer = "";
            wStart = wEnd;
          }
        }
      } else {
        units.push({
          text: sText,
          startOffset: sStart,
          endOffset: sEnd,
          tokenCount: sTokens
        });
      }
    }
  }

  return units;
}

/**
 * Chunks text into semantic blocks with token size limits and token overlap.
 */
export function chunkText(input: ChunkInput): TextChunk[] {
  const {
    text,
    maxTokens = DEFAULT_MAX_TOKENS,
    overlapTokens = DEFAULT_OVERLAP_TOKENS,
    pageNumber
  } = input;

  if (!text || text.trim().length === 0) {
    return [];
  }

  // Fast word count check
  const words = text.trim().split(/\s+/);
  if (words.length > MAX_WORDS_LIMIT) {
    throw new TextTooLargeError(words.length, MAX_WORDS_LIMIT);
  }

  const totalTokens = estimateTokenCount(text);
  if (totalTokens <= maxTokens) {
    return [
      {
        chunkIndex: 0,
        text,
        tokenCount: totalTokens,
        ...(pageNumber !== undefined ? { pageNumber } : {}),
        startOffset: 0,
        endOffset: text.length
      }
    ];
  }

  const units = splitIntoUnits(text);

  const chunks: TextChunk[] = [];
  let currentUnits: TextSegment[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i] as TextSegment;

    if (currentUnits.length > 0 && currentTokens + unit.tokenCount > maxTokens) {
      // Create chunk from currentUnits
      const firstUnit = currentUnits[0] as TextSegment;
      const lastUnit = currentUnits[currentUnits.length - 1] as TextSegment;
      const chunkTextContent = text.slice(firstUnit.startOffset, lastUnit.endOffset);
      chunks.push({
        chunkIndex: chunkIndex++,
        text: chunkTextContent,
        tokenCount: currentTokens,
        ...(pageNumber !== undefined ? { pageNumber } : {}),
        startOffset: firstUnit.startOffset,
        endOffset: lastUnit.endOffset
      });

      // Compute overlap: keep trailing units up to overlapTokens
      const overlapUnits: TextSegment[] = [];
      let accumOverlap = 0;
      for (let j = currentUnits.length - 1; j >= 0; j--) {
        const u = currentUnits[j] as TextSegment;
        if (accumOverlap + u.tokenCount <= overlapTokens || overlapUnits.length === 0) {
          overlapUnits.unshift(u);
          accumOverlap += u.tokenCount;
        } else {
          break;
        }
      }

      currentUnits = overlapUnits;
      currentTokens = accumOverlap;
    }

    currentUnits.push(unit);
    currentTokens += unit.tokenCount;
  }

  // Final chunk
  const firstUnit = currentUnits[0] as TextSegment;
  const lastUnit = currentUnits[currentUnits.length - 1] as TextSegment;
  const chunkTextContent = text.slice(firstUnit.startOffset, lastUnit.endOffset);
  chunks.push({
    chunkIndex: chunkIndex++,
    text: chunkTextContent,
    tokenCount: currentTokens,
    ...(pageNumber !== undefined ? { pageNumber } : {}),
    startOffset: firstUnit.startOffset,
    endOffset: lastUnit.endOffset
  });

  return chunks;
}
