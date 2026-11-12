/**
 * SM-2 Spaced Repetition Flashcards Viewer Component.
 *
 * Implements Sub-Issue #123 (Decision #62, #70):
 * - Flip Animation between Front and Back (Space or Enter key)
 * - SM-2 Rating Controls: 'Nochmal' (Again), 'Schwer' (Hard), 'Gut' (Good), 'Einfach' (Easy)
 * - Progress indicator and source citation jump
 * - WAI-ARIA live region updates and accessible keyboard controls
 */

import {
  type FlashcardItem,
  type FlashcardRating,
  type SM2State,
  calculateSM2,
  createInitialSM2State
} from "@notebook-lm/shared";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useId, useState } from "react";
import { EmptyState } from "./EmptyState.js";
import { type Language, fill, translate, useTheme } from "./useTheme.js";

export interface FlashcardsViewerProps {
  readonly cards: readonly FlashcardItem[];
  readonly title?: string | undefined;
  readonly onSourceJump?:
    | ((sourceRef: {
        sourceId?: string | undefined;
        chunkId?: string | undefined;
        sourceHint?: string | undefined;
      }) => void)
    | undefined;
  readonly onCardReviewed?:
    | ((cardIndex: number, rating: FlashcardRating, updatedState: SM2State) => void)
    | undefined;
  readonly initialStates?: Readonly<Record<number, SM2State>> | undefined;
  /**
   * Sprache der Inhalte (BCP 47). Weicht sie von der Oberfläche ab, bekommen die Inhalte
   * ein lang-Attribut (WCAG 3.1.2, Issue #323); Bedientexte folgen weiter der Oberfläche.
   */
  readonly contentLang?: string | undefined;
  /** Sprache der Quellenhinweise (Titel der Quellen), z. B. "en". */
  readonly sourceLang?: string | undefined;
}

/** Klartext für das Wiederholungsdatum: "heute", "morgen", "in 6 Tagen". */
export function describeNextReview(intervalDays: number, language: Language = "de"): string {
  if (intervalDays <= 0) return translate(language, "cardsToday");
  if (intervalDays === 1) return translate(language, "cardsTomorrow");
  return fill(translate(language, "cardsInDays"), { n: intervalDays });
}

export function describeRepetitions(repetitions: number, language: Language = "de"): string {
  return repetitions === 1
    ? translate(language, "cardsRepOne")
    : fill(translate(language, "cardsRepMany"), { n: repetitions });
}

const RATING_LABEL_KEYS: Readonly<Record<FlashcardRating, string>> = {
  again: "cardsRatingAgain",
  hard: "cardsRatingHard",
  good: "cardsRatingGood",
  easy: "cardsRatingEasy"
};

