/**
 * Studio-Viewer werden erst geladen, wenn sie gebraucht werden (Issue #257, LCP mobil).
 * Die Startseite zeigt keinen von ihnen; ihr Code gehört nicht ins erste Bundle.
 *
 * lazyWithPreload liefert eine Komponente, die nach preload() direkt rendert (ohne Ladezustand).
 * Der Komponententyp wird je Instanz beim Einhängen festgelegt; ein späteres Laden des Moduls
 * hängt eine bereits sichtbare Instanz nicht neu ein (Zustand und Fokus bleiben erhalten).
 */
import { type ComponentType, type ReactNode, Suspense, createElement, lazy, useState } from "react";

export interface PreloadableComponent<P extends object> {
  (props: P): ReactNode;
  preload: () => Promise<ComponentType<P>>;
}

export function lazyWithPreload<P extends object>(
  load: () => Promise<ComponentType<P>>
): PreloadableComponent<P> {
  let loaded: ComponentType<P> | undefined;
  const preload = async () => {
    loaded = await load();
    return loaded;
  };
  const Lazy = lazy(async () => ({ default: await preload() }));
  const Viewer = (props: P): ReactNode => {
    const [Component] = useState<ComponentType<P>>(
      () => loaded ?? (Lazy as unknown as ComponentType<P>)
    );
    return createElement(
      Suspense,
      { fallback: createElement("div", { className: "rn-viewer-loading", "aria-busy": "true" }) },
      createElement(Component, props)
    );
  };
  return Object.assign(Viewer, { preload });
}

export const LazyMindmapViewer = lazyWithPreload(() =>
  import("./MindmapViewer.js").then((m) => m.MindmapViewer)
);
export const LazyFlashcardsViewer = lazyWithPreload(() =>
  import("./FlashcardsViewer.js").then((m) => m.FlashcardsViewer)
);
export const LazyQuizViewer = lazyWithPreload(() =>
  import("./QuizViewer.js").then((m) => m.QuizViewer)
);
export const LazyVideoOverviewPlayer = lazyWithPreload(() =>
  import("./VideoOverviewPlayer.js").then((m) => m.VideoOverviewPlayer)
);
export const LazyInteractiveAudioHostPlayer = lazyWithPreload(() =>
  import("./InteractiveAudioHostPlayer.js").then((m) => m.InteractiveAudioHostPlayer)
);
export const LazyTimelineViewer = lazyWithPreload(() =>
  import("./StructuredTools.js").then((m) => m.TimelineViewer)
);
export const LazyInfographicViewer = lazyWithPreload(() =>
  import("./StructuredTools.js").then((m) => m.InfographicViewer)
);
export const LazyDataTableViewer = lazyWithPreload(() =>
  import("./StructuredTools.js").then((m) => m.DataTableViewer)
);

/** Lädt alle Studio-Viewer vorab, z. B. in Tests oder wenn der Browser untätig ist. */
export async function preloadStudioViewers(): Promise<void> {
  await Promise.all(
    [
      LazyMindmapViewer,
      LazyFlashcardsViewer,
      LazyQuizViewer,
      LazyVideoOverviewPlayer,
      LazyInteractiveAudioHostPlayer,
      LazyTimelineViewer,
      LazyInfographicViewer,
      LazyDataTableViewer
    ].map((viewer) => viewer.preload())
  );
}

type IdleScheduler = (callback: () => void) => void;

/** Plant das Vorladen nach dem ersten Rendern ein, wenn der Browser untätig ist. */
export function scheduleStudioViewerPreload(
  schedule: IdleScheduler = (callback) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(callback, { timeout: 4000 })
      : setTimeout(callback, 2000)
): void {
  schedule(() => {
    void preloadStudioViewers();
  });
}
