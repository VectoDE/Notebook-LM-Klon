import type { VideoStoryboard } from "@notebook-lm/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "./useTheme.js";
import "./video-export.css";
import {
  NarrationError,
  type NarrationFailure,
  VIDEO_EXPORT_TEXTS,
  fetchNarration,
  narrationText
} from "./video-export-plan.js";
import {
  VIDEO_EXPORT_ABORTED,
  type VideoExportResult,
  VideoExportUnsupportedError,
  exportVideoOverview
} from "./video-exporter.js";

export interface VideoExportPanelProps {
  readonly storyboard: VideoStoryboard;
  /** Für Tests austauschbar. */
  readonly exporter?: typeof exportVideoOverview | undefined;
  readonly narrationFetcher?: typeof fetchNarration | undefined;
}

type ExportStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "narrating" }
  | { readonly kind: "recording"; readonly percent: number }
  | { readonly kind: "done"; readonly result: VideoExportResult }
  | { readonly kind: "narration-failed"; readonly failure: NarrationFailure }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Export der Video-Übersicht als WebM (Issue #241): erst Sprecherton holen, dann aufnehmen.
 * Fehlt der Schlüssel, erklärt der Bereich warum und bietet den Export ohne Ton an.
 */
export function VideoExportPanel({
  storyboard,
  exporter = exportVideoOverview,
  narrationFetcher = fetchNarration
}: VideoExportPanelProps) {
  const { language } = useTheme();
  const txt = VIDEO_EXPORT_TEXTS[language];
  const headingId = useId();
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const run = async (withAudio: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    let narration: ArrayBuffer | undefined;
    if (withAudio) {
      setStatus({ kind: "narrating" });
      try {
        narration = await narrationFetcher({
          notebookId: storyboard.notebookId,
          text: narrationText(storyboard),
          lang: language,
          signal: controller.signal
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus({
          kind: "narration-failed",
          failure: err instanceof NarrationError ? err.kind : "unavailable"
        });
        return;
      }
    }
    setStatus({ kind: "recording", percent: 0 });
    try {
      const result = await exporter({
        storyboard,
        narration,
        signal: controller.signal,
        onProgress: (event) => {
          if (event.phase === "rendering") {
            setStatus({ kind: "recording", percent: event.progressPercent });
          }
        }
      });
      urlRef.current = result.downloadUrl;
      setStatus({ kind: "done", result });
    } catch (err) {
      if (err instanceof Error && err.message === VIDEO_EXPORT_ABORTED) {
        setStatus({ kind: "failed", message: txt.cancelled });
        return;
      }
      setStatus({
        kind: "failed",
        message: err instanceof VideoExportUnsupportedError ? txt.unsupported : txt.recordError
      });
    }
  };

  const busy = status.kind === "narrating" || status.kind === "recording";

  return (
    <section
      className="rn-video-export"
      aria-labelledby={headingId}
      aria-busy={busy}
      data-testid="video-export"
    >
      <h3 id={headingId} className="rn-video-export-title">
        {txt.heading}
      </h3>
      <p className="rn-video-export-format">{txt.format}</p>
      <div className="rn-video-export-actions">
        <button
          type="button"
          className="rn-stage-btn rn-stage-btn--primary"
          onClick={() => void run(true)}
          disabled={busy}
          data-testid="video-export-audio"
        >
          {txt.exportWithAudio}
        </button>
        <button
          type="button"
          className="rn-stage-btn"
          onClick={() => void run(false)}
          disabled={busy}
          data-testid="video-export-silent"
        >
          {txt.exportSilent}
        </button>
        {busy && (
          <button
            type="button"
            className="rn-stage-btn"
            onClick={() => abortRef.current?.abort()}
            data-testid="video-export-cancel"
          >
            {txt.cancel}
          </button>
        )}
      </div>

      <output
        aria-live="polite"
        className="rn-video-export-status"
        data-testid="video-export-status"
      >
        {status.kind === "narrating" && txt.narrating}
        {status.kind === "recording" && (
          <>
            {txt.rendering(status.percent)}
            <progress max={100} value={status.percent} aria-label={txt.heading} />
          </>
        )}
        {status.kind === "done" && txt.done(status.result.filename)}
      </output>

      {status.kind === "done" && (
        <p className="rn-video-export-result">
          <a
            href={status.result.downloadUrl}
            download={status.result.filename}
            className="rn-stage-btn rn-stage-btn--primary"
            data-testid="video-export-download"
            data-has-audio={status.result.hasAudio ? "true" : "false"}
          >
            {txt.download(status.result.filename)}
          </a>
          {!status.result.hasAudio && <span> {txt.silentNote}</span>}
        </p>
      )}

      {status.kind === "narration-failed" && (
        <p role="alert" className="rn-video-export-error" data-testid="video-export-error">
          {txt.failure[status.failure]}
        </p>
      )}
      {status.kind === "failed" && (
        <p role="alert" className="rn-video-export-error" data-testid="video-export-error">
          {status.message}
        </p>
      )}
    </section>
  );
}
