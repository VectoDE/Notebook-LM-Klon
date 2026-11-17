import { z } from "zod";

// ---------------------------------------------------------------------------
// RAG & Hybrid Search API Schemas (Decision #7, #40, #58 - Sub-Issues #98, #99, #100)
// ---------------------------------------------------------------------------

export const ChatRequestBodySchema = z.object({
  message: z.string().min(1).max(32_000),
  chatId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxChunks: z.number().int().min(1).max(50).default(10),
  /** Sprache der Oberfläche: bestimmt den Text der ehrlichen Nichtantwort (Issue #243). */
  language: z.enum(["de", "en"]).optional()
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
  messages: z.array(ChatMessageItemSchema),
  /** Cursor für die nächstältere Seite; null, wenn der Verlauf vollständig ist (Issue #243). */
  nextCursor: z.string().min(1).nullable().optional()
});
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;
