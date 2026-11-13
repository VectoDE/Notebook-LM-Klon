/**
 * Transkript-Ansicht für Audio und Video (Issue #350).
 *
 * Zeigt jeden Abschnitt mit Zeit, Sprecher und Text, bei Videos zusätzlich die
 * Bildbeschreibung. Die Zeit ist ein Knopf und springt an die Stelle. Bedientexte kommen
 * aus dem Sprachkatalog (DE/EN), die Inhalte tragen ihre eigene Sprache (lang).
 */

import { clockTime } from "@notebook-lm/shared";
import { useId } from "react";
import { Icon } from "./Icon.js";
import { useTheme } from "./useTheme.js";

export interface TranscriptItem {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker?: string | undefined;
  readonly text: string;
  /** Bildbeschreibung (nur Video). */
  readonly description?: string | undefined;
  /** Kapitelname (nur Video). */
  readonly chapter?: string | undefined;
}

export interface TranscriptDownload {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
}

export interface MediaTranscriptProps {
  readonly id?: string | undefined;
  readonly items: readonly TranscriptItem[];
  readonly currentTimeMs?: number | undefined;
  readonly onSeek?: ((targetMs: number) => void) | undefined;
  /** Sprache der Inhalte (BCP 47). */
  readonly contentLang?: string | undefined;
  readonly downloads?: readonly TranscriptDownload[] | undefined;
  readonly testId?: string | undefined;
}

/** Index des Abschnitts zur Zeit; an der Grenze gewinnt der spätere. -1 ohne Treffer. */
export function activeTranscriptIndex(
  items: readonly TranscriptItem[],
  currentTimeMs: number | undefined
): number {
  if (currentTimeMs === undefined) return -1;
  return items.findLastIndex((item) => currentTimeMs >= item.startMs && currentTimeMs < item.endMs);
}

export function MediaTranscript({
  id,
  items,
  currentTimeMs,
  onSeek,
  contentLang,
  downloads = [],
  testId = "media-transcript"
}: MediaTranscriptProps) {
  const { t } = useTheme();
  const headingId = `${useId()}-transcript`;
  const active = activeTranscriptIndex(items, currentTimeMs);

  return (
    <section id={id} className="rn-transcript" aria-labelledby={headingId} data-testid={testId}>
      <div className="rn-transcript-head">
        <h3 id={headingId} className="rn-transcript-title">
          {t("mediaTranscript")}
        </h3>
        {downloads.length > 0 && (
          <div className="rn-transcript-downloads">
            {downloads.map((d) => (
              <button
                key={d.id}
                type="button"
                className="rn-stage-btn"
                onClick={d.run}
                data-testid={`transcript-download-${d.id}`}
              >
                <Icon name="download" size={16} />
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ol className="rn-transcript-list" aria-label={t("mediaTranscriptList")}>
        {items.map((item, index) => {
          const time = clockTime(item.startMs);
          return (
            <li
              key={item.id}
              className="rn-transcript-item"
              aria-current={index === active ? "time" : undefined}
              data-testid={`transcript-item-${item.id}`}
            >
              {onSeek ? (
                <button
                  type="button"
                  className="rn-transcript-time"
                  onClick={() => onSeek(item.startMs)}
                >
                  {time}
                  <span className="sr-only">{t("mediaTranscriptJump")}</span>
                </button>
              ) : (
                <span className="rn-transcript-time">{time}</span>
              )}
              <div className="rn-transcript-body">
                {item.chapter && (
                  <p className="rn-transcript-chapter" lang={contentLang}>
                    {item.chapter}
                  </p>
                )}
                <p className="rn-transcript-text">
                  {item.speaker && (
                    <strong className="rn-transcript-speaker" lang={contentLang}>
                      {item.speaker}:{" "}
                    </strong>
                  )}
                  <span lang={contentLang}>{item.text}</span>
                </p>
                {item.description && (
                  <p className="rn-transcript-desc">
                    <span className="rn-transcript-desc-label">{t("mediaTranscriptVisual")}</span>{" "}
                    <span lang={contentLang}>{item.description}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
