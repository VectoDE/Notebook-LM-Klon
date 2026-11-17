import { z } from "zod";

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
