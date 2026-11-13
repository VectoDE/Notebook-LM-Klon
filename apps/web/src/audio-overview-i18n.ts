/**
 * Texte der Audio-Übersicht (Issue #240), Deutsch und Englisch.
 * Eigenes Modul, damit der gemeinsame Übersetzungskatalog nicht wächst.
 */
import type { Language } from "./theme-preferences.js";

export interface AudioOverviewTexts {
  readonly region: string;
  readonly heading: string;
  readonly intro: string;
  readonly lengthLegend: string;
  readonly lengthShort: string;
  readonly lengthShortHint: string;
  readonly lengthMedium: string;
  readonly lengthMediumHint: string;
  readonly languageLabel: string;
  readonly generate: string;
  readonly regenerate: string;
  readonly controls: string;
  readonly play: string;
  readonly pause: string;
  readonly resume: string;
  readonly previous: string;
  readonly next: string;
  readonly stop: string;
  readonly keyboardHint: string;
  readonly transcript: string;
  readonly host: string;
  readonly expert: string;
  readonly turnOf: (n: number, total: number) => string;
  readonly duration: (minutes: string) => string;
  readonly turns: (n: number) => string;
  readonly sourcesShort: (minutes: string) => string;
  readonly citations: string;
  readonly citationPage: (page: number) => string;
  readonly fallbackSingleVoice: string;
  readonly fallbackNoVoice: string;
  readonly fallbackUnsupported: string;
  readonly noSources: string;
  readonly stateIdle: string;
  readonly statePlaying: string;
  readonly statePaused: string;
  readonly stateEnded: string;
  readonly speechError: (error: string) => string;
  readonly nowSpeaking: (speaker: string, n: number) => string;
}

export const AUDIO_OVERVIEW_TEXTS: Readonly<Record<Language, AudioOverviewTexts>> = {
  de: {
    region: "Audio-Übersicht",
    heading: "Audio-Übersicht",
    intro:
      "Ein Gespräch zwischen Host und Expertin über Ihre Quellen. Gesprochen wird über die Sprachausgabe Ihres Browsers.",
    lengthLegend: "Länge",
    lengthShort: "Kurz",
    lengthShortHint: "3 bis 5 Minuten",
    lengthMedium: "Mittel",
    lengthMediumHint: "8 bis 12 Minuten",
    languageLabel: "Sprache des Gesprächs",
    generate: "Skript erstellen",
    regenerate: "Skript neu erstellen",
    controls: "Wiedergabe",
    play: "Abspielen",
    pause: "Pause",
    resume: "Fortsetzen",
    previous: "Vorheriger Beitrag",
    next: "Nächster Beitrag",
    stop: "Stopp",
    keyboardHint:
      "Tastatur: Leertaste oder K spielt ab und pausiert, Pfeil links/rechts oder J/L springt zwischen Beiträgen, Pos1 beginnt von vorn, Escape stoppt.",
    transcript: "Transkript",
    host: "Host",
    expert: "Expertin",
    turnOf: (n, total) => `Beitrag ${n} von ${total}`,
    duration: (minutes) => `etwa ${minutes} Min.`,
    turns: (n) => `${n} Beiträge`,
    sourcesShort: (minutes) =>
      `Die Quellen reichen für etwa ${minutes} Minuten. Für die gewählte Länge bitte weitere Quellen hinzufügen.`,
    citations: "Quellenangaben",
    citationPage: (page) => `, S. ${page}`,
    fallbackSingleVoice:
      "Ihr Browser bietet für diese Sprache nur eine Stimme. Host und Expertin sind deshalb an Tonhöhe und Tempo zu unterscheiden.",
    fallbackNoVoice:
      "Für diese Sprache ist keine Stimme installiert. Der Browser nimmt seine Standardstimme; Host und Expertin unterscheiden sich nur in der Tonhöhe.",
    fallbackUnsupported:
      "Ihr Browser unterstützt keine Sprachausgabe. Das Transkript lässt sich trotzdem lesen.",
    noSources: "Wählen Sie mindestens eine Quelle aus, damit ein Skript entstehen kann.",
    stateIdle: "Bereit",
    statePlaying: "Spielt",
    statePaused: "Pausiert",
    stateEnded: "Beendet",
    speechError: (error) =>
      `Die Sprachausgabe wurde unterbrochen (${error}). Bitte erneut auf Abspielen drücken.`,
    nowSpeaking: (speaker, n) => `${speaker}, Beitrag ${n}`
  },
  en: {
    region: "Audio overview",
    heading: "Audio overview",
    intro:
      "A conversation between a host and an expert about your sources, spoken by your browser's speech synthesis.",
    lengthLegend: "Length",
    lengthShort: "Short",
    lengthShortHint: "3 to 5 minutes",
    lengthMedium: "Medium",
    lengthMediumHint: "8 to 12 minutes",
    languageLabel: "Conversation language",
    generate: "Create script",
    regenerate: "Create script again",
    controls: "Playback",
    play: "Play",
    pause: "Pause",
    resume: "Resume",
    previous: "Previous turn",
    next: "Next turn",
    stop: "Stop",
    keyboardHint:
      "Keyboard: Space or K plays and pauses, Left/Right arrow or J/L moves between turns, Home starts over, Escape stops.",
    transcript: "Transcript",
    host: "Host",
    expert: "Expert",
    turnOf: (n, total) => `Turn ${n} of ${total}`,
    duration: (minutes) => `about ${minutes} min`,
    turns: (n) => `${n} turns`,
    sourcesShort: (minutes) =>
      `The sources cover about ${minutes} minutes. Add more sources for the selected length.`,
    citations: "Citations",
    citationPage: (page) => `, p. ${page}`,
    fallbackSingleVoice:
      "Your browser offers only one voice for this language, so host and expert differ by pitch and pace.",
    fallbackNoVoice:
      "No voice is installed for this language. The browser uses its default voice; host and expert differ only by pitch.",
    fallbackUnsupported:
      "Your browser does not support speech synthesis. You can still read the transcript.",
    noSources: "Select at least one source to create a script.",
    stateIdle: "Ready",
    statePlaying: "Playing",
    statePaused: "Paused",
    stateEnded: "Finished",
    speechError: (error) => `Speech output stopped (${error}). Press Play to try again.`,
    nowSpeaking: (speaker, n) => `${speaker}, turn ${n}`
  }
};

/** Minuten mit einer Nachkommastelle, im Format der Sprache (4,5 bzw. 4.5). */
export function formatMinutes(ms: number, language: Language): string {
  const minutes = Math.round(ms / 6000) / 10;
  return minutes.toLocaleString(language === "de" ? "de-DE" : "en-US", {
    maximumFractionDigits: 1
  });
}
