import { z } from "zod";

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
