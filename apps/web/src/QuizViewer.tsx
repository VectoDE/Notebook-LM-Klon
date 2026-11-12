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
      <section aria-label={title} className="rn-tool-view rn-tool-view--empty">
        <p className="rn-tool-empty">Keine Quizfragen vorhanden.</p>
      </section>
    );
  }

  const answeredCount = Object.keys(selectedAnswers).length;

  return (
    <section aria-label={`Quiz: ${title}`} className="rn-tool-view rn-quiz">
      <header className="rn-tool-view-head">
        <h2 className="rn-tool-view-title">{title}</h2>
        <span data-testid="quiz-progress-indicator" className="rn-tool-view-meta">
          Frage {activeQuestionIndex + 1} von {totalQuestions}
        </span>
      </header>
      <progress
        className="rn-progress"
        aria-label="Beantwortete Fragen"
        max={totalQuestions}
        value={answeredCount}
      />

      {/* Screenreader live announcement */}
      <output
        aria-live="polite"
        data-testid="a11y-quiz-announcement"
        className="rn-visually-hidden"
      >
        {liveMessage}
      </output>

      {showSummary ? (
        <div data-testid="quiz-summary-card" className="rn-quiz-summary">
          <p className="rn-eyebrow">Quiz-Auswertung</p>
          <p className="rn-quiz-score">
            <span className="rn-quiz-score-value">{evaluation.scorePercentage}%</span>
            <span className="rn-quiz-score-text">
              Ergebnis: {evaluation.correctCount} von {evaluation.totalQuestions} richtig (
              {evaluation.scorePercentage}%)
            </span>
          </p>
          <div className="rn-tool-actions-row rn-tool-actions-row--center">
            <button type="button" onClick={handleReset} className="rn-btn rn-btn--primary">
              Quiz wiederholen
            </button>
            <button
              type="button"
              onClick={() => setShowSummary(false)}
              className="rn-btn rn-btn--secondary"
            >
              Antworten ansehen
            </button>
          </div>
        </div>
      ) : (
        currentQuestion && (
          <div data-testid={`quiz-question-${currentQuestion.id}`} className="rn-quiz-card">
            <fieldset className="rn-quiz-fieldset">
              <legend className="rn-quiz-question">{currentQuestion.question}</legend>

              <div
                role="radiogroup"
                aria-label={`Antwortoptionen für Frage ${activeQuestionIndex + 1}`}
                className="rn-quiz-options"
              >
                {currentQuestion.options.map((optionText, optIdx) => {
                  const hasAnswered = selectedAnswers[currentQuestion.id] !== undefined;
                  const isSelected = selectedAnswers[currentQuestion.id] === optIdx;
                  const isCorrectAnswer = optIdx === currentQuestion.correctAnswerIndex;
                  let state = "open";
                  if (hasAnswered) {
                    if (isCorrectAnswer) state = "correct";
                    else if (isSelected) state = "wrong";
                    else state = "idle";
                  }

                  const optionId = `${containerId}-q${currentQuestion.id}-opt${optIdx}`;

                  return (
                    <label
                      key={`opt-${currentQuestion.id}-${optIdx}-${optionText.slice(0, 8)}`}
                      htmlFor={optionId}
                      className="rn-quiz-option"
                      data-state={state}
                    >
                      <input
                        id={optionId}
                        type="radio"
                        name={`quiz-radio-${currentQuestion.id}`}
                        value={optIdx}
                        checked={isSelected}
                        onChange={() => handleSelectOption(currentQuestion.id, optIdx)}
                        className="rn-quiz-radio"
                      />
                      <span className="rn-quiz-option-letter" aria-hidden="true">
                        {String.fromCharCode(65 + optIdx)}
                      </span>
                      <span className="rn-quiz-option-text">{optionText}</span>
                      {state === "correct" && <span className="rn-quiz-flag">Richtig</span>}
                      {state === "wrong" && <span className="rn-quiz-flag">Falsch</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Explanation with Grounded Source Citation & Jump */}
            {selectedAnswers[currentQuestion.id] !== undefined && (
              <div data-testid="quiz-explanation-box" className="rn-quiz-explanation">
                <p className="rn-quiz-explanation-title">Erklärung:</p>
                <p className="rn-quiz-explanation-text">{currentQuestion.explanation}</p>

                {(currentQuestion.sourceCitation || currentQuestion.sourceId) && (
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
                    className="rn-link-btn"
                  >
                    Quelle belegen: {currentQuestion.sourceCitation ?? "Originalzitat ansehen"}
                  </button>
                )}
              </div>
            )}

            {/* Navigation buttons */}
            <div className="rn-tool-actions-row rn-tool-actions-row--split">
              <button
                type="button"
                disabled={activeQuestionIndex === 0}
                onClick={() => setActiveQuestionIndex((i) => i - 1)}
                className="rn-btn rn-btn--ghost"
              >
                Zurück
              </button>

              {activeQuestionIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveQuestionIndex((i) => i + 1)}
                  className="rn-btn rn-btn--secondary"
                >
                  Weiter
                </button>
              ) : (
                <button type="button" onClick={handleFinishQuiz} className="rn-btn rn-btn--primary">
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
