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
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useState } from "react";

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
}

export function FlashcardsViewer({
  cards,
  title = "Lernkartei",
  onSourceJump,
  onCardReviewed,
  initialStates = {}
}: FlashcardsViewerProps) {
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
      setLastAnnouncement(next ? "Rückseite angezeigt" : "Vorderseite angezeigt");
      return next;
    });
  }, []);

  const handleRating = useCallback(
    (rating: FlashcardRating) => {
      const updated = calculateSM2(currentState, rating);
      setCardStates((prev) => ({
        ...prev,
        [currentIndex]: updated
      }));

      onCardReviewed?.(currentIndex, rating, updated);

      const ratingLabel =
        rating === "again"
          ? "Nochmal"
          : rating === "hard"
            ? "Schwer"
            : rating === "good"
              ? "Gut"
              : "Einfach";
      setLastAnnouncement(
        `Karte bewertet als ${ratingLabel}. Nächstes Intervall: ${updated.intervalDays} Tag(e).`
      );

      // Advance to next card if available, reset flip
      if (currentIndex < totalCards - 1) {
        setCurrentIndex((i) => i + 1);
        setIsFlipped(false);
      }
    },
    [currentState, currentIndex, onCardReviewed, totalCards]
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
        <p className="rn-tool-empty">Keine Lernkarten vorhanden.</p>
      </section>
    );
  }

  const ratings = [
    { id: "again", label: "Nochmal", key: "1", aria: "Nochmal (Taste 1) - Falsch erinnert" },
    { id: "hard", label: "Schwer", key: "2", aria: "Schwer (Taste 2) - Mit Mühe erinnert" },
    { id: "good", label: "Gut", key: "3", aria: "Gut (Taste 3) - Nach kurzem Zögern erinnert" },
    {
      id: "easy",
      label: "Einfach",
      key: "4",
      aria: "Einfach (Taste 4) - Sofort fehlerfrei gewusst"
    }
  ] as const;

  return (
    <section aria-label={`Lernkarten: ${title}`} className="rn-tool-view rn-cards">
      <header className="rn-tool-view-head">
        <h2 className="rn-tool-view-title">{title}</h2>
        <span aria-live="polite" data-testid="flashcard-counter" className="rn-tool-view-meta">
          Karte {currentIndex + 1} von {totalCards}
        </span>
      </header>
      <progress
        className="rn-progress"
        aria-label="Fortschritt im Stapel"
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
        aria-label={`Lernkarte ${currentIndex + 1}: ${isFlipped ? "Rückseite" : "Vorderseite"}`}
        className="rn-flashcard"
        data-side={isFlipped ? "back" : "front"}
      >
        <div className="rn-flashcard-meta">
          <span className="rn-eyebrow">
            {isFlipped ? "Antwort (Rückseite)" : "Frage (Vorderseite)"}
          </span>
          <span className="rn-flashcard-stats">
            Intervall: {currentState.intervalDays}d | Reps: {currentState.repetitions}
          </span>
        </div>

        <p className="rn-flashcard-text">{isFlipped ? currentCard?.back : currentCard?.front}</p>

        <div className="rn-flashcard-foot">
          <button
            type="button"
            aria-label="Karte umdrehen (Leertaste oder Enter)"
            onClick={handleFlip}
            onKeyDown={handleKeyDown}
            className="rn-btn rn-btn--secondary"
          >
            {isFlipped ? "Vorderseite zeigen" : "Antwort aufdecken"}
          </button>

          {currentCard?.sourceHint && (
            <button
              type="button"
              aria-label={`Quelle öffnen: ${currentCard.sourceHint}`}
              onClick={() => {
                onSourceJump?.({
                  sourceId: currentCard.sourceId,
                  chunkId: currentCard.chunkId,
                  sourceHint: currentCard.sourceHint
                });
              }}
              className="rn-link-btn"
            >
              Quelle: {currentCard.sourceHint}
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
            aria-label={r.aria}
            onClick={() => handleRating(r.id)}
            className="rn-rating"
            data-rating={r.id}
          >
            <span className="rn-rating-label">{r.label}</span>
            <kbd className="rn-rating-key">{r.key}</kbd>
          </button>
        ))}
      </div>

      {/* Navigation pagination buttons */}
      <nav aria-label="Kartenauswahl" className="rn-tool-actions-row rn-tool-actions-row--split">
        <button
          type="button"
          disabled={currentIndex === 0}
          aria-label="Vorherige Karte (Pfeil links)"
          onClick={() => {
            setCurrentIndex((i) => i - 1);
            setIsFlipped(false);
          }}
          className="rn-btn rn-btn--ghost"
        >
          Vorherige
        </button>

        <button
          type="button"
          disabled={currentIndex === totalCards - 1}
          aria-label="Nächste Karte (Pfeil rechts)"
          onClick={() => {
            setCurrentIndex((i) => i + 1);
            setIsFlipped(false);
          }}
          className="rn-btn rn-btn--ghost"
        >
          Nächste
        </button>
      </nav>
    </section>
  );
}
