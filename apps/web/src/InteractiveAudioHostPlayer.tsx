import type {
  AudioInterjectResponse,
  PodcastStateMachine,
  PodcastStateMachineContext
} from "@notebook-lm/shared";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { ChatApiError, errorKeyForStatus, technicalErrorDetail } from "./chat-client.js";
import { focusFirstAvailable } from "./focus-return.js";
import { trapTabKey } from "./focus-trap.js";
import { podcastStateKey } from "./stage-visuals.js";
import { useTheme } from "./useTheme.js";

export interface SpeechRecognitionResultLike {
  readonly [index: number]: { readonly transcript: string };
  readonly length: number;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly [index: number]: SpeechRecognitionResultLike;
    readonly length: number;
  };
}

export interface SpeechRecognitionInstanceLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface InteractiveAudioHostPlayerProps {
  readonly notebookId: string;
  readonly stateMachine: PodcastStateMachine;
  readonly onInterjectSubmit?: (params: {
    question: string;
    currentTimeMs: number;
    voiceMode?: "dialogue" | "single" | "summary";
  }) => Promise<AudioInterjectResponse>;
  readonly currentTrackTitle?: string;
}

export function InteractiveAudioHostPlayer(props: InteractiveAudioHostPlayerProps) {
  const { notebookId, stateMachine, onInterjectSubmit, currentTrackTitle: trackTitleProp } = props;
  const { t, tf, language } = useTheme();
  const currentTrackTitle = trackTitleProp ?? t("audioDefaultTitle");
  const speechLang = language === "en" ? "en-US" : "de-DE";
  const interjectTextStatus = t("audioInterjectStatus");

  const [machineCtx, setMachineCtx] = useState<PodcastStateMachineContext>(() =>
    stateMachine.getContext()
  );
  const [questionText, setQuestionText] = useState("");
  const [isMicListening, setIsMicListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [micSupported, setMicSupported] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>(() =>
    // Von der Bühne aus öffnet die Zwischenfrage direkt (#314)
    stateMachine.getState() === "interjecting" ? interjectTextStatus : t("audioReady")
  );
  const [hostAnswer, setHostAnswer] = useState<AudioInterjectResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const interjectDialogRef = useRef<HTMLDialogElement>(null);
  const interjectButtonRef = useRef<HTMLButtonElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const previousStateRef = useRef(machineCtx.state);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);

  // Sync state machine changes
  useEffect(() => {
    const unsubscribe = stateMachine.subscribe((ctx) => {
      setMachineCtx(ctx);
    });
    return unsubscribe;
  }, [stateMachine]);

  // Fokus folgt dem Ablauf: Zwischenfrage -> Eingabefeld, Antwort -> "Podcast fortsetzen",
  // danach zurück auf den auslösenden Knopf "Beitreten / Frage stellen".
  useEffect(() => {
    const previous = previousStateRef.current;
    const current = machineCtx.state;
    previousStateRef.current = current;
    if (current === "interjecting") {
      inputRef.current?.focus();
      return;
    }
    if (current === "answering") {
      resumeButtonRef.current?.focus();
      return;
    }
    if (previous === "interjecting" || previous === "answering") {
      focusFirstAvailable(
        [interjectButtonRef.current, playButtonRef.current],
        () => document.activeElement
      );
    }
  }, [machineCtx.state]);

  // Check Web Speech API support
  useEffect(() => {
    const windowWithSpeech = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRecognition =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMicSupported(false);
    }
  }, []);

  // Handle Play / Pause
  const handleTogglePlay = () => {
    if (machineCtx.state === "playing") {
      stateMachine.dispatch({ type: "PAUSE" });
      setStatusMessage(t("audioPausedMsg"));
    } else if (machineCtx.state === "paused" || machineCtx.state === "idle") {
      stateMachine.dispatch({ type: "PLAY" });
      setStatusMessage(t("audioPlayingMsg"));
    }
  };

  // Web Speech API: Start Voice Listening
  const startListening = () => {
    const windowWithSpeech = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRecognition =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMicSupported(false);
      setStatusMessage(t("audioNoSpeech"));
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = speechLang;
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsMicListening(true);
        setStatusMessage(t("audioMicListening"));
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item?.[0]) {
            transcript += item[0].transcript;
          }
        }
        setLiveTranscript(transcript);
        setQuestionText(transcript);
      };

      recognition.onerror = (event: { readonly error?: string }) => {
        setIsMicListening(false);
        setStatusMessage(tf("audioMicError", { error: event.error || t("audioMicUnknown") }));
      };

      recognition.onend = () => {
        setIsMicListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setIsMicListening(false);
      setMicSupported(false);
      setStatusMessage(t("audioMicInitFailed"));
    }
  };

  // Web Speech API: Stop Voice Listening
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsMicListening(false);
  };

  // Handle 'Beitreten / Frage stellen'
  const handleOpenInterject = (mode: "mic" | "text" = "text") => {
    stateMachine.dispatch({ type: "JOIN_INTERJECT", inputMode: mode });
    setStatusMessage(mode === "mic" ? t("audioMicActive") : interjectTextStatus);

    if (mode === "mic") {
      startListening();
    }
  };

  // Handle Cancel Interject (e.g. Escape or Cancel button)
  const handleCancelInterject = () => {
    stopListening();
    stateMachine.dispatch({ type: "CANCEL_INTERJECT" });
    setStatusMessage(t("audioCancelled"));
  };

  // Handle Question Submission
  const handleSubmitQuestion = async (e?: FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    const cleanQuestion = questionText.trim();
    if (!cleanQuestion || isSubmitting) {
      return;
    }

    stopListening();
    setIsSubmitting(true);
    stateMachine.dispatch({ type: "SUBMIT_QUESTION", question: cleanQuestion });
    setStatusMessage(t("audioPreparing"));

    try {
      let response: AudioInterjectResponse;
      if (onInterjectSubmit) {
        response = await onInterjectSubmit({
          question: cleanQuestion,
          currentTimeMs: machineCtx.pausedAtMs,
          voiceMode: "dialogue"
        });
      } else {
        // Fallback default API call
        const res = await fetch(`/api/v1/notebooks/${notebookId}/audio-interject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userQuestion: cleanQuestion,
            currentTimeMs: machineCtx.pausedAtMs,
            voiceMode: "dialogue"
          })
        });
        if (!res.ok) {
          throw new ChatApiError(`HTTP ${res.status}`, res.status);
        }
        response = (await res.json()) as AudioInterjectResponse;
      }

      setHostAnswer(response);
      stateMachine.dispatch({
        type: "HOST_ANSWER_START",
        answerText: response.fullAnswer,
        durationMs: response.speechSynthesis.estimatedDurationMs
      });
      setStatusMessage(t("audioAnswering"));
      setQuestionText("");
      setLiveTranscript("");
    } catch (err) {
      // Klartext mit Handlungshinweis, Statuscode nur als technische Angabe (Issue #315)
      const key =
        err instanceof ChatApiError
          ? errorKeyForStatus(err.status)
          : err instanceof TypeError
            ? "errorNetwork"
            : "errorGeneric";
      const detail =
        err instanceof ChatApiError
          ? ` (${t("errorTechnical")}: ${technicalErrorDetail(err.status, err.message)})`
          : "";
      setStatusMessage(`${t("errorHostAnswer")} ${t(key)}${detail}`);
      stateMachine.dispatch({ type: "CANCEL_INTERJECT" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle speech finish & resume
  const handleHostAnswerComplete = () => {
    stateMachine.dispatch({ type: "HOST_ANSWER_COMPLETE" });
    stateMachine.dispatch({ type: "RESUME_CONFIRMED" });
    setHostAnswer(null);
    setStatusMessage(t("audioAnswerDone"));
  };

  // Keyboard accessibility: Escape to cancel interject
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && machineCtx.state === "interjecting") {
      e.preventDefault();
      handleCancelInterject();
    }
  };

  const formattedTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <section
      aria-label={t("audioAria")}
      className="audio-player-container"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Live ARIA region for screenreaders */}
      <output
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="a11y-live-status"
      >
        {statusMessage}
      </output>

      <header className="player-header">
        <h2 id="audio-track-title">{currentTrackTitle}</h2>
        <div className="player-meta">
          <span className="state-badge" data-testid="audio-state-badge">
            {tf("audioStatus", { state: t(podcastStateKey(machineCtx.state)) })}
          </span>
          <span className="time-display">
            <span className="sr-only">{t("audioTimeSr")}</span>
            {formattedTime(machineCtx.currentTimeMs)} / {formattedTime(machineCtx.durationMs)}
          </span>
        </div>
      </header>

      {/* Main Playback Controls */}
      <fieldset className="player-controls">
        <legend className="sr-only">{t("audioControls")}</legend>
        <button
          ref={playButtonRef}
          type="button"
          onClick={handleTogglePlay}
          className="btn-play-pause"
          disabled={machineCtx.state === "interjecting" || machineCtx.state === "answering"}
        >
          {t(machineCtx.state === "playing" ? "mediaPause" : "mediaPlay")}
        </button>

        {machineCtx.state !== "interjecting" && machineCtx.state !== "answering" && (
          <button
            ref={interjectButtonRef}
            type="button"
            onClick={() => handleOpenInterject("text")}
            className="btn-interject"
            data-testid="btn-audio-interject"
          >
            {t("audioJoin")}
          </button>
        )}
      </fieldset>

      {/* Interjection Modal / Input Drawer */}
      {machineCtx.state === "interjecting" && (
        <dialog
          ref={interjectDialogRef}
          open
          aria-labelledby="interject-dialog-title"
          className="interject-dialog"
          data-testid="interject-dialog"
          // Tab bleibt in der Schublade, damit Escape (am Player) jederzeit greift (#314)
          onKeyDown={(e) => {
            if (interjectDialogRef.current) {
              trapTabKey(e, interjectDialogRef.current, document.activeElement);
            }
          }}
        >
          <h3 id="interject-dialog-title">{t("audioDialogTitle")}</h3>
          <p className="interject-hint">
            {tf("audioPausedAt", { time: formattedTime(machineCtx.pausedAtMs) })}
          </p>

          <form onSubmit={handleSubmitQuestion} className="interject-form">
            <div className="input-group">
              <label htmlFor="interject-question-input">{t("audioQuestionLabel")}</label>
              <input
                id="interject-question-input"
                ref={inputRef}
                type="text"
                value={questionText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setQuestionText(e.target.value)}
                placeholder={t("audioQuestionPlaceholder")}
                disabled={isSubmitting}
                aria-required="true"
                autoComplete="off"
              />
            </div>

            {/* Mic Controls (Web Speech API) */}
            <div className="mic-actions">
              <button
                type="button"
                onClick={isMicListening ? stopListening : startListening}
                disabled={!micSupported || isSubmitting}
                aria-pressed={isMicListening}
                className={`btn-mic ${isMicListening ? "recording" : ""}`}
              >
                {t(isMicListening ? "audioMicStop" : "audioMicStart")}
              </button>

              {!micSupported && (
                <span className="mic-unsupported-note" role="note">
                  {t("audioMicUnsupported")}
                </span>
              )}
            </div>

            {liveTranscript && (
              <div aria-live="polite" className="live-transcript" data-testid="live-transcript">
                <small>{t("audioRecognized")}</small>
                <em>{liveTranscript}</em>
              </div>
            )}

            <div className="dialog-actions">
              <button
                type="submit"
                disabled={!questionText.trim() || isSubmitting}
                className="btn-submit-question"
              >
                {t(isSubmitting ? "audioAnalyzing" : "audioAsk")}
              </button>
              <button
                type="button"
                onClick={handleCancelInterject}
                disabled={isSubmitting}
                className="btn-cancel"
                aria-keyshortcuts="Escape"
              >
                {t("audioCancel")}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {/* Host Answering Display */}
      {machineCtx.state === "answering" && hostAnswer && (
        <section
          aria-labelledby="host-answer-title"
          className="host-answer-stage"
          data-testid="host-answer-stage"
        >
          <h3 id="host-answer-title">{t("audioAnswerTitle")}</h3>
          <div className="dialogue-turns">
            {hostAnswer.turns.map((turn, idx) => (
              <article
                key={`${turn.speaker}-${idx}`}
                className={`host-bubble ${turn.speaker}`}
                aria-label={tf("audioSpeaker", { name: turn.speakerName })}
              >
                <strong>{turn.speakerName}: </strong>
                <span>{turn.text}</span>
              </article>
            ))}
          </div>

          {/* Citations list */}
          {hostAnswer.citations.length > 0 && (
            <aside aria-label={t("audioCitations")} className="citations-list">
              <h4>{t("audioCitationsHead")}</h4>
              <ol>
                {hostAnswer.citations.map((cite) => (
                  <li key={`cite-${cite.index}`}>
                    <span className="cite-badge">[{cite.index}]</span>{" "}
                    <strong>{cite.sourceTitle}</strong>
                    {cite.page ? tf("audioCitePage", { page: cite.page }) : ""}
                    {cite.quote ? tf("audioCiteQuote", { quote: cite.quote }) : ""}
                  </li>
                ))}
              </ol>
            </aside>
          )}

          <div className="answer-actions">
            <button
              ref={resumeButtonRef}
              type="button"
              onClick={handleHostAnswerComplete}
              className="btn-resume-podcast"
              aria-label={tf("audioResumeAria", { time: formattedTime(machineCtx.pausedAtMs) })}
            >
              {tf("audioResume", { time: formattedTime(machineCtx.pausedAtMs) })}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
