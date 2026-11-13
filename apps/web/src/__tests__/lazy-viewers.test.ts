import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LazyFlashcardsViewer,
  LazyInteractiveAudioHostPlayer,
  LazyMindmapViewer,
  LazyQuizViewer,
  LazyVideoOverviewPlayer,
  lazyWithPreload,
  preloadMediaPlayers,
  preloadStudioViewers,
  scheduleStudioViewerPreload
} from "../lazy-viewers.js";

describe("Studio-Viewer lazy laden (#257)", () => {
  it("zeigt vor dem Laden einen Ladezustand und danach die Komponente", async () => {
    const Greeting = ({ name }: { name: string }) => createElement("p", null, `Hallo ${name}`);
    let calls = 0;
    const Viewer = lazyWithPreload(async () => {
      calls += 1;
      return Greeting;
    });

    const before = renderToStaticMarkup(createElement(Viewer, { name: "Welt" }));
    expect(before).toContain('class="rn-viewer-loading"');
    expect(before).toContain('aria-busy="true"');
    expect(before).not.toContain("Hallo");

    await expect(Viewer.preload()).resolves.toBe(Greeting);
    expect(renderToStaticMarkup(createElement(Viewer, { name: "Welt" }))).toBe("<p>Hallo Welt</p>");
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("lädt alle Studio-Viewer vorab", async () => {
    await preloadStudioViewers();
    for (const viewer of [
      LazyMindmapViewer,
      LazyFlashcardsViewer,
      LazyQuizViewer,
      LazyVideoOverviewPlayer,
      LazyInteractiveAudioHostPlayer
    ]) {
      await expect(viewer.preload()).resolves.toBeTypeOf("function");
    }
  });

  it("lädt die Medien-Player auf Absicht vor (#350)", async () => {
    await expect(preloadMediaPlayers()).resolves.toHaveLength(2);
    await expect(LazyVideoOverviewPlayer.preload()).resolves.toBeTypeOf("function");
  });

  it("plant das Vorladen über den Leerlauf-Planer ein", async () => {
    let planned: (() => void) | undefined;
    scheduleStudioViewerPreload((callback) => {
      planned = callback;
    });
    expect(planned).toBeTypeOf("function");
    planned?.();
    await expect(LazyQuizViewer.preload()).resolves.toBeTypeOf("function");
  });

  it("nutzt requestIdleCallback, sonst setTimeout", () => {
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    scheduleStudioViewerPreload();
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
    vi.unstubAllGlobals();

    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    scheduleStudioViewerPreload();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    vi.runAllTimers();
    timeout.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
