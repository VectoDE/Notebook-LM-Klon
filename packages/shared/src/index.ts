import { z } from "zod";

export const WORKSPACE_VERSION = "0.1.0" as const;

export const DeploymentProfileSchema = z.enum(["demo", "full"]);
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const ServiceStatusSchema = z.enum(["ok", "degraded", "down"]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const HealthResponseSchema = z.object({
  status: ServiceStatusSchema,
  version: z.string().min(1),
  profile: DeploymentProfileSchema,
  timestamp: z.string().datetime(),
  services: z.object({
    d1: ServiceStatusSchema,
    r2: ServiceStatusSchema,
    durableObjects: ServiceStatusSchema
  })
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ValidationFieldErrorSchema = z.object({
  field: z.string().min(1),
  message: z.string().min(1)
});
export type ValidationFieldError = z.infer<typeof ValidationFieldErrorSchema>;

/**
 * RFC 9457 Problem Details for HTTP APIs.
 */
export const ProblemDetailsSchema = z.object({
  type: z.string().min(1).default("about:blank"),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().min(1),
  instance: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  errors: z.array(ValidationFieldErrorSchema).optional()
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export interface CreateProblemDetailsInput {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly type?: string;
  readonly instance?: string;
  readonly code?: string;
  readonly errors?: readonly ValidationFieldError[];
}

export function createProblemDetails(input: CreateProblemDetailsInput): ProblemDetails {
  return ProblemDetailsSchema.parse({
    type: input.type ?? "about:blank",
    title: input.title,
    status: input.status,
    detail: input.detail,
    ...(input.instance !== undefined ? { instance: input.instance } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.errors !== undefined ? { errors: [...input.errors] } : {})
  });
}

export { z, type ZodIssue } from "zod";

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

export { inspectTextEncoding, type EncodingInspectionReport } from "./encoding.js";
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_OVERLAP_TOKENS,
  MAX_WORDS_LIMIT,
  TextTooLargeError,
  chunkText,
  estimateTokenCount,
  type ChunkInput,
  type TextChunk
} from "./chunker.js";
export {
  quantizeFloat32ToInt8,
  dequantizeInt8ToFloat32,
  dotProductInt8,
  cosineSimilarityInt8,
  dotProductFloat32,
  cosineSimilarityFloat32,
  type QuantizedVector
} from "./quantization.js";

// ---------------------------------------------------------------------------
// Chunk & Vector Ingestion Schemas (Decision #7, #22, #58 - Sub-Issues #96, #97)
// ---------------------------------------------------------------------------

export const IngestChunkItemSchema = z.object({
  id: z.string().min(1).optional(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1, "Chunk text darf nicht leer sein."),
  tokenCount: z.number().int().nonnegative().optional(),
  pageNumber: z.number().int().positive().nullable().optional(),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  // Vector can be provided either pre-quantized (int8 numbers array + scale) or raw float32 array
  vector: z
    .union([
      z.object({
        quantized: z.array(z.number().int().min(-128).max(127)),
        scale: z.number().positive(),
        model: z.string().min(1).optional(),
        dimensions: z.number().int().positive().optional()
      }),
      z.object({
        float32: z.array(z.number()),
        model: z.string().min(1).optional()
      })
    ])
    .optional()
});
export type IngestChunkItem = z.infer<typeof IngestChunkItemSchema>;

export const IngestChunksBodySchema = z.object({
  chunks: z.array(IngestChunkItemSchema).min(1, "Mindestens ein Chunk erforderlich."),
  model: z.string().min(1).default("text-embedding-3-small"),
  markReady: z.boolean().default(true)
});
export type IngestChunksBody = z.infer<typeof IngestChunksBodySchema>;

export const IngestChunksResponseSchema = z.object({
  success: z.boolean(),
  sourceId: z.string(),
  notebookId: z.string(),
  chunksIngested: z.number().int().nonnegative(),
  vectorsIngested: z.number().int().nonnegative(),
  status: z.enum(["uploading", "processing", "ready", "error"])
});
export type IngestChunksResponse = z.infer<typeof IngestChunksResponseSchema>;

export type * from "./models.d.js";