export function FlashcardsViewer({
  cards,
  title: titleProp,
  onSourceJump,
  onCardReviewed,
  initialStates = {},
  contentLang,
  sourceLang
}: FlashcardsViewerProps) {
  const { t, tf, language } = useTheme();
  const title = titleProp ?? t("cardsDefaultTitle");
  const ratingDescId = useId();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [cardStates, setCardStates] = useState<Record<number, SM2State>>(() => ({
    ...initialStates
  }));
  const [lastAnnouncement, setLastAnnouncement] = useState<string>("");

  const currentCard = cards[currentIndex];
  const totalCards = cards.length;
  const currentState = cardStates[currentIndex] ?? createInitialSM2State();

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => {
      const next = !prev;
      setLastAnnouncement(t(next ? "cardsBackShown" : "cardsFrontShown"));
      return next;
    });
  }, [t]);

  const handleRating = useCallback(
    (rating: FlashcardRating) => {
      const updated = calculateSM2(currentState, rating);
      setCardStates((prev) => ({
        ...prev,
        [currentIndex]: updated
      }));

      onCardReviewed?.(currentIndex, rating, updated);

      const ratingLabel = t(RATING_LABEL_KEYS[rating]);
      setLastAnnouncement(
        tf("cardsRated", {
          rating: ratingLabel,
          when: describeNextReview(updated.intervalDays, language)
        })
      );

      // Advance to next card if available, reset flip
      if (currentIndex < totalCards - 1) {
        setCurrentIndex((i) => i + 1);
        setIsFlipped(false);
      }
    },
    [currentState, currentIndex, onCardReviewed, totalCards, t, tf, language]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        handleFlip();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (currentIndex < totalCards - 1) {
          setCurrentIndex((i) => i + 1);
          setIsFlipped(false);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentIndex > 0) {
          setCurrentIndex((i) => i - 1);
          setIsFlipped(false);
        }
      } else if (isFlipped) {
        if (event.key === "1") {
          event.preventDefault();
          handleRating("again");
        } else if (event.key === "2") {
          event.preventDefault();
          handleRating("hard");
        } else if (event.key === "3") {
          event.preventDefault();
          handleRating("good");
        } else if (event.key === "4") {
          event.preventDefault();
          handleRating("easy");
        }
      }
    },
    [currentIndex, totalCards, isFlipped, handleFlip, handleRating]
  );

  if (totalCards === 0) {
    return (
      <section aria-label={title} className="rn-tool-view rn-tool-view--empty">
        <EmptyState
          art="studio"
          title={t("cardsEmptyTitle")}
          text={t("cardsEmpty")}
          testId="cards-empty-state"
        />
      </section>
    );
  }

  const ratings = [
    { id: "again", label: t("cardsRatingAgain"), key: "1", hint: t("cardsHintAgain") },
    { id: "hard", label: t("cardsRatingHard"), key: "2", hint: t("cardsHintHard") },
    { id: "good", label: t("cardsRatingGood"), key: "3", hint: t("cardsHintGood") },
    { id: "easy", label: t("cardsRatingEasy"), key: "4", hint: t("cardsHintEasy") }
  ] as const;

  return (
    <section aria-label={tf("cardsAria", { title })} className="rn-tool-view rn-cards">
      <header className="rn-tool-view-head">
        <h2 className="rn-tool-view-title">{title}</h2>
        <span aria-live="polite" data-testid="flashcard-counter" className="rn-tool-view-meta">
          {tf("cardsCounter", { n: currentIndex + 1, total: totalCards })}
        </span>
      </header>
      <progress
        className="rn-progress"
        aria-label={t("cardsProgress")}
        max={totalCards}
        value={currentIndex + 1}
      />

      {/* Screenreader live announcement */}
      <output
        aria-live="polite"
        className="rn-visually-hidden"
        data-testid="a11y-flashcard-announcement"
      >
        {lastAnnouncement}
      </output>

      {/* Flashcard container with flip action and keyboard events */}
      <section
        data-testid="flashcard-card"
        aria-label={tf("cardsCardAria", {
          n: currentIndex + 1,
          side: t(isFlipped ? "cardsSideBack" : "cardsSideFront")
        })}
        className="rn-flashcard"
        data-side={isFlipped ? "back" : "front"}
      >
        <div className="rn-flashcard-meta">
          <span className="rn-eyebrow">
            {t(isFlipped ? "cardsEyebrowBack" : "cardsEyebrowFront")}
          </span>
          <span className="rn-flashcard-stats">
            {tf("cardsNextReview", {
              when: describeNextReview(currentState.intervalDays, language),
              reps: describeRepetitions(currentState.repetitions, language)
            })}
          </span>
        </div>

        <p className="rn-flashcard-text" lang={contentLang}>
          {isFlipped ? currentCard?.back : currentCard?.front}
        </p>

        <div className="rn-flashcard-foot">
          <button
            type="button"
            aria-keyshortcuts="Space Enter"
            onClick={handleFlip}
            onKeyDown={handleKeyDown}
            className="rn-btn rn-btn--secondary"
          >
            {t(isFlipped ? "cardsShowFront" : "cardsReveal")}
          </button>

          {currentCard?.sourceHint && (
            <button
              type="button"
              onClick={() => {
                onSourceJump?.({
                  sourceId: currentCard.sourceId,
                  chunkId: currentCard.chunkId,
                  sourceHint: currentCard.sourceHint
                });
              }}
              className="rn-link-btn"
            >
              {/* Bedientext in Oberflächensprache, Quellentitel in seiner eigenen */}
              {t("cardsSource").split("{hint}")[0]}
              <span lang={sourceLang}>{currentCard.sourceHint}</span>
              {t("cardsSource").split("{hint}")[1]}
            </button>
          )}
        </div>
      </section>

      {/* SM-2 Rating Controls (Enabled when flipped) */}
      <div className="rn-ratings" data-active={isFlipped}>
        {ratings.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={!isFlipped}
            // Name = sichtbarer Text (WCAG 2.5.3), Zusatz als Beschreibung und Tastenkürzel
            aria-describedby={`${ratingDescId}-${r.id}`}
            aria-keyshortcuts={r.key}
            onClick={() => handleRating(r.id)}
            className="rn-rating"
            data-rating={r.id}
          >
            <span className="rn-rating-label">{r.label}</span>{" "}
            <kbd className="rn-rating-key">{r.key}</kbd>
          </button>
        ))}
      </div>
      {ratings.map((r) => (
        <span key={r.id} id={`${ratingDescId}-${r.id}`} hidden>
          {tf("cardsKeyHint", { key: r.key, hint: r.hint })}
        </span>
      ))}

      {/* Navigation pagination buttons */}
      <nav
        aria-label={t("cardsNavLabel")}
        className="rn-tool-actions-row rn-tool-actions-row--split"
      >
        <button
          type="button"
          disabled={currentIndex === 0}
          aria-label={t("cardsPrevAria")}
          onClick={() => {
            setCurrentIndex((i) => i - 1);
            setIsFlipped(false);
          }}
          className="rn-btn rn-btn--ghost"
        >
          {t("cardsPrev")}
        </button>

        <button
          type="button"
          disabled={currentIndex === totalCards - 1}
          aria-label={t("cardsNextAria")}
          onClick={() => {
            setCurrentIndex((i) => i + 1);
            setIsFlipped(false);
          }}
          className="rn-btn rn-btn--ghost"
        >
          {t("cardsNext")}
        </button>
      </nav>
    </section>
  );
}
