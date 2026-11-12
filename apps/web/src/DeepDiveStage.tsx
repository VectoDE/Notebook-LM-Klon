import type { PodcastStateMachine } from "@notebook-lm/shared";
import { useState } from "react";
import { AuroraOrb } from "./AuroraOrb.js";
import { LiveLyrics, type TranscriptLine } from "./LiveLyrics.js";

export interface DeepDiveStageProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly notebookTitle?: string | undefined;
  readonly transcriptLines?: readonly TranscriptLine[] | undefined;
  readonly currentTimeMs?: number | undefined;
  readonly isPlaying?: boolean | undefined;
  readonly stateMachine?: PodcastStateMachine | undefined;
  readonly onSeek?: ((targetMs: number) => void) | undefined;
  readonly onAskQuestion?: (() => void) | undefined;
}

const DEFAULT_TRANSCRIPT: readonly TranscriptLine[] = [
  {
    id: "line_1",
    startMs: 0,
    endMs: 5000,
    speaker: "hostA",
    speakerName: "Host Lea",
    text: "Willkommen zum Deep Dive! Heute analysieren wir die Architektur des Edge-Stacks."
  },
  {
    id: "line_2",
    startMs: 5000,
    endMs: 12000,
    speaker: "hostB",
    speakerName: "Host Jonas",
    text: "Genau, und wie D1 SQLite, FTS5 und int8-Quantisierung gemeinsam blitzschnelle RAG ermöglichen."
  },
  {
    id: "line_3",
    startMs: 12000,
    endMs: 20000,
    speaker: "hostA",
    speakerName: "Host Lea",
    text: "Lassen Sie uns direkt in die Datenquellen springen und die Details ansehen."
  }
];

export function DeepDiveStage({
  isOpen,
  onClose,
  notebookTitle = "RelationNotes Deep Dive Studio",
  transcriptLines = DEFAULT_TRANSCRIPT,
  currentTimeMs = 2500,
  isPlaying = false,
  stateMachine: _stateMachine,
  onSeek,
  onAskQuestion
}: DeepDiveStageProps) {
  const [internalTimeMs, setInternalTimeMs] = useState(currentTimeMs);

  if (!isOpen) return null;

  const handleSeek = (targetMs: number) => {
    setInternalTimeMs(targetMs);
    onSeek?.(targetMs);
  };

  return (
    <dialog
      open
      aria-labelledby="deep-dive-stage-title"
      data-testid="deep-dive-stage"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--rn-color-stage-bg)",
        color: "var(--rn-color-stage-text)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "24px",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        border: "none",
        boxSizing: "border-box"
      }}
    >
      {/* Stage Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          paddingBottom: "16px"
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.875rem",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--rn-color-stage-accent)",
              fontWeight: 700
            }}
          >
            Immersive Cinema Stage
          </span>
          <h2 id="deep-dive-stage-title" style={{ margin: "4px 0 0 0", fontSize: "1.4rem" }}>
            {notebookTitle}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          data-testid="btn-close-deep-dive-stage"
          aria-label="Deep-Dive-Bühne schließen"
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            color: "var(--rn-color-stage-text)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            fontSize: "1.2rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          ×
        </button>
      </header>

      {/* Stage Visuals: Aurora Orb & Synced Lyrics */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          padding: "20px 0"
        }}
      >
        <AuroraOrb isPlaying={isPlaying} audioLevel={0.6} width={280} height={280} />

        <div style={{ width: "100%", maxWidth: "640px" }}>
          <LiveLyrics
            lines={transcriptLines}
            currentTimeMs={internalTimeMs}
            onSeek={handleSeek}
            isPlaying={isPlaying}
          />
        </div>
      </div>

      {/* Stage Controls & Join Action */}
      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          paddingTop: "16px"
        }}
      >
        <button
          type="button"
          onClick={onAskQuestion}
          data-testid="btn-deep-dive-interject"
          style={{
            minHeight: "44px",
            padding: "10px 24px",
            borderRadius: "var(--rn-radius-lg)",
            background: "var(--rn-color-stage-accent)",
            color: "var(--rn-color-stage-bg)",
            fontWeight: 700,
            fontSize: "0.95rem",
            border: "none",
            cursor: "pointer"
          }}
        >
          Beitreten / Frage an die Hosts stellen
        </button>

        <span style={{ fontSize: "0.875rem", color: "var(--rn-color-stage-muted)" }}>
          Live-Audio-Synthese • Grounded Citations
        </span>
      </footer>
    </dialog>
  );
}
