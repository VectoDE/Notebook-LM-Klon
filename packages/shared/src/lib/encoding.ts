export interface EncodingInspectionReport {
  readonly valid: boolean;
  readonly hasBom: boolean;
  readonly hasReplacementChar: boolean;
  readonly mojibakeMatches: readonly string[];
}

/**
 * Common double-encoded UTF-8 sequences (when UTF-8 bytes are decoded as Latin-1/Windows-1252
 * and re-encoded as UTF-8), constructed via codepoints to keep this source file 100% clean.
 */
const MOJIBAKE_PATTERNS: readonly { readonly label: string; readonly sequence: string }[] = [
  { label: "double-encoded ae (0xC3 0xA4)", sequence: String.fromCharCode(0xc3, 0xa4) },
  { label: "double-encoded oe (0xC3 0xB6)", sequence: String.fromCharCode(0xc3, 0xb6) },
  { label: "double-encoded ue (0xC3 0xBC)", sequence: String.fromCharCode(0xc3, 0xbc) },
  { label: "double-encoded AE (0xC3 0x84)", sequence: String.fromCharCode(0xc3, 0x84) },
  { label: "double-encoded OE (0xC3 0x96)", sequence: String.fromCharCode(0xc3, 0x96) },
  { label: "double-encoded UE (0xC3 0x9C)", sequence: String.fromCharCode(0xc3, 0x9c) },
  { label: "double-encoded sz (0xC3 0x9F)", sequence: String.fromCharCode(0xc3, 0x9f) },
  {
    label: "double-encoded en-dash (0xE2 0x80 0x93)",
    sequence: String.fromCharCode(0xe2, 0x80, 0x93)
  },
  {
    label: "double-encoded em-dash (0xE2 0x80 0x94)",
    sequence: String.fromCharCode(0xe2, 0x80, 0x94)
  },
  {
    label: "double-encoded quote (0xE2 0x80 0x9E)",
    sequence: String.fromCharCode(0xe2, 0x80, 0x9e)
  },
  {
    label: "double-encoded arrow (0xE2 0x86 0x92)",
    sequence: String.fromCharCode(0xe2, 0x86, 0x92)
  },
  { label: "stray 0xC2 before section symbol", sequence: String.fromCharCode(0xc2, 0xa7) }
];

/**
 * Validates that a byte buffer is strict UTF-8 without BOM, contains no U+FFFD replacement
 * characters, and exhibits no double-encoded UTF-8 Mojibake patterns.
 */
export function inspectTextEncoding(bytes: Uint8Array): EncodingInspectionReport {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return {
      valid: false,
      hasBom,
      hasReplacementChar: true,
      mojibakeMatches: ["invalid-utf8-byte-sequence"]
    };
  }

  const hasReplacementChar = text.includes("\uFFFD");
  const mojibakeMatches: string[] = [];

  for (const pattern of MOJIBAKE_PATTERNS) {
    if (text.includes(pattern.sequence)) {
      mojibakeMatches.push(pattern.label);
    }
  }

  return {
    valid: !hasBom && !hasReplacementChar && mojibakeMatches.length === 0,
    hasBom,
    hasReplacementChar,
    mojibakeMatches
  };
}
