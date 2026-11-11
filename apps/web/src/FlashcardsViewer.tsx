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
      <section aria-label={title} style={{ padding: "24px", textAlign: "center" }}>
        <p>Keine Lernkarten vorhanden.</p>
      </section>
    );
  }

  return (
    <section
      aria-label={`Lernkarten: ${title}`}
      className="relationnotes-flashcards-viewer"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px",
        maxWidth: "680px",
        margin: "0 auto",
        width: "100%"
      }}
    >
      <header
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px"
        }}
      >
        <h2 style={{ fontSize: "1.2rem", margin: 0 }}>{title}</h2>
        <span
          aria-live="polite"
          data-testid="flashcard-counter"
          style={{ fontSize: "0.95rem", color: "var(--rn-color-text-secondary)" }}
        >
          Karte {currentIndex + 1} von {totalCards}
        </span>
      </header>

      {/* Screenreader live announcement */}
      <output
        aria-live="polite"
        className="sr-only"
        data-testid="a11y-flashcard-announcement"
        style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}
      >
        {lastAnnouncement}
      </output>

      {/* Flashcard container with flip action and keyboard events */}
      <section
        data-testid="flashcard-card"
        aria-label={`Lernkarte ${currentIndex + 1}: ${isFlipped ? "Rückseite" : "Vorderseite"}`}
        style={{
          width: "100%",
          minHeight: "260px",
          background: isFlipped ? "var(--rn-color-surface-variant)" : "var(--rn-color-panel)",
          border: "2px solid var(--rn-color-border)",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          transition: "transform 0.2s ease, background 0.2s ease",
          textAlign: "left"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "var(--rn-color-text-secondary)"
          }}
        >
          <span style={{ fontSize: "0.875rem", textTransform: "uppercase", fontWeight: "bold" }}>
            {isFlipped ? "Antwort (Rückseite)" : "Frage (Vorderseite)"}
          </span>
          <span style={{ fontSize: "0.875rem" }}>
            Intervall: {currentState.intervalDays}d | Reps: {currentState.repetitions}
          </span>
        </div>

        <div
          style={{ margin: "20px 0", fontSize: "1.15rem", lineHeight: 1.5, textAlign: "center" }}
        >
          {isFlipped ? currentCard?.back : currentCard?.front}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid var(--rn-color-panel-border)",
            paddingTop: "12px"
          }}
        >
          <button
            type="button"
            aria-label="Karte umdrehen (Leertaste oder Enter)"
            onClick={handleFlip}
            onKeyDown={handleKeyDown}
            style={{
              padding: "6px 16px",
              minHeight: "44px",
              borderRadius: "6px",
              background: "var(--rn-color-surface-variant)",
              color: "var(--rn-color-text-primary)",
              border: "none",
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center"
            }}
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
              style={{
                fontSize: "0.875rem",
                color: "var(--rn-color-primary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center"
              }}
            >
              Quelle: {currentCard.sourceHint}
            </button>
          )}
        </div>
      </section>

      {/* SM-2 Rating Controls (Enabled when flipped) */}
      <div
        style={{
          width: "100%",
          marginTop: "20px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px"
        }}
      >
        <button
          type="button"
          disabled={!isFlipped}
          aria-label="Nochmal (Taste 1) - Falsch erinnert"
          onClick={() => handleRating("again")}
          style={{
            minHeight: "44px",
            padding: "8px",
            background: isFlipped
              ? "var(--rn-color-error-surface)"
              : "var(--rn-color-surface-variant)",
            color: isFlipped ? "var(--rn-color-error)" : "var(--rn-color-text-muted)",
            border: "1px solid var(--rn-color-error)",
            borderRadius: "6px",
            cursor: isFlipped ? "pointer" : "not-allowed",
            fontWeight: "bold"
          }}
        >
          Nochmal (1)
        </button>
        <button
          type="button"
          disabled={!isFlipped}
          aria-label="Schwer (Taste 2) - Mit Mühe erinnert"
          onClick={() => handleRating("hard")}
          style={{
            minHeight: "44px",
            padding: "8px",
            background: isFlipped ? "var(--rn-color-highlight)" : "var(--rn-color-surface-variant)",
            color: isFlipped ? "var(--rn-color-text-primary)" : "var(--rn-color-text-muted)",
            border: "1px solid var(--rn-color-border)",
            borderRadius: "6px",
            cursor: isFlipped ? "pointer" : "not-allowed",
            fontWeight: "bold"
          }}
        >
          Schwer (2)
        </button>
        <button
          type="button"
          disabled={!isFlipped}
          aria-label="Gut (Taste 3) - Nach kurzem Zögern erinnert"
          onClick={() => handleRating("good")}
          style={{
            minHeight: "44px",
            padding: "8px",
            background: isFlipped
              ? "var(--rn-color-surface-variant)"
              : "var(--rn-color-surface-variant)",
            color: isFlipped ? "var(--rn-color-primary)" : "var(--rn-color-text-muted)",
            border: "1px solid var(--rn-color-primary)",
            borderRadius: "6px",
            cursor: isFlipped ? "pointer" : "not-allowed",
            fontWeight: "bold"
          }}
        >
          Gut (3)
        </button>
        <button
          type="button"
          disabled={!isFlipped}
          aria-label="Einfach (Taste 4) - Sofort fehlerfrei gewusst"
          onClick={() => handleRating("easy")}
          style={{
            minHeight: "44px",
            padding: "8px",
            background: isFlipped
              ? "var(--rn-color-success-surface)"
              : "var(--rn-color-surface-variant)",
            color: isFlipped ? "var(--rn-color-success)" : "var(--rn-color-text-muted)",
            border: "1px solid var(--rn-color-success)",
            borderRadius: "6px",
            cursor: isFlipped ? "pointer" : "not-allowed",
            fontWeight: "bold"
          }}
        >
          Einfach (4)
        </button>
      </div>

      {/* Navigation pagination buttons */}
      <nav
        aria-label="Kartenauswahl"
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          marginTop: "16px"
        }}
      >
        <button
          type="button"
          disabled={currentIndex === 0}
          aria-label="Vorherige Karte (Pfeil links)"
          onClick={() => {
            setCurrentIndex((i) => i - 1);
            setIsFlipped(false);
          }}
          style={{
            minHeight: "44px",
            padding: "0 16px",
            cursor: currentIndex > 0 ? "pointer" : "default"
          }}
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
          style={{
            minHeight: "44px",
            padding: "0 16px",
            cursor: currentIndex < totalCards - 1 ? "pointer" : "default"
          }}
        >
          Nächste
        </button>
      </nav>
    </section>
  );
}
