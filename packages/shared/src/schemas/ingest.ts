import { z } from "zod";

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
