import type { PodcastStateMachine } from "@notebook-lm/shared";
import { useEffect, useRef, useState } from "react";
import { AuroraOrb } from "./AuroraOrb.js";
import { Icon } from "./Icon.js";
import { LiveLyrics, type TranscriptLine } from "./LiveLyrics.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { useTheme } from "./useTheme.js";

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
  /** Ziel für den Fokus nach dem Schließen, wenn der Auslöser ihn nicht mehr annimmt. */
  readonly returnFocusFallback?: (() => HTMLElement | null | undefined) | undefined;
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

function orbSpeaker(speaker: string | undefined): "hostA" | "hostB" | null {
  return speaker === "hostA" || speaker === "hostB" ? speaker : null;
}

export function DeepDiveStage({
  isOpen,
  onClose,
  notebookTitle = "RelationNotes Deep Dive Studio",
  transcriptLines = DEFAULT_TRANSCRIPT,
  currentTimeMs = 2500,
  isPlaying = false,
  stateMachine: _stateMachine,
  onSeek,
  onAskQuestion,
  returnFocusFallback
}: DeepDiveStageProps) {
  const { t } = useTheme();
  const [internalTimeMs, setInternalTimeMs] = useState(currentTimeMs);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Vor showModal(): Auslöser merken, nach dem Schließen dorthin zurück
  useReturnFocus(isOpen, returnFocusFallback);

  // Modal öffnen: Hintergrund wird inert, Escape löst "cancel" aus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSeek = (targetMs: number) => {
    setInternalTimeMs(targetMs);
    onSeek?.(targetMs);
  };

  const activeLine = transcriptLines.find(
    (line) => internalTimeMs >= line.startMs && internalTimeMs <= line.endMs
  );

  return (
    <dialog
      ref={dialogRef}
      className="rn-stage"
      aria-labelledby="deep-dive-stage-title"
      data-testid="deep-dive-stage"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="rn-stage-head">
        <div className="rn-stage-heading">
          <p className="rn-stage-eyebrow">
            <span className="rn-stage-live" aria-hidden="true" />
            {t("stageEyebrow")}
          </p>
          <h2 id="deep-dive-stage-title" className="rn-stage-title">
            {notebookTitle}
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          data-testid="btn-close-deep-dive-stage"
          aria-label={t("cinemaStageClose")}
          className="rn-stage-close"
        >
          <Icon name="close" size={22} />
        </button>
      </header>

      <div className="rn-stage-body">
        <div className="rn-stage-orb">
          {/* Der Sprechername steht nur im Transkript; der Orb zeigt den Wechsel farblich */}
          <AuroraOrb
            isPlaying={isPlaying}
            audioLevel={0.6}
            activeSpeaker={orbSpeaker(activeLine?.speaker)}
            width={240}
            height={240}
          />
        </div>

        <div className="rn-stage-lyrics">
          <LiveLyrics
            lines={transcriptLines}
            currentTimeMs={internalTimeMs}
            onSeek={handleSeek}
            isPlaying={isPlaying}
          />
        </div>
      </div>

      <footer className="rn-stage-foot">
        <button
          type="button"
          onClick={onAskQuestion}
          data-testid="btn-deep-dive-interject"
          className="rn-stage-btn rn-stage-btn--primary rn-stage-btn--large"
        >
          {t("stageJoin")}
        </button>

        <p className="rn-stage-note">{t("stageNote")}</p>
      </footer>
    </dialog>
  );
}
