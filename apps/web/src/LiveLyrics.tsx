/**
 * Apple-Music-style Live Scrolling Lyrics / Transcript Component.
 *
 * Implements Sub-Issue #130:
 * - Fluid auto-scrolling transcript lines with active sentence highlighting and dimming of inactive lines.
 * - Click-to-seek jump when selecting a sentence.
 * - High accessibility: keyboard navigation (Enter/Space to jump), aria-current, polite live updates.
 */

import { useEffect, useRef } from "react";

export interface TranscriptLine {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker: "hostA" | "hostB" | string;
  readonly speakerName: string;
  readonly text: string;
}

export interface LiveLyricsProps {
  readonly lines: readonly TranscriptLine[];
  readonly currentTimeMs: number;
  readonly onSeek?: ((targetMs: number) => void) | undefined;
  readonly isPlaying?: boolean | undefined;
  readonly reducedMotion?: boolean | undefined;
}

/** Systemeinstellung „Bewegung reduzieren“; ohne window (Server-Rendering) false. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

export function LiveLyrics({
  lines,
  currentTimeMs,
  onSeek,
  isPlaying: _isPlaying = false,
  reducedMotion = false
}: LiveLyricsProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  // Aktive Zeile: an der Grenze zweier Zeilen gewinnt die spätere (Sprung auf startMs trifft sie)
  const activeIndex = lines.findLastIndex(
    (line) => currentTimeMs >= line.startMs && currentTimeMs <= line.endMs
  );

  // Aktive Zeile in die Mitte rollen: bei jedem Zeilenwechsel, ohne Animation bei reduzierter Bewegung
  useEffect(() => {
    if (activeIndex < 0 || !activeLineRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const activeEl = activeLineRef.current;

    const targetTop =
      activeEl.offsetTop -
      container.offsetTop -
      container.clientHeight / 2 +
      activeEl.clientHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reducedMotion || prefersReducedMotion() ? "auto" : "smooth"
    });
  }, [activeIndex, reducedMotion]);

  return (
    <section
      ref={containerRef}
      aria-label="Live Transkript und Songtexte"
      className="rn-lyrics"
      data-testid="live-lyrics-container"
      data-reduced-motion={reducedMotion ? "true" : undefined}
    >
      {lines.map((line, idx) => {
        const isActive = idx === activeIndex;
        const isPast = activeIndex !== -1 && idx < activeIndex;
        const state = isActive ? "active" : isPast ? "past" : "next";

        return (
          <button
            type="button"
            key={line.id}
            ref={isActive ? activeLineRef : null}
            aria-current={isActive ? "location" : undefined}
            aria-label={`${line.speakerName}: ${line.text}`}
            onClick={() => onSeek?.(line.startMs)}
            data-testid={`lyrics-line-${line.id}`}
            className="rn-lyrics-line"
            data-state={state}
            data-speaker={line.speaker}
          >
            <span className="rn-lyrics-speaker">{line.speakerName}</span>
            <span className="rn-lyrics-text">{line.text}</span>
          </button>
        );
      })}
    </section>
  );
}
