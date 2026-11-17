export interface GoogleDocsDetectorResult {
  readonly isGoogleDoc: boolean;
  readonly documentId?: string;
  readonly exportUrl?: string;
}

/**
 * Regex matching standard Google Docs URLs:
 * e.g.:
 * - https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * - https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing
 * - https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/
 * - https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
 * - docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
 */
const GOOGLE_DOCS_URL_REGEX =
  /^(?:https?:\/\/)?docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]{25,})(?:\/.*)?$/;

/**
 * Detects whether a URL is a Google Docs URL, and constructs the export URL.
 * In accordance with Decision #64, public/shared docs can be exported directly via:
 * https://docs.google.com/document/d/:docId/export?format=txt
 */
export function detectGoogleDocsUrl(url: string): GoogleDocsDetectorResult {
  if (typeof url !== "string" || !url.trim()) {
    return { isGoogleDoc: false };
  }

  const trimmed = url.trim();
  const match = trimmed.match(GOOGLE_DOCS_URL_REGEX);

  if (!match || !match[1]) {
    return { isGoogleDoc: false };
  }

  const documentId = match[1];
  const exportUrl = `https://docs.google.com/document/d/${documentId}/export?format=txt`;

  return {
    isGoogleDoc: true,
    documentId,
    exportUrl
  };
}
