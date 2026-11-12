import { describe, expect, it, vi } from "vitest";
import { TOAST_DURATION_MS, type ToastClock, createToastTimer } from "../toast-timer.js";

/** Steuerbare Uhr: Zeit läuft nur per advance(). */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: ToastClock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    }
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  return { clock, advance, pending: () => timers.size };
}

describe("Hinweis-Leiste: Zeitsteuerung (Issue #329, WCAG 2.2.1)", () => {
  it("verschwindet nach rund 5 Sekunden", () => {
    expect(TOAST_DURATION_MS).toBe(5000);
    const { clock, advance } = fakeClock();
    const onExpire = vi.fn();
    const timer = createToastTimer(onExpire, clock);
    advance(4999);
    expect(onExpire).not.toHaveBeenCalled();
    expect(timer.remaining()).toBe(1);
    advance(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(timer.remaining()).toBe(0);
  });

  it("Zeiger oder Fokus halten die Zeit an, danach läuft nur die Restzeit", () => {
    const { clock, advance } = fakeClock();
    const onExpire = vi.fn();
    const timer = createToastTimer(onExpire, clock, 1000);
    advance(400);
    timer.pause();
    timer.pause(); // Fokus zusätzlich zum Zeiger
    advance(10_000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(timer.remaining()).toBe(600);
    timer.resume(); // Zeiger weg, Fokus noch da
    advance(10_000);
    expect(onExpire).not.toHaveBeenCalled();
    timer.resume();
    advance(599);
    expect(onExpire).not.toHaveBeenCalled();
    advance(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("überzähliges Weiterlaufen und Aktionen nach dem Ablauf bleiben ohne Wirkung", () => {
    const { clock, advance, pending } = fakeClock();
    const onExpire = vi.fn();
    const timer = createToastTimer(onExpire, clock, 100);
    timer.resume();
    expect(pending()).toBe(1);
    advance(100);
    timer.pause();
    timer.resume();
    expect(pending()).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("dispose beendet ohne onExpire, auch während einer Pause", () => {
    const { clock, advance, pending } = fakeClock();
    const onExpire = vi.fn();
    const timer = createToastTimer(onExpire, clock, 100);
    advance(30);
    timer.dispose();
    expect(pending()).toBe(0);
    expect(timer.remaining()).toBe(70);
    advance(1000);
    expect(onExpire).not.toHaveBeenCalled();

    const paused = createToastTimer(onExpire, clock, 100);
    paused.pause();
    paused.dispose();
    paused.resume();
    advance(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
