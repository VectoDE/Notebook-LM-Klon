import { z } from "zod";

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
