/**
 * Wiedergabe der Audio-Übersicht über die Web Speech API (Issue #240).
 *
 * Host und Expertin bzw. Experte sprechen mit zwei unterscheidbaren Stimmen. Bietet der
 * Browser für eine Sprache nur eine Stimme, unterscheiden sich die Rollen über Tonhöhe und
 * Tempo, und die Oberfläche zeigt einen Hinweis. Alles hier arbeitet gegen schmale
 * Schnittstellen (SpeechSynthesisLike), damit Tests ohne Browser mit einem Mock laufen.
 */

export type AudioOverviewRole = "host" | "expert";

export interface SpeechVoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly voiceURI: string;
  readonly default?: boolean | undefined;
}

export interface SpeechUtteranceLike {
  text: string;
  lang: string;
  voice: SpeechVoiceLike | null;
  pitch: number;
  rate: number;
  onend: (() => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechUtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): readonly SpeechVoiceLike[];
}

export type UtteranceFactory = (text: string) => SpeechUtteranceLike;

/**
 * none: zwei verschiedene Stimmen. single-voice: nur eine Stimme, Rollen per Tonhöhe.
 * no-voice: keine Stimme für die Sprache, der Browser wählt selbst. unsupported: keine API.
 */
export type VoiceFallback = "none" | "single-voice" | "no-voice" | "unsupported";

export interface RoleVoice {
  readonly voice: SpeechVoiceLike | null;
  readonly pitch: number;
  readonly rate: number;
}

export interface VoiceAssignment {
  readonly host: RoleVoice;
  readonly expert: RoleVoice;
  readonly fallback: VoiceFallback;
}

/** Bevorzugte Region je Sprache: zuerst exakte Treffer (de-DE, en-US), dann der Rest. */
const PREFERRED_REGION: Readonly<Record<string, string>> = { de: "de-de", en: "en-us" };

function normalizeLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, "-");
}

/** Stimmen einer Sprache (Präfix "de" oder "en"), bevorzugte Region und Standard zuerst. */
export function voicesForLang(voices: readonly SpeechVoiceLike[], lang: string): SpeechVoiceLike[] {
  const prefix = normalizeLang(lang).split("-")[0] as string;
  const preferred = PREFERRED_REGION[prefix];
  const score = (voice: SpeechVoiceLike) =>
    (normalizeLang(voice.lang) === preferred ? 0 : 2) + (voice.default ? 0 : 1);
  return voices
    .filter((voice) => normalizeLang(voice.lang).split("-")[0] === prefix)
    .sort((a, b) => score(a) - score(b));
}

/**
 * Stimmen für Host und Expertin/Experte wählen. Zwei Stimmen: leicht unterschiedliche
 * Tonhöhe als zusätzliches Merkmal. Eine Stimme: deutlich unterschiedliche Tonhöhe und
 * Tempo, Hinweis "single-voice". Keine Stimme: Hinweis "no-voice".
 */
export function pickVoicesForLang(
  voices: readonly SpeechVoiceLike[],
  lang: string
): VoiceAssignment {
  const candidates = voicesForLang(voices, lang);
  const host = candidates[0];
  if (!host) {
    return {
      host: { voice: null, pitch: 1.15, rate: 1 },
      expert: { voice: null, pitch: 0.8, rate: 0.95 },
      fallback: "no-voice"
    };
  }
  const expert = candidates.find((voice) => voice.name !== host.name);
  if (!expert) {
    return {
      host: { voice: host, pitch: 1.2, rate: 1.05 },
      expert: { voice: host, pitch: 0.75, rate: 0.95 },
      fallback: "single-voice"
    };
  }
  return {
    host: { voice: host, pitch: 1.05, rate: 1 },
    expert: { voice: expert, pitch: 0.95, rate: 1 },
    fallback: "none"
  };
}

/** Speech-Schnittstellen des Browsers, falls vorhanden. */
export function browserSpeech(
  scope: unknown = typeof window === "undefined" ? undefined : window
): { synth: SpeechSynthesisLike; createUtterance: UtteranceFactory } | null {
  const candidate = scope as
    | {
        speechSynthesis?: SpeechSynthesisLike;
        SpeechSynthesisUtterance?: new (text: string) => SpeechUtteranceLike;
      }
    | undefined;
  const synth = candidate?.speechSynthesis;
  const Utterance = candidate?.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== "function") return null;
  return { synth, createUtterance: (text) => new Utterance(text) };
}

export type PlaybackState = "idle" | "playing" | "paused" | "ended";

export interface SpeechTurn {
  readonly speaker: AudioOverviewRole;
  readonly text: string;
  readonly lang: string;
}

export interface AudioOverviewSpeechOptions {
  readonly synth: SpeechSynthesisLike;
  readonly createUtterance: UtteranceFactory;
  readonly turns: readonly SpeechTurn[];
  readonly onTurnChange?: ((index: number) => void) | undefined;
  readonly onStateChange?: ((state: PlaybackState) => void) | undefined;
  readonly onError?: ((error: string) => void) | undefined;
}

/** Fehler, die beim Abbrechen oder Springen entstehen und keine echten Fehler sind. */
const IGNORED_ERRORS = new Set(["interrupted", "canceled"]);

/**
 * Spielt die Beiträge nacheinander ab, je Beitrag eine Äußerung. Jeder Sprung erhöht die
 * Generation; Ereignisse älterer Äußerungen (etwa onend nach cancel()) werden verworfen.
 */
