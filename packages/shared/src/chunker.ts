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
  const paragraphRegex = /\n{2,}/g;
  const paragraphs: { text: string; start: number; end: number }[] = [];
  let lastIndex = 0;

  while (true) {
    const match = paragraphRegex.exec(text);
    if (match === null) break;
    if (match.index > lastIndex) {
      paragraphs.push({
        text: text.slice(lastIndex, match.index),
        start: lastIndex,
        end: match.index
      });
    }
    lastIndex = paragraphRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    paragraphs.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length
    });
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
    const sentenceRegex = /[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g;
    let hasSentences = false;

    while (true) {
      const sMatch = sentenceRegex.exec(para.text);
      if (sMatch === null) break;
      const sText = sMatch[0];
      if (sText.trim().length === 0) continue;
      hasSentences = true;
      const sStart = para.start + sMatch.index;
      const sEnd = sStart + sText.length;
      const sTokens = estimateTokenCount(sText);

      // If a sentence itself is huge (e.g. without punctuation > 150 tokens), split by words
      if (sTokens > 150) {
        const wordRegex = /\S+\s*/g;
        let wordBuffer = "";
        let wStart = sStart;

        while (true) {
          const wMatch = wordRegex.exec(sText);
          if (wMatch === null) break;
          const w = wMatch[0];
          wordBuffer += w;
          if (estimateTokenCount(wordBuffer) >= 50) {
            const wEnd = sStart + wMatch.index + w.length;
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
        if (wordBuffer.length > 0) {
          units.push({
            text: wordBuffer,
            startOffset: wStart,
            endOffset: sEnd,
            tokenCount: estimateTokenCount(wordBuffer)
          });
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

    if (!hasSentences) {
      units.push({
        text: para.text,
        startOffset: para.start,
        endOffset: para.end,
        tokenCount: paraTokens
      });
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
  if (units.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let currentUnits: TextSegment[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (!unit) continue;

    if (currentUnits.length > 0 && currentTokens + unit.tokenCount > maxTokens) {
      // Create chunk from currentUnits
      const firstUnit = currentUnits[0];
      const lastUnit = currentUnits[currentUnits.length - 1];
      if (firstUnit && lastUnit) {
        const chunkTextContent = text.slice(firstUnit.startOffset, lastUnit.endOffset);
        chunks.push({
          chunkIndex: chunkIndex++,
          text: chunkTextContent,
          tokenCount: currentTokens,
          ...(pageNumber !== undefined ? { pageNumber } : {}),
          startOffset: firstUnit.startOffset,
          endOffset: lastUnit.endOffset
        });
      }

      // Compute overlap: keep trailing units up to overlapTokens
      const overlapUnits: TextSegment[] = [];
      let accumOverlap = 0;
      for (let j = currentUnits.length - 1; j >= 0; j--) {
        const u = currentUnits[j];
        if (!u) continue;
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

  if (currentUnits.length > 0) {
    const firstUnit = currentUnits[0];
    const lastUnit = currentUnits[currentUnits.length - 1];
    if (firstUnit && lastUnit) {
      const chunkTextContent = text.slice(firstUnit.startOffset, lastUnit.endOffset);
      chunks.push({
        chunkIndex: chunkIndex++,
        text: chunkTextContent,
        tokenCount: currentTokens,
        ...(pageNumber !== undefined ? { pageNumber } : {}),
        startOffset: firstUnit.startOffset,
        endOffset: lastUnit.endOffset
      });
    }
  }

  return chunks;
}
