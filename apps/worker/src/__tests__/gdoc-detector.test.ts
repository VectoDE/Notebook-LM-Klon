import { describe, expect, it } from "vitest";
import { detectGoogleDocsUrl } from "../gdoc-detector.js";

describe("Google Docs URL Detector - detectGoogleDocsUrl", () => {
  it("detects valid Google Docs URLs with various suffixes and query params", () => {
    const docId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

    const urls = [
      `https://docs.google.com/document/d/${docId}/edit`,
      `https://docs.google.com/document/d/${docId}/edit?usp=sharing`,
      `http://docs.google.com/document/d/${docId}/view`,
      `https://docs.google.com/document/d/${docId}/`,
      `https://docs.google.com/document/d/${docId}`,
      `docs.google.com/document/d/${docId}`
    ];

    for (const url of urls) {
      const res = detectGoogleDocsUrl(url);
      expect(res.isGoogleDoc).toBe(true);
      expect(res.documentId).toBe(docId);
      expect(res.exportUrl).toBe(`https://docs.google.com/document/d/${docId}/export?format=txt`);
    }
  });

  it("rejects non-Google-Docs URLs or non-strings", () => {
    expect(detectGoogleDocsUrl("").isGoogleDoc).toBe(false);
    expect(detectGoogleDocsUrl("   ").isGoogleDoc).toBe(false);
    // @ts-expect-error test non-string
    expect(detectGoogleDocsUrl(null).isGoogleDoc).toBe(false);
    expect(detectGoogleDocsUrl("https://example.com/document/d/12345").isGoogleDoc).toBe(false);
    expect(
      detectGoogleDocsUrl("https://docs.google.com/spreadsheets/d/12345/edit").isGoogleDoc
    ).toBe(false);
    expect(
      detectGoogleDocsUrl("https://docs.google.com/presentation/d/12345/edit").isGoogleDoc
    ).toBe(false);
    expect(detectGoogleDocsUrl("https://docs.google.com/document/d/short").isGoogleDoc).toBe(false);
  });
});
