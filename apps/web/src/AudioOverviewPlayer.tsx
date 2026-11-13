import {
  type AudioOverviewLanguage,
  type AudioOverviewLength,
  type AudioOverviewScript,
  type AudioOverviewSourceInput,
  buildAudioOverviewScript
} from "@notebook-lm/shared";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { AUDIO_OVERVIEW_TEXTS, formatMinutes } from "./audio-overview-i18n.js";
import {
  AudioOverviewSpeechController,
  type PlaybackState,
  type SpeechSynthesisLike,
  type UtteranceFactory,
  type VoiceFallback,
  audioOverviewKeyAction,
  browserSpeech,
  pickVoicesForLang
} from "./audio-overview-speech.js";
import "./audio-overview.css";
import { useTheme } from "./useTheme.js";

export interface AudioOverviewSpeechApi {
  readonly synth: SpeechSynthesisLike;
  readonly createUtterance: UtteranceFactory;
}

export interface AudioOverviewPlayerProps {
  readonly sources: readonly AudioOverviewSourceInput[];
  readonly notebookTitle?: string | undefined;
  readonly initialLength?: AudioOverviewLength | undefined;
  /** Vorgefertigtes Skript (Tests, gespeicherte Übersicht); sonst entsteht es per Knopf. */
  readonly initialScript?: AudioOverviewScript | undefined;
  /** Sprachausgabe; ohne Angabe die des Browsers, null bedeutet "nicht vorhanden". */
  readonly speech?: AudioOverviewSpeechApi | null | undefined;
}

const FALLBACK_RANK: Readonly<Record<VoiceFallback, number>> = {
  none: 0,
  "single-voice": 1,
  "no-voice": 2,
  unsupported: 3
};

/** Ungünstigster Stimmen-Hinweis über alle Sprachen des Skripts. */
export function worstVoiceFallback(
  speech: AudioOverviewSpeechApi | null,
  langs: readonly string[]
): VoiceFallback {
  if (!speech) return "unsupported";
  const voices = speech.synth.getVoices();
  let worst: VoiceFallback = "none";
  for (const lang of langs) {
    const fallback = pickVoicesForLang(voices, lang).fallback;
    if (FALLBACK_RANK[fallback] > FALLBACK_RANK[worst]) worst = fallback;
  }
  return worst;
}

