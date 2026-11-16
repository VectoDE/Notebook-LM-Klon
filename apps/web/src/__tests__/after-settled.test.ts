import { afterEach, describe, expect, it, vi } from "vitest";
import { afterSettled } from "../after-settled.js";

describe("afterSettled (#257, LCP mobil)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plant ohne DOM sofort mit der Wartezeit ein", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    afterSettled(run, 500);
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("wartet bei noch ladender Seite auf das Ereignis load", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", { readyState: "loading" });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    });
    const run = vi.fn();
    afterSettled(run, 100);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    listeners.get("load")?.();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("läuft sofort an, wenn die Seite schon geladen ist", () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const run = vi.fn();
    afterSettled(run, 10);
    vi.advanceTimersByTime(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("bricht die Planung ab, auch vor dem Ereignis load", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", { readyState: "loading" });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    });
    const run = vi.fn();
    const cancel = afterSettled(run, 100);
    cancel();
    expect(listeners.has("load")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();

    const run2 = vi.fn();
    vi.stubGlobal("document", { readyState: "complete" });
    const cancel2 = afterSettled(run2, 100);
    cancel2();
    vi.advanceTimersByTime(1000);
    expect(run2).not.toHaveBeenCalled();
  });
});
