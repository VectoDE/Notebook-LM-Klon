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

export function LiveLyrics({
  lines,
  currentTimeMs,
  onSeek,
  isPlaying: _isPlaying = false,
  reducedMotion = false
}: LiveLyricsProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);

  // Find active line index
  const activeIndex = lines.findIndex(
    (line) => currentTimeMs >= line.startMs && currentTimeMs <= line.endMs
  );

  // Auto-scroll active line to center
  useEffect(() => {
    if (!activeLineRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const activeEl = activeLineRef.current;

    const targetTop =
      activeEl.offsetTop -
      container.offsetTop -
      container.clientHeight / 2 +
      activeEl.clientHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reducedMotion ? "auto" : "smooth"
    });
  }, [reducedMotion]);

  return (
    <section
      ref={containerRef}
      aria-label="Live Transkript und Songtexte"
      className="live-lyrics-container"
      data-testid="live-lyrics-container"
      style={{
        overflowY: "auto",
        maxHeight: "360px",
        padding: "32px 16px",
        scrollBehavior: reducedMotion ? "auto" : "smooth",
        display: "flex",
        flexDirection: "column",
        gap: "20px"
      }}
    >
      {lines.map((line, idx) => {
        const isActive = idx === activeIndex;
        const isPast = activeIndex !== -1 && idx < activeIndex;

        return (
          <button
            type="button"
            key={line.id}
            ref={isActive ? activeLineRef : null}
            aria-current={isActive ? "location" : undefined}
            aria-label={`${line.speakerName}: ${line.text}`}
            onClick={() => onSeek?.(line.startMs)}
            data-testid={`lyrics-line-${line.id}`}
            style={{
              cursor: "pointer",
              textAlign: "left",
              border: "none",
              transition: reducedMotion
                ? "none"
                : "opacity 300ms ease, transform 300ms ease, font-size 300ms ease",
              opacity: isActive ? 1.0 : isPast ? 0.45 : 0.65,
              transform: isActive && !reducedMotion ? "scale(1.03)" : "scale(1.0)",
              fontSize: isActive ? "1.35rem" : "1.05rem",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "var(--rn-color-text-primary)" : "var(--rn-color-text-muted)",
              padding: "8px 12px",
              borderRadius: "12px",
              background: isActive ? "rgba(255, 255, 255, 0.08)" : "transparent"
            }}
          >
            <div
              style={{
                fontSize: "0.875rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "4px",
                color: "var(--rn-color-accent)"
              }}
            >
              {line.speakerName}
            </div>
            <div>{line.text}</div>
          </button>
        );
      })}
    </section>
  );
}
