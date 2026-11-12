/**
 * Interactive Multiple-Choice Quiz Viewer Component.
 *
 * Implements Sub-Issue #123 (Decision #62, #70):
 * - Instant Feedback on Answer Selection (Correct / Incorrect highlights)
 * - Grounded Explanations with Source Citations ([n]) and Click-Jump
 * - Score Calculation & Completion View
 * - WAI-ARIA Radio Group & Live Announcements
 */

import { type QuizEvaluationResult, type QuizQuestion, evaluateQuiz } from "@notebook-lm/shared";
import { useCallback, useId, useMemo, useState } from "react";

export interface QuizViewerProps {
  readonly questions: readonly QuizQuestion[];
  readonly title?: string | undefined;
  readonly onSourceJump?:
    | ((sourceRef: {
        sourceId?: string | undefined;
        chunkId?: string | undefined;
        sourceCitation?: string | undefined;
      }) => void)
    | undefined;
  readonly onComplete?: ((result: QuizEvaluationResult) => void) | undefined;
}

export function QuizViewer({
  questions,
  title = "Wissens-Quiz",
  onSourceJump,
  onComplete
}: QuizViewerProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string>("");

  const totalQuestions = questions.length;
  const currentQuestion = questions[activeQuestionIndex];

  const evaluation = useMemo(() => {
    return evaluateQuiz(questions, selectedAnswers);
  }, [questions, selectedAnswers]);

  const handleSelectOption = useCallback(
    (questionId: string, optionIndex: number) => {
      setSelectedAnswers((prev) => {
        const next = { ...prev, [questionId]: optionIndex };
        const q = questions.find((item) => item.id === questionId);
        if (q) {
          const isCorrect = optionIndex === q.correctAnswerIndex;
          setLiveMessage(
            isCorrect
              ? "Richtige Antwort ausgewählt."
              : `Falsche Antwort ausgewählt. Richtig wäre gewesen: ${q.options[q.correctAnswerIndex]}`
          );
        }
        return next;
      });
    },
    [questions]
  );

  const handleFinishQuiz = useCallback(() => {
    setShowSummary(true);
    setLiveMessage(`Quiz beendet. Ergebnis: ${evaluation.scorePercentage}% richtig.`);
    onComplete?.(evaluation);
  }, [evaluation, onComplete]);

  const handleReset = useCallback(() => {
    setSelectedAnswers({});
    setActiveQuestionIndex(0);
    setShowSummary(false);
    setLiveMessage("Quiz zurückgesetzt.");
  }, []);

  const containerId = useId();

  if (totalQuestions === 0) {
    return (
      <section aria-label={title} style={{ padding: "24px", textAlign: "center" }}>
        <p>Keine Quizfragen vorhanden.</p>
      </section>
    );
  }

  return (
    <section
      aria-label={`Quiz: ${title}`}
      className="relationnotes-quiz-viewer"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "16px",
        maxWidth: "680px",
        margin: "0 auto",
        width: "100%"
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          borderBottom: "1px solid var(--rn-color-panel-border)",
          paddingBottom: "8px"
        }}
      >
        <h2 style={{ fontSize: "1.2rem", margin: 0 }}>{title}</h2>
        <span
          data-testid="quiz-progress-indicator"
          style={{ fontSize: "0.95rem", color: "var(--rn-color-text-secondary)" }}
        >
          Frage {activeQuestionIndex + 1} von {totalQuestions}
        </span>
      </header>

      {/* Screenreader live announcement */}
      <output
        aria-live="polite"
        data-testid="a11y-quiz-announcement"
        style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}
      >
        {liveMessage}
      </output>

      {showSummary ? (
        <div
          data-testid="quiz-summary-card"
          style={{
            background: "var(--rn-color-surface-variant)",
            padding: "24px",
            borderRadius: "var(--rn-radius-md)",
            border: "1px solid var(--rn-color-border)",
            textAlign: "center"
          }}
        >
          <h3 style={{ fontSize: "1.4rem", margin: "0 0 12px 0" }}>Quiz-Auswertung</h3>
          <p
            style={{
              fontSize: "1.2rem",
              fontWeight: "bold",
              color: "var(--rn-color-text-primary)"
            }}
          >
            Ergebnis: {evaluation.correctCount} von {evaluation.totalQuestions} richtig (
            {evaluation.scorePercentage}%)
          </p>

          <div
            style={{ marginTop: "24px", display: "flex", justifyContent: "center", gap: "12px" }}
          >
            <button
              type="button"
              onClick={handleReset}
              style={{
                minHeight: "44px",
                padding: "0 20px",
                background: "var(--rn-color-accent)",
                color: "var(--rn-color-accent-text)",
                border: "none",
                borderRadius: "var(--rn-radius-sm)",
                fontWeight: "bold",
                cursor: "pointer"
              }}
            >
              Quiz wiederholen
            </button>
            <button
              type="button"
              onClick={() => setShowSummary(false)}
              style={{
                minHeight: "44px",
                padding: "0 16px",
                background: "var(--rn-color-surface-variant)",
                color: "var(--rn-color-text-primary)",
                border: "none",
                borderRadius: "var(--rn-radius-sm)",
                cursor: "pointer"
              }}
            >
              Antworten ansehen
            </button>
          </div>
        </div>
      ) : (
        currentQuestion && (
          <div
            data-testid={`quiz-question-${currentQuestion.id}`}
            style={{
              background: "var(--rn-color-panel)",
              border: "1px solid var(--rn-color-panel-border)",
              borderRadius: "var(--rn-radius-md)",
              padding: "20px"
            }}
          >
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  color: "var(--rn-color-text-primary)",
                  marginBottom: "16px",
                  lineHeight: 1.4
                }}
              >
                {currentQuestion.question}
              </legend>

              <div
                role="radiogroup"
                aria-label={`Antwortoptionen für Frage ${activeQuestionIndex + 1}`}
                style={{ display: "flex", flexDirection: "column", gap: "10px" }}
              >
                {currentQuestion.options.map((optionText, optIdx) => {
                  const hasAnswered = selectedAnswers[currentQuestion.id] !== undefined;
                  const isSelected = selectedAnswers[currentQuestion.id] === optIdx;
                  const isCorrectAnswer = optIdx === currentQuestion.correctAnswerIndex;

                  let optionBg = "var(--rn-color-surface-variant)";
                  let optionBorder = "var(--rn-color-border)";
                  let textColor = "var(--rn-color-text-primary)";

                  if (hasAnswered) {
                    if (isCorrectAnswer) {
                      optionBg = "var(--rn-color-success-surface)";
                      optionBorder = "var(--rn-color-success)";
                      textColor = "var(--rn-color-success)";
                    } else if (isSelected) {
                      optionBg = "var(--rn-color-error-surface)";
                      optionBorder = "var(--rn-color-error)";
                      textColor = "var(--rn-color-error)";
                    }
                  }

                  const optionId = `${containerId}-q${currentQuestion.id}-opt${optIdx}`;

                  return (
                    <label
                      key={`opt-${currentQuestion.id}-${optIdx}-${optionText.slice(0, 8)}`}
                      htmlFor={optionId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "12px 16px",
                        minHeight: "44px",
                        borderRadius: "var(--rn-radius-sm)",
                        border: `2px solid ${optionBorder}`,
                        background: optionBg,
                        color: textColor,
                        cursor: hasAnswered ? "default" : "pointer",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <input
                        id={optionId}
                        type="radio"
                        name={`quiz-radio-${currentQuestion.id}`}
                        value={optIdx}
                        checked={isSelected}
                        onChange={() => handleSelectOption(currentQuestion.id, optIdx)}
                        style={{ marginRight: "12px", width: "20px", height: "20px" }}
                      />
                      <span style={{ fontSize: "1rem" }}>{optionText}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Explanation with Grounded Source Citation & Jump */}
            {selectedAnswers[currentQuestion.id] !== undefined && (
              <div
                data-testid="quiz-explanation-box"
                style={{
                  marginTop: "16px",
                  padding: "14px",
                  background: "var(--rn-color-surface-variant)",
                  borderRadius: "var(--rn-radius-sm)",
                  borderLeft: "4px solid var(--rn-color-brand)"
                }}
              >
                <p
                  style={{
                    margin: "0 0 6px 0",
                    fontWeight: 600,
                    color: "var(--rn-color-text-primary)"
                  }}
                >
                  Erklärung:
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.95rem",
                    color: "var(--rn-color-text-secondary)"
                  }}
                >
                  {currentQuestion.explanation}
                </p>

                {(currentQuestion.sourceCitation || currentQuestion.sourceId) && (
                  <div style={{ marginTop: "10px" }}>
                    <button
                      type="button"
                      aria-label="Quelle für diese Begründung öffnen"
                      onClick={() => {
                        onSourceJump?.({
                          sourceId: currentQuestion.sourceId,
                          chunkId: currentQuestion.chunkId,
                          sourceCitation: currentQuestion.sourceCitation
                        });
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--rn-color-primary)",
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: 0,
                        fontSize: "0.9rem",
                        minHeight: "44px",
                        display: "inline-flex",
                        alignItems: "center"
                      }}
                    >
                      Quelle belegen: {currentQuestion.sourceCitation ?? "Originalzitat ansehen"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Navigation buttons */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "20px"
              }}
            >
              <button
                type="button"
                disabled={activeQuestionIndex === 0}
                onClick={() => setActiveQuestionIndex((i) => i - 1)}
                style={{
                  minHeight: "44px",
                  padding: "0 16px",
                  cursor: activeQuestionIndex > 0 ? "pointer" : "default"
                }}
              >
                Zurück
              </button>

              {activeQuestionIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveQuestionIndex((i) => i + 1)}
                  style={{ minHeight: "44px", padding: "0 16px", cursor: "pointer" }}
                >
                  Weiter
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinishQuiz}
                  style={{
                    minHeight: "44px",
                    padding: "0 20px",
                    background: "var(--rn-color-success)",
                    color: "var(--rn-color-panel)",
                    border: "none",
                    borderRadius: "var(--rn-radius-sm)",
                    fontWeight: "bold",
                    cursor: "pointer"
                  }}
                >
                  Quiz abschließen
                </button>
              )}
            </div>
          </div>
        )
      )}
    </section>
  );
}
