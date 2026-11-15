import { type CleanupMetrics, runScheduledCleanup } from "../cleanup.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";

/**
 * Replacement for the Cloudflare cron trigger on the Node runtime. It runs the same
 * `runScheduledCleanup()` that `scheduled()` in src/index.ts runs on Cloudflare
 * (wrangler.jsonc: "0 * * * *", hourly), on a fixed interval inside the server.
 * A run never overlaps the previous one. For an external cron (host cron, Kubernetes
 * CronJob) the same cleanup is available once via `node-server.js cleanup`.
 */

/** Same cadence as the Cloudflare cron trigger "0 * * * *". */
export const DEFAULT_CLEANUP_INTERVAL_MINUTES = 60;

export interface CleanupSchedulerOptions {
  readonly env: Pick<Env, "DB" | "MEDIA">;
  readonly intervalMs: number;
  readonly run?: typeof runScheduledCleanup;
  readonly log?: Pick<Console, "info" | "error">;
}

export interface CleanupScheduler {
  /** Runs one cleanup now unless one is already running (then returns undefined). */
  runOnce(): Promise<CleanupMetrics | undefined>;
  stop(): void;
}

export async function runCleanupOnce(
  env: Pick<Env, "DB" | "MEDIA">,
  run: typeof runScheduledCleanup = runScheduledCleanup,
  log: Pick<Console, "info" | "error"> = console
): Promise<CleanupMetrics> {
  const metrics = await run({ db: createD1DatabaseAdapter(env.DB), mediaBucket: env.MEDIA });
  // Same log line as scheduled() on Cloudflare, so both runtimes are monitored alike.
  log.info(JSON.stringify({ event: "scheduled_cleanup_completed", metrics }));
  return metrics;
}

export function startCleanupScheduler(options: CleanupSchedulerOptions): CleanupScheduler {
  const log = options.log ?? console;
  let running: Promise<CleanupMetrics | undefined> | undefined;

  const runOnce = (): Promise<CleanupMetrics | undefined> => {
    if (running) {
      return Promise.resolve(undefined);
    }
    running = runCleanupOnce(options.env, options.run, log)
      .catch((err: unknown) => {
        log.error(JSON.stringify({ event: "scheduled_cleanup_failed", error: String(err) }));
        return undefined;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  const timer = setInterval(() => {
    void runOnce();
  }, options.intervalMs);
  timer.unref();

  return {
    runOnce,
    stop: () => clearInterval(timer)
  };
}