export function AudioOverviewPlayer(props: AudioOverviewPlayerProps) {
  const { sources, notebookTitle, initialLength = "short", initialScript } = props;
  const { language } = useTheme();
  const txt = AUDIO_OVERVIEW_TEXTS[language];
  const baseId = useId();
  const speech = useMemo<AudioOverviewSpeechApi | null>(
    () => (props.speech === undefined ? browserSpeech() : props.speech),
    [props.speech]
  );

  const [length, setLength] = useState<AudioOverviewLength>(initialScript?.length ?? initialLength);
  const [scriptLang, setScriptLang] = useState<AudioOverviewLanguage>(
    initialScript?.language ?? language
  );
  const [script, setScript] = useState<AudioOverviewScript | null>(initialScript ?? null);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const controllerRef = useRef<AudioOverviewSpeechController | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);

  // Je Skript ein Controller; beim Wechsel oder Verlassen verstummt die alte Ausgabe
  useEffect(() => {
    if (!script || !speech) {
      controllerRef.current = null;
      return;
    }
    const controller = new AudioOverviewSpeechController({
      synth: speech.synth,
      createUtterance: speech.createUtterance,
      turns: script.turns,
      onTurnChange: setCurrentIndex,
      onStateChange: setPlayback,
      onError: (error) => setSpeechError(error)
    });
    controllerRef.current = controller;
    setCurrentIndex(0);
    setPlayback("idle");
    return () => controller.stop();
  }, [script, speech]);

  // Stimmen laden in Chrome asynchron nach; danach Zuordnung und Hinweis neu berechnen
  useEffect(() => {
    const synth = speech?.synth as
      | (SpeechSynthesisLike & {
          addEventListener?: (type: string, listener: () => void) => void;
          removeEventListener?: (type: string, listener: () => void) => void;
        })
      | undefined;
    if (!synth?.addEventListener) return;
    const onVoices = () => {
      controllerRef.current?.invalidateVoices();
      setVoiceRevision((n) => n + 1);
    };
    synth.addEventListener("voiceschanged", onVoices);
    return () => synth.removeEventListener?.("voiceschanged", onVoices);
  }, [speech]);

  // Aktiven Beitrag im Transkript sichtbar halten
  useEffect(() => {
    if (playback !== "playing") return;
    const item = transcriptRef.current?.querySelector<HTMLElement>(
      `[data-turn-index="${currentIndex}"]`
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [currentIndex, playback]);

  const langs = useMemo(
    () => (script ? Array.from(new Set(script.turns.map((turn) => turn.lang))) : [scriptLang]),
    [script, scriptLang]
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: voiceRevision löst die Neuberechnung nach voiceschanged aus
  const fallback = useMemo(() => worstVoiceFallback(speech, langs), [speech, langs, voiceRevision]);

  const hasSources = sources.some((source) => source.chunks.length > 0);

  const generate = () => {
    controllerRef.current?.stop();
    setSpeechError(null);
    setScript(buildAudioOverviewScript({ sources, length, language: scriptLang, notebookTitle }));
  };

  const run = (action: "toggle" | "next" | "previous" | "restart" | "stop") => {
    const controller = controllerRef.current;
    if (!controller) return;
    setSpeechError(null);
    if (action === "toggle") controller.toggle();
    else if (action === "next") controller.next();
    else if (action === "previous") controller.previous();
    else if (action === "restart") controller.play(0);
    else controller.stop();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const action = audioOverviewKeyAction(event.key, event, (event.target as HTMLElement).tagName);
    if (!action || !controllerRef.current) return;
    event.preventDefault();
    run(action);
  };

  const stateLabel = {
    idle: txt.stateIdle,
    playing: txt.statePlaying,
    paused: txt.statePaused,
    ended: txt.stateEnded
  }[playback];
  const toggleLabel =
    playback === "playing" ? txt.pause : playback === "paused" ? txt.resume : txt.play;
  const fallbackText =
    fallback === "single-voice"
      ? txt.fallbackSingleVoice
      : fallback === "no-voice"
        ? txt.fallbackNoVoice
        : fallback === "unsupported"
          ? txt.fallbackUnsupported
          : null;
  const total = script?.turns.length ?? 0;
  const activeTurn = script?.turns[currentIndex];
  const playerDisabled = !script || !speech;
  const citationLang = (index: number): string | undefined => {
    const lang = script?.turns.find((turn) => turn.citationIndexes.includes(index))?.lang;
    return lang && lang !== language ? lang : undefined;
  };
  const hintId = `${baseId}-keys`;

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="audio-overview"
      data-testid="audio-overview"
      onKeyDown={onKeyDown}
    >
      <header className="player-header">
        <h2 id={`${baseId}-title`}>{txt.heading}</h2>
        <div className="player-meta">
          <span className="state-badge" data-testid="audio-overview-state" data-state={playback}>
            {stateLabel}
          </span>
          {script && (
            <span className="time-display" data-testid="audio-overview-duration">
              {txt.duration(formatMinutes(script.estimatedDurationMs, language))} ·{" "}
              {txt.turns(total)}
            </span>
          )}
        </div>
      </header>
      <p className="audio-overview-intro">{txt.intro}</p>

      <div className="audio-overview-setup">
        <fieldset className="audio-overview-length">
          <legend>{txt.lengthLegend}</legend>
          {(["short", "medium"] as const).map((value) => (
            <label key={value} className="audio-overview-option">
              <input
                type="radio"
                name={`${baseId}-length`}
                value={value}
                checked={length === value}
                onChange={() => setLength(value)}
                data-testid={`audio-overview-length-${value}`}
              />
              <span>
                {value === "short" ? txt.lengthShort : txt.lengthMedium}
                <small>{value === "short" ? txt.lengthShortHint : txt.lengthMediumHint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="audio-overview-lang">
          <span>{txt.languageLabel}</span>
          <select
            value={scriptLang}
            onChange={(event) => setScriptLang(event.target.value as AudioOverviewLanguage)}
            data-testid="audio-overview-language"
          >
            <option value="de" lang="de">
              Deutsch
            </option>
            <option value="en" lang="en">
              English
            </option>
          </select>
        </label>
        <button
          type="button"
          className="audio-overview-btn audio-overview-btn--primary"
          onClick={generate}
          disabled={!hasSources}
          data-testid="audio-overview-generate"
        >
          {script ? txt.regenerate : txt.generate}
        </button>
      </div>
      {!hasSources && (
        <p className="audio-overview-note" role="note">
          {txt.noSources}
        </p>
      )}

      {fallbackText && (
        <p className="audio-overview-note" role="note" data-testid="audio-overview-fallback">
          {fallbackText}
        </p>
      )}

      {script?.sourcesExhausted && (
        <p className="audio-overview-note" role="note" data-testid="audio-overview-short-note">
          {txt.sourcesShort(formatMinutes(script.estimatedDurationMs, language))}
        </p>
      )}

      {speechError && (
        <p role="alert" className="audio-overview-note audio-overview-error">
          {txt.speechError(speechError)}
        </p>
      )}

      {script && (
        <>
          <fieldset className="player-controls" aria-describedby={hintId}>
            <legend className="sr-only">{txt.controls}</legend>
            <button
              type="button"
              className="audio-overview-btn"
              onClick={() => run("previous")}
              disabled={playerDisabled || currentIndex === 0}
              aria-keyshortcuts="ArrowLeft J"
              data-testid="audio-overview-previous"
            >
              {txt.previous}
            </button>
            <button
              type="button"
              className="audio-overview-btn audio-overview-btn--primary"
              onClick={() => run("toggle")}
              disabled={playerDisabled}
              aria-keyshortcuts="Space K"
              data-testid="audio-overview-toggle"
            >
              {toggleLabel}
            </button>
            <button
              type="button"
              className="audio-overview-btn"
              onClick={() => run("next")}
              disabled={playerDisabled || currentIndex >= total - 1}
              aria-keyshortcuts="ArrowRight L"
              data-testid="audio-overview-next"
            >
              {txt.next}
            </button>
            <button
              type="button"
              className="audio-overview-btn"
              onClick={() => run("stop")}
              disabled={playerDisabled || playback === "idle"}
              aria-keyshortcuts="Escape"
              data-testid="audio-overview-stop"
            >
              {txt.stop}
            </button>
          </fieldset>
          <p id={hintId} className="audio-overview-note">
            {txt.keyboardHint}
          </p>

          <output aria-live="polite" className="sr-only" data-testid="audio-overview-live">
            {playback === "playing" && activeTurn
              ? `${stateLabel}: ${txt.nowSpeaking(
                  activeTurn.speaker === "host" ? txt.host : txt.expert,
                  currentIndex + 1
                )}`
              : stateLabel}
          </output>

          <h3 id={`${baseId}-transcript`} className="audio-overview-subhead">
            {txt.transcript}
          </h3>
          <ol
            ref={transcriptRef}
            // Scrollbereich: per Tastatur erreichbar, Leertaste/Pfeile steuern die Wiedergabe
            // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollbarer Bereich muss fokussierbar sein (WCAG 2.1.1)
            tabIndex={0}
            className="audio-overview-transcript"
            aria-labelledby={`${baseId}-transcript`}
            data-testid="audio-overview-transcript"
          >
            {script.turns.map((turn) => {
              const active = turn.index === currentIndex && playback !== "idle";
              return (
                <li
                  key={turn.index}
                  data-turn-index={turn.index}
                  data-speaker={turn.speaker}
                  aria-current={active ? "true" : undefined}
                  className={`audio-overview-turn${active ? " is-active" : ""}`}
                >
                  <span className="audio-overview-speaker">
                    {turn.speaker === "host" ? txt.host : txt.expert}
                    <span className="sr-only">, {txt.turnOf(turn.index + 1, total)}</span>
                  </span>
                  <p lang={turn.lang === language ? undefined : turn.lang}>
                    {turn.text}
                    {turn.citationIndexes.map((n) => (
                      <a
                        key={n}
                        href={`#${baseId}-cite-${n}`}
                        className="audio-overview-cite"
                        aria-label={`${txt.citations} ${n}`}
                      >
                        [{n}]
                      </a>
                    ))}
                  </p>
                </li>
              );
            })}
          </ol>

          {script.citations.length > 0 && (
            <>
              <h3 id={`${baseId}-citations`} className="audio-overview-subhead">
                {txt.citations}
              </h3>
              <ol
                className="audio-overview-citations"
                aria-labelledby={`${baseId}-citations`}
                data-testid="audio-overview-citations"
              >
                {script.citations.map((citation) => (
                  <li key={citation.index} id={`${baseId}-cite-${citation.index}`}>
                    <span className="cite-badge">[{citation.index}]</span>{" "}
                    <strong>{citation.sourceTitle}</strong>
                    {citation.pageNumber ? txt.citationPage(citation.pageNumber) : ""}:{" "}
                    <q lang={citationLang(citation.index)}>{citation.quote}</q>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
