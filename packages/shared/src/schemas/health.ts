import { z } from "zod";

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
