import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LazyFlashcardsViewer,
  LazyInteractiveAudioHostPlayer,
  LazyMindmapViewer,
  LazyQuizViewer,
  LazyVideoOverviewPlayer,
  lazyWithPreload,
  preloadStudioViewers
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
});
