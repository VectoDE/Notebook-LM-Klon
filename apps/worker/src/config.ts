import { type DeploymentProfile, DeploymentProfileSchema } from "@notebook-lm/shared";

export interface ProfileQuotas {
  readonly maxNotebooksPerUser: number;
  readonly maxSourcesPerNotebook: number;
  readonly maxChunksPerNotebook: number;
  readonly maxSourceBytes: number;
  readonly maxWordsPerSource: number;
  readonly maxLlmCallsPerDay: number;
  readonly guestTtlHours: number;
  readonly demoNotebookTtlDays: number | null;
}

export interface AppConfig {
  readonly profile: DeploymentProfile;
  readonly origin: string;
  readonly quotas: ProfileQuotas;
}

const DEMO_QUOTAS: ProfileQuotas = {
  maxNotebooksPerUser: 3,
  maxSourcesPerNotebook: 15,
  maxChunksPerNotebook: 5_000,
  maxSourceBytes: 25 * 1024 * 1024,
  maxWordsPerSource: 150_000,
  maxLlmCallsPerDay: 50,
  guestTtlHours: 24,
  demoNotebookTtlDays: 30
};

const FULL_QUOTAS: ProfileQuotas = {
  maxNotebooksPerUser: 100,
  maxSourcesPerNotebook: 50,
  maxChunksPerNotebook: 50_000,
  maxSourceBytes: 50 * 1024 * 1024,
  maxWordsPerSource: 500_000,
  maxLlmCallsPerDay: 2_000,
  guestTtlHours: 24,
  demoNotebookTtlDays: null
};

export function resolveAppConfig(env: {
  readonly APP_PROFILE?: string | undefined;
  readonly APP_ORIGIN?: string | undefined;
}): AppConfig {
  const parsedProfile = DeploymentProfileSchema.safeParse(env.APP_PROFILE);
  const profile: DeploymentProfile = parsedProfile.success ? parsedProfile.data : "demo";

  return {
    profile,
    origin: env.APP_ORIGIN ?? "http://localhost:8787",
    quotas: profile === "full" ? FULL_QUOTAS : DEMO_QUOTAS
  };
}