export class AudioOverviewSpeechController {
  private stateValue: PlaybackState = "idle";
  private indexValue = 0;
  private generation = 0;
  private readonly assignments = new Map<string, VoiceAssignment>();

  constructor(private readonly options: AudioOverviewSpeechOptions) {}

  get state(): PlaybackState {
    return this.stateValue;
  }

  get currentIndex(): number {
    return this.indexValue;
  }

  /** Stimmen für eine Sprache (zwischengespeichert, bis invalidateVoices()). */
  voicesFor(lang: string): VoiceAssignment {
    const key = normalizeLang(lang);
    let assignment = this.assignments.get(key);
    if (!assignment) {
      assignment = pickVoicesForLang(this.options.synth.getVoices(), lang);
      this.assignments.set(key, assignment);
    }
    return assignment;
  }

  /** Nach "voiceschanged" aufrufen: die Stimmenliste ist dann vollständig. */
  invalidateVoices(): void {
    this.assignments.clear();
  }

  play(fromIndex: number = this.stateValue === "ended" ? 0 : this.indexValue): void {
    // Erst die Generation erhöhen: manche Browser feuern onend synchron beim cancel()
    this.generation += 1;
    this.options.synth.cancel();
    this.speak(this.clamp(fromIndex));
  }

  pause(): void {
    if (this.stateValue !== "playing") return;
    this.options.synth.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.stateValue !== "paused") return;
    this.options.synth.resume();
    this.setState("playing");
  }

  toggle(): void {
    if (this.stateValue === "playing") this.pause();
    else if (this.stateValue === "paused") this.resume();
    else this.play();
  }

  next(): void {
    this.jump(this.indexValue + 1);
  }

  previous(): void {
    this.jump(this.indexValue - 1);
  }

  /** Zu einem Beitrag springen; läuft die Wiedergabe, geht sie dort weiter. */
  jump(index: number): void {
    const target = this.clamp(index);
    if (this.stateValue === "playing" || this.stateValue === "paused") {
      this.play(target);
      return;
    }
    this.setIndex(target);
  }

  stop(): void {
    this.generation += 1;
    this.options.synth.cancel();
    this.setIndex(0);
    this.setState("idle");
  }

  private clamp(index: number): number {
    return Math.min(Math.max(0, index), Math.max(0, this.options.turns.length - 1));
  }

  private setIndex(index: number): void {
    if (index === this.indexValue) return;
    this.indexValue = index;
    this.options.onTurnChange?.(index);
  }

  private setState(state: PlaybackState): void {
    if (state === this.stateValue) return;
    this.stateValue = state;
    this.options.onStateChange?.(state);
  }

  private speak(index: number): void {
    const turn = this.options.turns[index];
    if (!turn) {
      this.setState("ended");
      return;
    }
    const generation = this.generation;
    const role = this.voicesFor(turn.lang)[turn.speaker];
    const utterance = this.options.createUtterance(turn.text);
    utterance.lang = turn.lang;
    utterance.voice = role.voice;
    utterance.pitch = role.pitch;
    utterance.rate = role.rate;
    utterance.onend = () => {
      if (generation !== this.generation) return;
      if (index + 1 >= this.options.turns.length) {
        this.setState("ended");
        return;
      }
      this.speak(index + 1);
    };
    utterance.onerror = (event) => {
      if (generation !== this.generation) return;
      const error = event.error ?? "unknown";
      if (IGNORED_ERRORS.has(error)) return;
      this.generation += 1;
      this.setState("idle");
      this.options.onError?.(error);
    };
    this.setIndex(index);
    this.setState("playing");
    this.options.synth.speak(utterance);
  }
}

export type AudioOverviewKeyAction = "toggle" | "next" | "previous" | "restart" | "stop";

/**
 * Tastenkürzel des Players: Leertaste oder K (Wiedergabe/Pause), Pfeil rechts oder L
 * (nächster Beitrag), Pfeil links oder J (vorheriger), Pos1 (von vorn), Escape (Stopp).
 * Mit Strg, Alt oder Meta greift nichts. Die Leertaste auf Knöpfen, Eingabefeldern und
 * Auswahlfeldern bleibt beim Element, sonst würde sie doppelt auslösen.
 */
export function audioOverviewKeyAction(
  key: string,
  modifiers: { readonly ctrlKey?: boolean; readonly altKey?: boolean; readonly metaKey?: boolean },
  targetTag = ""
): AudioOverviewKeyAction | null {
  if (modifiers.ctrlKey || modifiers.altKey || modifiers.metaKey) return null;
  const tag = targetTag.toUpperCase();
  const interactive = tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  switch (key) {
    case " ":
    case "Spacebar":
      return interactive ? null : "toggle";
    case "k":
    case "K":
      return tag === "INPUT" || tag === "TEXTAREA" ? null : "toggle";
    case "ArrowRight":
    case "l":
    case "L":
      return tag === "INPUT" || tag === "TEXTAREA" ? null : "next";
    case "ArrowLeft":
    case "j":
    case "J":
      return tag === "INPUT" || tag === "TEXTAREA" ? null : "previous";
    case "Home":
      return tag === "INPUT" || tag === "TEXTAREA" ? null : "restart";
    case "Escape":
      return "stop";
    default:
      return null;
  }
}
