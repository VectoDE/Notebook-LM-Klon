import { afterEach, describe, expect, it, vi } from "vitest";
import type { CleanupMetrics } from "../cleanup.js";
import {
  DEFAULT_CLEANUP_INTERVAL_MINUTES,
  runCleanupOnce,
  startCleanupScheduler
} from "../node/scheduler.js";

const METRICS: CleanupMetrics = {
  deletedGuests: 1,
  deletedSessions: 2,
  deletedMagicLinks: 0,
  deletedChallenges: 0,
  deletedNotebooks: 0,
  deletedR2Objects: 0,
  durationMs: 3
};
const ENV = { DB: {} as D1Database, MEDIA: {} as R2Bucket };

afterEach(() => {
  vi.useRealTimers();
});

describe("cleanup scheduler (cron replacement, #334)", () => {
  it("uses the cadence of the Cloudflare cron '0 * * * *'", () => {
    expect(DEFAULT_CLEANUP_INTERVAL_MINUTES).toBe(60);
  });

  it("runCleanupOnce runs runScheduledCleanup with DB and MEDIA and logs like scheduled()", async () => {
    const run = vi.fn(async () => METRICS);
    const info = vi.fn();
    expect(await runCleanupOnce(ENV, run, { info, error: vi.fn() })).toBe(METRICS);
    expect(run).toHaveBeenCalledWith({ db: expect.any(Object), mediaBucket: ENV.MEDIA });
    expect(info).toHaveBeenCalledWith(
      JSON.stringify({ event: "scheduled_cleanup_completed", metrics: METRICS })
    );
  });

  it("runCleanupOnce logs to the console by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await runCleanupOnce(ENV, async () => METRICS);
      expect(info).toHaveBeenCalledOnce();
    } finally {
      info.mockRestore();
    }
  });

  it("runs on every interval tick and stops cleanly", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => METRICS);
    const scheduler = startCleanupScheduler({
      env: ENV,
      intervalMs: 60_000,
      run,
      log: { info: vi.fn(), error: vi.fn() }
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never overlaps: a second run while one is active is skipped", async () => {
    let release: (m: CleanupMetrics) => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<CleanupMetrics>((resolve) => {
          release = resolve;
        })
    );
    const scheduler = startCleanupScheduler({
      env: ENV,
      intervalMs: 3_600_000,
      run,
      log: { info: vi.fn(), error: vi.fn() }
    });
    const first = scheduler.runOnce();
    expect(await scheduler.runOnce()).toBeUndefined();
    release(METRICS);
    expect(await first).toBe(METRICS);
    // Once finished, the next run starts again.
    const third = scheduler.runOnce();
    release(METRICS);
    expect(await third).toBe(METRICS);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("logs a failed run and keeps the scheduler alive", async () => {
    const error = vi.fn();
    const run = vi
      .fn<() => Promise<CleanupMetrics>>()
      .mockRejectedValueOnce(new Error("D1 busy"))
      .mockResolvedValueOnce(METRICS);
    const scheduler = startCleanupScheduler({
      env: ENV,
      intervalMs: 3_600_000,
      run,
      log: { info: vi.fn(), error }
    });
    expect(await scheduler.runOnce()).toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "scheduled_cleanup_failed", error: "Error: D1 busy" })
    );
    expect(await scheduler.runOnce()).toBe(METRICS);
    scheduler.stop();
  });

  it("logs to the console by default", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = startCleanupScheduler({
      env: ENV,
      intervalMs: 3_600_000,
      run: async () => {
        throw new Error("x");
      }
    });
    try {
      await scheduler.runOnce();
      expect(error).toHaveBeenCalledOnce();
    } finally {
      scheduler.stop();
      error.mockRestore();
    }
  });
});
