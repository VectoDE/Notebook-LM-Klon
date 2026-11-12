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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTheme } from "./useTheme.js";

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
  /**
   * Sprache der Inhalte (BCP 47). Weicht sie von der Oberfläche ab, bekommen die Inhalte
   * ein lang-Attribut (WCAG 3.1.2, Issue #323); Bedientexte folgen weiter der Oberfläche.
   */
  readonly contentLang?: string | undefined;
}

function FlagIcon({ correct }: { readonly correct: boolean }) {
  return (
    <svg
      className="rn-quiz-flag-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={correct ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18"} />
    </svg>
  );
}

export function QuizViewer({
  questions,
  title: titleProp,
  onSourceJump,
  onComplete,
  contentLang
}: QuizViewerProps) {
  const { t, tf } = useTheme();
  const title = titleProp ?? t("quizDefaultTitle");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [liveMessage, setLiveMessage] = useState<string>("");
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  // Zählt Fragewechsel per Knopf; der Fokus springt erst danach auf die neue Frage (nicht beim Start)
  const [focusRequest, setFocusRequest] = useState(0);

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
              ? t("quizLiveRight")
              : tf("quizLiveWrong", { answer: q.options[q.correctAnswerIndex] ?? "" })
          );
        }
        return next;
      });
    },
    [questions, t, tf]
  );

  const goToQuestion = useCallback(
    (index: number) => {
      setActiveQuestionIndex(index);
      setLiveMessage(tf("quizProgress", { n: index + 1, total: questions.length }));
      setFocusRequest((n) => n + 1);
    },
    [questions.length, tf]
  );

  useEffect(() => {
    if (focusRequest > 0) fieldsetRef.current?.focus();
  }, [focusRequest]);

  const handleFinishQuiz = useCallback(() => {
    setShowSummary(true);
    setLiveMessage(tf("quizLiveDone", { pct: evaluation.scorePercentage }));
    onComplete?.(evaluation);
  }, [evaluation, onComplete, tf]);

  const handleReset = useCallback(() => {
    setSelectedAnswers({});
    setActiveQuestionIndex(0);
    setShowSummary(false);
    setLiveMessage(t("quizLiveReset"));
  }, [t]);

  const containerId = useId();

  if (totalQuestions === 0) {
    return (
      <section aria-label={title} className="rn-tool-view rn-tool-view--empty">
        <p className="rn-tool-empty">{t("quizEmpty")}</p>
      </section>
    );
  }

  const answeredCount = Object.keys(selectedAnswers).length;

  return (
    <section aria-label={tf("quizAria", { title })} className="rn-tool-view rn-quiz">
      <header className="rn-tool-view-head">
        <h2 className="rn-tool-view-title">{title}</h2>
        <span data-testid="quiz-progress-indicator" className="rn-tool-view-meta">
          {tf("quizProgress", { n: activeQuestionIndex + 1, total: totalQuestions })}
        </span>
      </header>
      <progress
        className="rn-progress"
        aria-label={t("quizAnswered")}
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
          <p className="rn-eyebrow">{t("quizSummaryEyebrow")}</p>
          <p className="rn-quiz-score">
            <span className="rn-quiz-score-value">{evaluation.scorePercentage}%</span>
            <span className="rn-quiz-score-text">
              {tf("quizScore", {
                correct: evaluation.correctCount,
                total: evaluation.totalQuestions,
                pct: evaluation.scorePercentage
              })}
            </span>
          </p>
          <div className="rn-tool-actions-row rn-tool-actions-row--center">
            <button type="button" onClick={handleReset} className="rn-btn rn-btn--primary">
              {t("quizRepeat")}
            </button>
            <button
              type="button"
              onClick={() => setShowSummary(false)}
              className="rn-btn rn-btn--secondary"
            >
              {t("quizViewAnswers")}
            </button>
          </div>
        </div>
      ) : (
        currentQuestion && (
          <div data-testid={`quiz-question-${currentQuestion.id}`} className="rn-quiz-card">
            <fieldset ref={fieldsetRef} tabIndex={-1} className="rn-quiz-fieldset">
              <legend className="rn-quiz-question" lang={contentLang}>
                {currentQuestion.question}
              </legend>

              <div
                role="radiogroup"
                aria-label={tf("quizOptionsAria", { n: activeQuestionIndex + 1 })}
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
                      <span className="rn-quiz-option-text" lang={contentLang}>
                        {optionText}
                      </span>
                      {state === "correct" && (
                        <span className="rn-quiz-flag">
                          <FlagIcon correct />
                          {t("quizRight")}
                        </span>
                      )}
                      {state === "wrong" && (
                        <span className="rn-quiz-flag">
                          <FlagIcon correct={false} />
                          {t("quizWrong")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Explanation with Grounded Source Citation & Jump */}
            {selectedAnswers[currentQuestion.id] !== undefined && (
              <div data-testid="quiz-explanation-box" className="rn-quiz-explanation">
                <p className="rn-quiz-explanation-title">{t("quizExplanation")}</p>
                <p className="rn-quiz-explanation-text" lang={contentLang}>
                  {currentQuestion.explanation}
                </p>

                {(currentQuestion.sourceCitation || currentQuestion.sourceId) && (
                  <button
                    type="button"
                    onClick={() => {
                      onSourceJump?.({
                        sourceId: currentQuestion.sourceId,
                        chunkId: currentQuestion.chunkId,
                        sourceCitation: currentQuestion.sourceCitation
                      });
                    }}
                    className="rn-link-btn"
                  >
                    {tf("quizVerify", {
                      citation: currentQuestion.sourceCitation ?? t("quizOriginalQuote")
                    })}
                  </button>
                )}
              </div>
            )}

            {/* Navigation buttons */}
            <div className="rn-tool-actions-row rn-tool-actions-row--split">
              <button
                type="button"
                disabled={activeQuestionIndex === 0}
                onClick={() => goToQuestion(activeQuestionIndex - 1)}
                className="rn-btn rn-btn--ghost"
              >
                {t("quizBack")}
              </button>

              {activeQuestionIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  onClick={() => goToQuestion(activeQuestionIndex + 1)}
                  className="rn-btn rn-btn--secondary"
                >
                  {t("quizNext")}
                </button>
              ) : (
                <button type="button" onClick={handleFinishQuiz} className="rn-btn rn-btn--primary">
                  {t("quizFinish")}
                </button>
              )}
            </div>
          </div>
        )
      )}
    </section>
  );
}
