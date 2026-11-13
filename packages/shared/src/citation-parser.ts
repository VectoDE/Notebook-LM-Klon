import type { GroundedSourceItem } from "./chat-context.js";

export interface ParsedCitationMarker {
  readonly raw: string;
  readonly index: number;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface GroundedCitationMetadata {
  readonly index: number;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly page: number | null;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly quote?: string | undefined;
}

export interface CitationValidationResult {
  readonly cleanedText: string;
  readonly citations: GroundedCitationMetadata[];
  readonly validIndices: number[];
  readonly hallucinatedIndices: number[];
}

/**
 * Largest number of indices a single range marker such as `[3-7]` may expand to.
 * Wider ranges (e.g. `[1-999999999]` in model output) are ignored instead of expanded,
 * so a single marker cannot block the worker in a loop of millions of iterations.
 */
export const MAX_CITATION_RANGE_SPAN = 100;

function isExpandableRange(startNum: number, endNum: number): boolean {
  return startNum <= endNum && endNum - startNum < MAX_CITATION_RANGE_SPAN;
}

/**
 * Parses inline citation markers in text.
 * Supports:
 * - Single: `[1]`, `[12]`
 * - Comma-separated: `[1, 2]`, `[1, 3, 5]`
 * - Ranges: `[1-3]`, `[1]-[3]`
 * - Sequential: `[1][2][3]`
 */
export function extractCitationIndices(text: string): {
  indices: number[];
  markers: ParsedCitationMarker[];
} {
  const indicesSet = new Set<number>();
  const markers: ParsedCitationMarker[] = [];

  // Match citation patterns enclosed in brackets e.g. [1], [1, 2], [1-3]
  const bracketRegex = /\[(\s*\d+(?:\s*(?:,|-)\s*\d+)*\s*)\]/g;
  let match: RegExpExecArray | null = null;

  while (true) {
    match = bracketRegex.exec(text);
    if (!match) {
      break;
    }

    const raw = match[0];
    const inner = (match[1] as string).trim();
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    // Handle comma or dash within the bracket
    const parts = inner.split(",");
    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart.includes("-")) {
        const [startStr, endStr] = trimmedPart.split("-").map((s) => s.trim());
        const startNum = Number.parseInt(startStr as string, 10);
        const endNum = Number.parseInt(endStr as string, 10);
        if (isExpandableRange(startNum, endNum)) {
          for (let i = startNum; i <= endNum; i++) {
            indicesSet.add(i);
            markers.push({ raw, index: i, startIndex, endIndex });
          }
        }
      } else {
        const num = Number.parseInt(trimmedPart, 10);
        indicesSet.add(num);
        markers.push({ raw, index: num, startIndex, endIndex });
      }
    }
  }

  return {
    indices: Array.from(indicesSet).sort((a, b) => a - b),
    markers
  };
}

export interface ValidateCitationsOptions {
  /**
   * Action when hallucinated citation is encountered:
   * - "remove": Remove the hallucinated index or marker from cleanedText
   * - "mark": Wrap hallucinated marker in cleanedText with [hallucination: n]
   * - "keep": Keep cleanedText unchanged
   * Default: "remove"
   */
  readonly hallucinationAction?: "remove" | "mark" | "keep" | undefined;
}

/**
 * Validates inline citations against available grounded sources.
 * Removes or marks hallucinated citations and returns resolved citation metadata.
 */
export function validateAndCleanCitations(
  text: string,
  availableSources: Record<number, GroundedSourceItem> | GroundedSourceItem[],
  options?: ValidateCitationsOptions
): CitationValidationResult {
  const sourceMap: Record<number, GroundedSourceItem> = Array.isArray(availableSources)
    ? Object.fromEntries(availableSources.map((s) => [s.index, s]))
    : availableSources;

  const action = options?.hallucinationAction ?? "remove";
  const validIndicesSet = new Set<number>();
  const hallucinatedIndicesSet = new Set<number>();

  // Process and rewrite bracket groups
  const bracketRegex = /\[(\s*\d+(?:\s*(?:,|-)\s*\d+)*\s*)\]/g;

  const cleanedText = text.replace(bracketRegex, (fullMatch, inner: string) => {
    const parts = inner.split(",");
    const keptValidNumbers: number[] = [];
    const hallucinatedInThisBracket: number[] = [];

    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart.includes("-")) {
        const [startStr, endStr] = trimmedPart.split("-").map((s) => s.trim());
        const startNum = Number.parseInt(startStr as string, 10);
        const endNum = Number.parseInt(endStr as string, 10);
        if (!isExpandableRange(startNum, endNum)) {
          continue;
        }
        for (let i = startNum; i <= endNum; i++) {
          if (sourceMap[i]) {
            validIndicesSet.add(i);
            keptValidNumbers.push(i);
          } else {
            hallucinatedIndicesSet.add(i);
            hallucinatedInThisBracket.push(i);
          }
        }
      } else {
        const num = Number.parseInt(trimmedPart, 10);
        if (sourceMap[num]) {
          validIndicesSet.add(num);
          keptValidNumbers.push(num);
        } else {
          hallucinatedIndicesSet.add(num);
          hallucinatedInThisBracket.push(num);
        }
      }
    }

    if (action === "keep") {
      return fullMatch;
    }

    if (action === "mark") {
      const validPart = keptValidNumbers.length > 0 ? `[${keptValidNumbers.join(", ")}]` : "";
      const markPart =
        hallucinatedInThisBracket.length > 0
          ? `[hallucination: ${hallucinatedInThisBracket.join(", ")}]`
          : "";
      if (validPart && markPart) {
        return `${validPart}${markPart}`;
      }
      return validPart || markPart;
    }

    // Default "remove"
    if (keptValidNumbers.length === 0) {
      return "";
    }
    return `[${keptValidNumbers.join(", ")}]`;
  });

  const validIndices = Array.from(validIndicesSet).sort((a, b) => a - b);
  const hallucinatedIndices = Array.from(hallucinatedIndicesSet).sort((a, b) => a - b);

  const citations: GroundedCitationMetadata[] = validIndices.map((idx) => {
    const src = sourceMap[idx] as GroundedSourceItem;
    return {
      index: src.index,
      chunkId: src.chunkId,
      sourceId: src.sourceId,
      sourceTitle: src.sourceTitle,
      page: src.page ?? null,
      startOffset: src.startOffset ?? null,
      endOffset: src.endOffset ?? null,
      quote: src.snippet
    };
  });

  return {
    cleanedText: cleanedText.replace(/\s{2,}/g, " ").trim(),
    citations,
    validIndices,
    hallucinatedIndices
  };
}
