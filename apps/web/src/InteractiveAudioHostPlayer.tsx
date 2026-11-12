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
import { podcastStateLabel } from "./stage-visuals.js";
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
  const {
    notebookId,
    stateMachine,
    onInterjectSubmit,
    currentTrackTitle = "Audio Overview: Deep Dive Podcast"
  } = props;
  const { t } = useTheme();

  const [machineCtx, setMachineCtx] = useState<PodcastStateMachineContext>(() =>
    stateMachine.getContext()
  );
  const [questionText, setQuestionText] = useState("");
  const [isMicListening, setIsMicListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [micSupported, setMicSupported] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>(
    "Audio bereit. Drücken Sie auf 'Beitreten / Frage stellen', um eine Zwischenfrage zu stellen."
  );
  const [hostAnswer, setHostAnswer] = useState<AudioInterjectResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
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
      setStatusMessage("Wiedergabe pausiert.");
    } else if (machineCtx.state === "paused" || machineCtx.state === "idle") {
      stateMachine.dispatch({ type: "PLAY" });
      setStatusMessage("Wiedergabe läuft.");
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
      setStatusMessage(
        "Spracherkennung wird von Ihrem Browser nicht unterstützt. Bitte Textfeld nutzen."
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "de-DE";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsMicListening(true);
        setStatusMessage("Mikrofon lauscht... Sprechen Sie jetzt.");
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
        setStatusMessage(
          `Mikrofon-Fehler: ${event.error || "Unbekannter Fehler"}. Nutzen Sie das Textfeld.`
        );
      };

      recognition.onend = () => {
        setIsMicListening(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setIsMicListening(false);
      setMicSupported(false);
      setStatusMessage("Mikrofon konnte nicht initialisiert werden. Bitte Textfeld verwenden.");
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
    setStatusMessage(
      mode === "mic"
        ? "Mikrofon aktiv. Sprechen Sie Ihre Frage oder tippen Sie in das Textfeld."
        : "Zwischenfrage-Modus aktiv. Tippen Sie Ihre Rückfrage ein oder drücken Sie Escape zum Abbrechen."
    );

    if (mode === "mic") {
      startListening();
    }
  };

  // Handle Cancel Interject (e.g. Escape or Cancel button)
  const handleCancelInterject = () => {
    stopListening();
    stateMachine.dispatch({ type: "CANCEL_INTERJECT" });
    setStatusMessage("Zwischenfrage abgebrochen. Wiedergabe fortgesetzt.");
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
    setStatusMessage("Hosts bereiten quellengestützte Antwort vor...");

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
      setStatusMessage("Hosts antworten auf Ihre Zwischenfrage...");
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
    setStatusMessage("Host-Antwort abgeschlossen. Haupt-Podcast läuft weiter.");
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
      aria-label="Interaktiver Audio-Player & Host-Studio"
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
            Status: {podcastStateLabel(machineCtx.state)}
          </span>
          <span className="time-display">
            <span className="sr-only">Zeit: </span>
            {formattedTime(machineCtx.currentTimeMs)} / {formattedTime(machineCtx.durationMs)}
          </span>
        </div>
      </header>

      {/* Main Playback Controls */}
      <fieldset className="player-controls">
        <legend className="sr-only">Audio-Steuerung</legend>
        <button
          ref={playButtonRef}
          type="button"
          onClick={handleTogglePlay}
          aria-label={machineCtx.state === "playing" ? "Podcast pausieren" : "Podcast abspielen"}
          className="btn-play-pause"
          disabled={machineCtx.state === "interjecting" || machineCtx.state === "answering"}
        >
          {machineCtx.state === "playing" ? "Pausieren" : "Abspielen"}
        </button>

        {machineCtx.state !== "interjecting" && machineCtx.state !== "answering" && (
          <button
            ref={interjectButtonRef}
            type="button"
            onClick={() => handleOpenInterject("text")}
            aria-label="Beitreten und Rückfrage an die Hosts stellen"
            className="btn-interject"
            data-testid="btn-audio-interject"
          >
            Beitreten / Frage stellen
          </button>
        )}
      </fieldset>

      {/* Interjection Modal / Input Drawer */}
      {machineCtx.state === "interjecting" && (
        <dialog
          open
          aria-labelledby="interject-dialog-title"
          className="interject-dialog"
          data-testid="interject-dialog"
        >
          <h3 id="interject-dialog-title">Frage an die Podcast-Hosts stellen</h3>
          <p className="interject-hint">
            Das Haupt-Audio wurde an Minute {formattedTime(machineCtx.pausedAtMs)} pausiert. Die
            Hosts antworten anhand Ihrer Notebook-Quellen.
          </p>

          <form onSubmit={handleSubmitQuestion} className="interject-form">
            <div className="input-group">
              <label htmlFor="interject-question-input">Ihre Zwischenfrage:</label>
              <input
                id="interject-question-input"
                ref={inputRef}
                type="text"
                value={questionText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setQuestionText(e.target.value)}
                placeholder="z.B. Wie wird hier die DSGVO-Löschung genau garantiert?"
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
                aria-label={
                  isMicListening ? "Spracheingabe beenden" : "Spracheingabe per Mikrofon starten"
                }
                className={`btn-mic ${isMicListening ? "recording" : ""}`}
              >
                {isMicListening ? "Mikrofon stoppen" : "Sprechen (Mikrofon)"}
              </button>

              {!micSupported && (
                <span className="mic-unsupported-note" role="note">
                  (Mikrofon nicht verfügbar - Tastatureingabe aktiv)
                </span>
              )}
            </div>

            {liveTranscript && (
              <div aria-live="polite" className="live-transcript" data-testid="live-transcript">
                <small>Erkannter Text: </small>
                <em>{liveTranscript}</em>
              </div>
            )}

            <div className="dialog-actions">
              <button
                type="submit"
                disabled={!questionText.trim() || isSubmitting}
                className="btn-submit-question"
                aria-label="Frage absenden und Host-Antwort anfordern"
              >
                {isSubmitting ? "Wird analysiert..." : "Frage stellen"}
              </button>
              <button
                type="button"
                onClick={handleCancelInterject}
                disabled={isSubmitting}
                className="btn-cancel"
                aria-label="Abbrechen und zum Podcast zurückkehren"
              >
                Abbrechen (Esc)
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
          <h3 id="host-answer-title">Antwort der Hosts</h3>
          <div className="dialogue-turns">
            {hostAnswer.turns.map((turn, idx) => (
              <article
                key={`${turn.speaker}-${idx}`}
                className={`host-bubble ${turn.speaker}`}
                aria-label={`Sprecher: ${turn.speakerName}`}
              >
                <strong>{turn.speakerName}: </strong>
                <span>{turn.text}</span>
              </article>
            ))}
          </div>

          {/* Citations list */}
          {hostAnswer.citations.length > 0 && (
            <aside aria-label="Belegte Quellen" className="citations-list">
              <h4>Quellenbelege:</h4>
              <ol>
                {hostAnswer.citations.map((cite) => (
                  <li key={`cite-${cite.index}`}>
                    <span className="cite-badge">[{cite.index}]</span>{" "}
                    <strong>{cite.sourceTitle}</strong>
                    {cite.page ? ` (S. ${cite.page})` : ""}
                    {cite.quote ? ` – „${cite.quote}“` : ""}
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
              aria-label="Host-Antwort beenden und Podcast fortsetzen"
            >
              Podcast fortsetzen ({formattedTime(machineCtx.pausedAtMs)})
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
