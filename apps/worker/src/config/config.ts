import {
  type DeploymentProfile,
  DeploymentProfileSchema,
  MAX_WORDS_PER_SOURCE
} from "@notebook-lm/shared";
import {
  FREE_TIER_R2_BUDGET,
  MAX_GUEST_STORAGE_BYTES,
  MAX_USER_STORAGE_BYTES,
  type R2BudgetLimits
} from "./r2-budget.js";

export interface ProfileQuotas {
  readonly maxNotebooksPerUser: number;
  readonly maxSourcesPerNotebook: number;
  readonly maxChunksPerNotebook: number;
  readonly maxSourceBytes: number;
  readonly maxNotebookBytes: number;
  readonly maxWordsPerSource: number;
  /** Summe byte_size aller Quellen in Notebooks eines angemeldeten Nutzers. */
  readonly maxUserStorageBytes: number;
  /** Summe byte_size aller Quellen in Notebooks eines Gasts. */
  readonly maxGuestStorageBytes: number;
  /** Globale R2-Grenzen zum Schutz der Freimenge; null = keine (bezahlter Plan). */
  readonly r2Budget: R2BudgetLimits | null;
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
  maxUserStorageBytes: MAX_USER_STORAGE_BYTES,
  maxGuestStorageBytes: MAX_GUEST_STORAGE_BYTES,
  r2Budget: FREE_TIER_R2_BUDGET,
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
  maxUserStorageBytes: 20 * 1024 * 1024 * 1024,
  maxGuestStorageBytes: MAX_GUEST_STORAGE_BYTES,
  r2Budget: null,
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
