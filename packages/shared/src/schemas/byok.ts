import { z } from "zod";

// ---------------------------------------------------------------------------
// BYOK Key Management Schemas (Decision #8, #41 - Sub-Issues #92, #93, #94)
// ---------------------------------------------------------------------------

export const ProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "groq",
  "deepseek",
  "mistral",
  "custom"
]);
export type ProviderTypeEnum = z.infer<typeof ProviderTypeSchema>;

export const BYOKProviderSchema = ProviderTypeSchema;
export type BYOKProvider = ProviderTypeEnum;

export const BYOKPutKeyBodySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(10, "API-Key muss mindestens 10 Zeichen lang sein.")
    .max(512, "API-Key darf maximal 512 Zeichen lang sein.")
});
export type BYOKPutKeyBody = z.infer<typeof BYOKPutKeyBodySchema>;

export const BYOKKeyMetadataSchema = z.object({
  provider: BYOKProviderSchema,
  keyVersion: z.number().int().positive(),
  last4: z.string().max(4),
  masked: z.string().min(4),
  createdAt: z.number(),
  updatedAt: z.number(),
  active: z.boolean()
});
export type BYOKKeyMetadata = z.infer<typeof BYOKKeyMetadataSchema>;

export const BYOKKeyResponseListSchema = z.object({
  keys: z.array(BYOKKeyMetadataSchema)
});
export type BYOKKeyResponseList = z.infer<typeof BYOKKeyResponseListSchema>;

export const BYOKKeyTestResultSchema = z.object({
  provider: BYOKProviderSchema,
  valid: z.boolean(),
  message: z.string(),
  latencyMs: z.number().nonnegative()
});
export type BYOKKeyTestResult = z.infer<typeof BYOKKeyTestResultSchema>;

export const BYOKRekeyResultSchema = z.object({
  total: z.number().int().nonnegative(),
  rotated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  newKeyVersion: z.number().int().positive()
});
export type BYOKRekeyResult = z.infer<typeof BYOKRekeyResultSchema>;

/**
 * Extracts the last 4 characters of an API key safely.
 */
export function extractLast4(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}

/**
 * Returns bullet-masked representation of an API key (e.g. ••••1a2b).
 */
export function maskApiKey(apiKey: string): string {
  return `\u2022\u2022\u2022\u2022${extractLast4(apiKey)}`;
}
