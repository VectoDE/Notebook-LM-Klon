import { describe, expect, it } from "vitest";
import {
  BYOKKeyMetadataSchema,
  BYOKKeyResponseListSchema,
  BYOKKeyTestResultSchema,
  BYOKProviderSchema,
  BYOKPutKeyBodySchema,
  BYOKRekeyResultSchema,
  ProviderTypeSchema,
  extractLast4,
  maskApiKey
} from "../index.js";

describe("BYOK Zod Schemas & Helper Functions (Sub-Issues #92, #93, #94)", () => {
  describe("ProviderTypeSchema & BYOKProviderSchema", () => {
    it("validates all supported providers", () => {
      const providers = [
        "openai",
        "anthropic",
        "google",
        "groq",
        "deepseek",
        "mistral",
        "custom"
      ] as const;

      for (const p of providers) {
        expect(ProviderTypeSchema.parse(p)).toBe(p);
        expect(BYOKProviderSchema.parse(p)).toBe(p);
      }
    });

    it("rejects unknown providers", () => {
      expect(() => ProviderTypeSchema.parse("aws-bedrock")).toThrow();
      expect(() => BYOKProviderSchema.parse("cohere")).toThrow();
    });
  });

  describe("BYOKPutKeyBodySchema", () => {
    it("accepts valid API keys across providers", () => {
      expect(BYOKPutKeyBodySchema.parse({ apiKey: "sk-ant-api03-abcdef1234567890" })).toEqual({
        apiKey: "sk-ant-api03-abcdef1234567890"
      });

      expect(BYOKPutKeyBodySchema.parse({ apiKey: "AIzaSyDummyGeminiKeyValid123456" })).toEqual({
        apiKey: "AIzaSyDummyGeminiKeyValid123456"
      });
    });

    it("rejects keys that are too short, too long, or whitespace", () => {
      expect(() => BYOKPutKeyBodySchema.parse({ apiKey: "short" })).toThrow();
      expect(() => BYOKPutKeyBodySchema.parse({ apiKey: "" })).toThrow();
      expect(() => BYOKPutKeyBodySchema.parse({ apiKey: "a".repeat(513) })).toThrow();
    });
  });

  describe("BYOKKeyMetadataSchema & Response List", () => {
    it("validates well-formed key metadata", () => {
      const meta = {
        provider: "anthropic" as const,
        keyVersion: 1,
        last4: "7890",
        masked: "••••7890",
        createdAt: 1731180000000,
        updatedAt: 1731180000000,
        active: true
      };

      const parsed = BYOKKeyMetadataSchema.parse(meta);
      expect(parsed).toEqual(meta);

      const list = BYOKKeyResponseListSchema.parse({ keys: [meta] });
      expect(list.keys).toHaveLength(1);
    });
  });

  describe("BYOKKeyTestResultSchema & BYOKRekeyResultSchema", () => {
    it("validates test and rekey result schemas", () => {
      const testResult = {
        provider: "google" as const,
        valid: true,
        message: "Key verification successful",
        latencyMs: 42
      };
      expect(BYOKKeyTestResultSchema.parse(testResult)).toEqual(testResult);

      const rekeyResult = {
        total: 10,
        rotated: 8,
        failed: 0,
        skipped: 2,
        newKeyVersion: 2
      };
      expect(BYOKRekeyResultSchema.parse(rekeyResult)).toEqual(rekeyResult);
    });
  });

  describe("maskApiKey & extractLast4", () => {
    it("masks key showing only last 4 characters", () => {
      expect(maskApiKey("sk-ant-api03-abcdef1234567890")).toBe("••••7890");
      expect(extractLast4("sk-ant-api03-abcdef1234567890")).toBe("7890");
      expect(maskApiKey("1234")).toBe("••••1234");
      expect(extractLast4("1234")).toBe("1234");
    });

    it("handles keys shorter than 4 characters gracefully", () => {
      expect(maskApiKey("abc")).toBe("••••abc");
      expect(extractLast4("abc")).toBe("abc");
      expect(maskApiKey("")).toBe("••••");
      expect(extractLast4("")).toBe("");
    });
  });
});
