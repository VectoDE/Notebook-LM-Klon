/**
 * Studio-Viewer werden erst geladen, wenn sie gebraucht werden (Issue #257, LCP mobil).
 * Die Startseite zeigt keinen von ihnen; ihr Code gehört nicht ins erste Bundle.
 *
 * lazyWithPreload liefert eine Komponente, die nach preload() direkt rendert (ohne Suspense).
 * So bleiben Server-Render-Tests und ein zweites Öffnen ohne Ladezustand.
 */
import { type ComponentType, type ReactNode, Suspense, createElement, lazy } from "react";

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
  const Viewer = (props: P): ReactNode =>
    loaded
      ? createElement(loaded, props)
      : createElement(
          Suspense,
          {
            fallback: createElement("div", { className: "rn-viewer-loading", "aria-busy": "true" })
          },
          createElement(Lazy as unknown as ComponentType<P>, props)
        );
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

/** Lädt alle Studio-Viewer vorab, z. B. in Tests oder wenn der Browser untätig ist. */
export async function preloadStudioViewers(): Promise<void> {
  await Promise.all(
    [
      LazyMindmapViewer,
      LazyFlashcardsViewer,
      LazyQuizViewer,
      LazyVideoOverviewPlayer,
      LazyInteractiveAudioHostPlayer
    ].map((viewer) => viewer.preload())
  );
}
