import { z } from "zod";

export { WORKSPACE_VERSION } from "./version.js";

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
  MAX_WORDS_PER_SOURCE,
  TextTooLargeError,
  chunkText,
  countUniqueWords,
  countWords,
  estimateTokenCount,
  type ChunkInput,
  type TextChunk,
  type WordCountChunk
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

// ---------------------------------------------------------------------------
// RAG & Hybrid Search API Schemas (Decision #7, #40, #58 - Sub-Issues #98, #99, #100)
// ---------------------------------------------------------------------------

export const SearchModeSchema = z.enum(["hybrid", "vector", "fts"]);
export type SearchMode = z.infer<typeof SearchModeSchema>;

export const SearchQueryBodySchema = z.object({
  query: z.string().trim().min(1, "Suchanfrage darf nicht leer sein."),
  queryVector: z.array(z.number()).optional(),
  limit: z.number().int().positive().max(100).default(10),
  sourceIds: z.array(z.string().min(1)).optional(),
  mode: SearchModeSchema.default("hybrid")
});
export type SearchQueryBody = z.infer<typeof SearchQueryBodySchema>;

export const ChatRequestBodySchema = z.object({
  message: z.string().min(1).max(32_000),
  chatId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxChunks: z.number().int().min(1).max(50).default(10)
});
export type ChatRequestBody = z.infer<typeof ChatRequestBodySchema>;

export const AiActMetadataSchema = z.object({
  aiGenerated: z.literal(true),
  provider: z.string().min(1),
  model: z.string().min(1),
  timestamp: z.string().datetime(),
  latencyMs: z.number().nonnegative().optional()
});
export type AiActMetadata = z.infer<typeof AiActMetadataSchema>;

export const ChatMessageItemSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  citations: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
  latencyMs: z.number().nullable().optional(),
  tokenUsage: z.record(z.string(), z.unknown()).optional().nullable(),
  aiGenerated: z.boolean(),
  createdAt: z.number()
});
export type ChatMessageItem = z.infer<typeof ChatMessageItemSchema>;

export const ChatMessagesResponseSchema = z.object({
  chatId: z.string().min(1),
  messages: z.array(ChatMessageItemSchema)
});
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;

export const SearchCitationSchema = z.object({
  chunkId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceTitle: z.string(),
  page: z.number().int().positive().nullable(),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  score: z.number(),
  snippet: z.string(),
  vectorRank: z.number().int().positive().nullable().optional(),
  ftsRank: z.number().int().positive().nullable().optional(),
  vectorScore: z.number().nullable().optional(),
  ftsScore: z.number().nullable().optional()
});
export type SearchCitation = z.infer<typeof SearchCitationSchema>;

export const SearchResponseSchema = z.object({
  notebookId: z.string().min(1),
  query: z.string(),
  mode: SearchModeSchema,
  totalResults: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  results: z.array(SearchCitationSchema)
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/**
 * Standard Reciprocal Rank Fusion constant (k = 60).
 */
export const RRF_K_DEFAULT = 60;

export interface RrfScoredItem<T> {
  item: T;
  score: number;
  rank1?: number | undefined;
  rank2?: number | undefined;
  score1?: number | undefined;
  score2?: number | undefined;
}

/**
 * Reciprocal Rank Fusion combiner for two ranked result lists.
 * Formula: RRF(doc) = w1 / (k + rank1) + w2 / (k + rank2)
 */
export function combineWithRrf<T, K extends string | number>(
  list1: readonly T[],
  list2: readonly T[],
  getId: (item: T) => K,
  options?: {
    k?: number | undefined;
    weight1?: number | undefined;
    weight2?: number | undefined;
    getScore1?: ((item: T) => number) | undefined;
    getScore2?: ((item: T) => number) | undefined;
  }
): RrfScoredItem<T>[] {
  const k = options?.k ?? RRF_K_DEFAULT;
  const w1 = options?.weight1 ?? 1.0;
  const w2 = options?.weight2 ?? 1.0;

  const scoreMap = new Map<
    K,
    {
      item: T;
      score: number;
      rank1?: number | undefined;
      rank2?: number | undefined;
      score1?: number | undefined;
      score2?: number | undefined;
    }
  >();

  let rank1 = 1;
  for (const item of list1) {
    const id = getId(item);
    const rrfScore = w1 / (k + rank1);
    const origScore = options?.getScore1 ? options.getScore1(item) : undefined;
    scoreMap.set(id, {
      item,
      score: rrfScore,
      rank1,
      score1: origScore
    });
    rank1++;
  }

  let rank2 = 1;
  for (const item of list2) {
    const id = getId(item);
    const rrfScore = w2 / (k + rank2);
    const origScore = options?.getScore2 ? options.getScore2(item) : undefined;
    const existing = scoreMap.get(id);
    if (existing) {
      existing.score += rrfScore;
      existing.rank2 = rank2;
      existing.score2 = origScore;
    } else {
      scoreMap.set(id, {
        item,
        score: rrfScore,
        rank2,
        score2: origScore
      });
    }
    rank2++;
  }

  return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
}

export * from "./demo/index.js";

// Job & Studio background processing schemas (Issues #22, #110, #111, #112)
export const JobKindSchema = z.enum([
  "audio_overview",
  "video_overview",
  "mindmap",
  "flashcards",
  "quiz",
  "faq",
  "timeline",
  "briefing",
  "gdpr_export"
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobRecordSchema = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  kind: JobKindSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive()
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const EnqueueJobBodySchema = z.object({
  id: z.string().min(1).optional(),
  notebookId: z.string().min(1),
  kind: JobKindSchema,
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  maxAttempts: z.number().int().min(1).max(10).optional().default(3)
});
export type EnqueueJobBody = z.infer<typeof EnqueueJobBodySchema>;

export const JobFilterQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  kind: JobKindSchema.optional(),
  notebookId: z.string().optional()
});
export type JobFilterQuery = z.infer<typeof JobFilterQuerySchema>;

export const JobProgressEventSchema = z.object({
  type: z.literal("job_progress"),
  jobId: z.string().min(1),
  notebookId: z.string().min(1),
  kind: JobKindSchema,
  progress: z.number().min(0).max(100),
  status: JobStatusSchema,
  timestamp: z.number().int()
});
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;

export const JobCompletedEventSchema = z.object({
  type: z.literal("job_completed"),
  jobId: z.string().min(1),
  notebookId: z.string().min(1),
  kind: JobKindSchema,
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  timestamp: z.number().int()
});
export type JobCompletedEvent = z.infer<typeof JobCompletedEventSchema>;

export const JobFailedEventSchema = z.object({
  type: z.literal("job_failed"),
  jobId: z.string().min(1),
  notebookId: z.string().min(1),
  kind: JobKindSchema,
  error: z.string(),
  attempts: z.number().int(),
  timestamp: z.number().int()
});
export type JobFailedEvent = z.infer<typeof JobFailedEventSchema>;

export const JobBroadcastEventSchema = z.discriminatedUnion("type", [
  JobProgressEventSchema,
  JobCompletedEventSchema,
  JobFailedEventSchema
]);
export type JobBroadcastEvent = z.infer<typeof JobBroadcastEventSchema>;

export type * from "./providers.d.js";

export type * from "./models.d.js";

export * from "./chat-context.js";
export * from "./citation-parser.js";
export * from "./audio-interject-types.js";
export * from "./podcast-state-machine.js";
export * from "./video-storyboard.js";
export * from "./sm2.js";
export * from "./studio-artifacts.js";
export * from "./entity-graph.js";
export * from "./studio-structured.js";
