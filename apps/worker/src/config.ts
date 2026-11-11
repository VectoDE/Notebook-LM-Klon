import {
  type DeploymentProfile,
  DeploymentProfileSchema,
  MAX_WORDS_PER_SOURCE
} from "@notebook-lm/shared";

export interface ProfileQuotas {
  readonly maxNotebooksPerUser: number;
  readonly maxSourcesPerNotebook: number;
  readonly maxChunksPerNotebook: number;
  readonly maxSourceBytes: number;
  readonly maxNotebookBytes: number;
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
  maxSourcesPerNotebook: 50,
  maxChunksPerNotebook: 5_000,
  maxSourceBytes: 50 * 1024 * 1024,
  maxNotebookBytes: 200 * 1024 * 1024,
  maxWordsPerSource: MAX_WORDS_PER_SOURCE,
  maxLlmCallsPerDay: 50,
  guestTtlHours: 24,
  demoNotebookTtlDays: 30
};

const FULL_QUOTAS: ProfileQuotas = {
  maxNotebooksPerUser: 100,
  maxSourcesPerNotebook: 50,
  maxChunksPerNotebook: 50_000,
  maxSourceBytes: 50 * 1024 * 1024,
  maxNotebookBytes: 200 * 1024 * 1024,
  maxWordsPerSource: MAX_WORDS_PER_SOURCE,
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
