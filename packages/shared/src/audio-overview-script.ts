/**
 * Skriptgenerator der Audio-Übersicht (Issue #240).
 *
 * Baut aus den Quellen eines Notebooks ein Gespräch zwischen Host und Expertin bzw. Experte.
 * Der Inhalt stammt wörtlich aus den Quellen-Abschnitten (jeder Expertenbeitrag zitiert genau
 * einen Abschnitt), Host-Zeilen führen durch das Gespräch. Es gibt kein Sprachmodell und
 * keine erfundenen Fakten: Reichen die Quellen nicht für die gewählte Länge, endet das Skript
 * früher und meldet das über `sourcesExhausted`.
 *
 * Längen (bei 150 Wörtern pro Minute, Sprechtempo 1,0 der Web Speech API):
 * - kurz: 3 bis 5 Minuten, Ziel 4 Minuten
 * - mittel: 8 bis 12 Minuten, Ziel 10 Minuten
 */

export type AudioOverviewLength = "short" | "medium";
export type AudioOverviewLanguage = "de" | "en";
export type AudioOverviewSpeaker = "host" | "expert";

export const AUDIO_OVERVIEW_WORDS_PER_MINUTE = 150;

export interface AudioOverviewLengthSpec {
  readonly minMinutes: number;
  readonly targetMinutes: number;
  readonly maxMinutes: number;
}

export const AUDIO_OVERVIEW_LENGTHS: Readonly<
  Record<AudioOverviewLength, AudioOverviewLengthSpec>
> = {
  short: { minMinutes: 3, targetMinutes: 4, maxMinutes: 5 },
  medium: { minMinutes: 8, targetMinutes: 10, maxMinutes: 12 }
};

export interface AudioOverviewChunkInput {
  readonly id: string;
  readonly text: string;
  readonly pageNumber?: number | null | undefined;
}

export interface AudioOverviewSourceInput {
  readonly id: string;
  readonly title: string;
  /** Sprache des Quelltexts (BCP 47); ohne Angabe gilt die Skriptsprache. */
  readonly lang?: string | undefined;
  readonly chunks: readonly AudioOverviewChunkInput[];
}

export interface AudioOverviewCitation {
  /** Laufende Nummer ab 1, so wie sie im Transkript als [n] erscheint. */
  readonly index: number;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly chunkId: string;
  readonly pageNumber: number | null;
  /** Wörtlicher Auszug aus dem Abschnitt (erster Satz, höchstens 160 Zeichen). */
  readonly quote: string;
}

export interface AudioOverviewTurn {
  readonly index: number;
  readonly speaker: AudioOverviewSpeaker;
  readonly text: string;
  /** Sprache des gesprochenen Texts: Skriptsprache oder Sprache der zitierten Quelle. */
  readonly lang: string;
  readonly citationIndexes: readonly number[];
  readonly words: number;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface AudioOverviewScript {
  readonly length: AudioOverviewLength;
  readonly language: AudioOverviewLanguage;
  readonly turns: readonly AudioOverviewTurn[];
  readonly citations: readonly AudioOverviewCitation[];
  readonly totalWords: number;
  readonly estimatedDurationMs: number;
  readonly targetMinMs: number;
  readonly targetMaxMs: number;
  /** true, wenn die geschätzte Dauer im Zielbereich der gewählten Länge liegt. */
  readonly withinTarget: boolean;
  /** true, wenn alle Quellen-Abschnitte verbraucht sind, bevor die Mindestlänge erreicht war. */
  readonly sourcesExhausted: boolean;
}

export interface BuildAudioOverviewScriptInput {
  readonly sources: readonly AudioOverviewSourceInput[];
  readonly length: AudioOverviewLength;
  readonly language: AudioOverviewLanguage;
  readonly notebookTitle?: string | undefined;
}

interface Phrases {
  readonly intro: (title: string, count: number) => string;
  readonly introExpert: string;
  readonly openSource: (title: string) => string;
  readonly bridges: readonly string[];
  readonly nextSource: (title: string) => string;
  readonly outro: (titles: string) => string;
  readonly outroExpert: string;
  readonly listJoin: string;
}

const PHRASES: Readonly<Record<AudioOverviewLanguage, Phrases>> = {
  de: {
    intro: (title, count) =>
      `Willkommen zur Audio-Übersicht von „${title}“. Wir gehen heute ${count === 1 ? "eine Quelle" : `${count} Quellen`} durch und halten uns dabei eng an den Text.`,
    introExpert:
      "Gern. Alles, was ich gleich sage, steht so in den Quellen. Die Nummern im Transkript zeigen, woher es kommt.",
    openSource: (title) => `Fangen wir mit „${title}“ an. Worum geht es dort?`,
    bridges: [
      "Und was folgt daraus?",
      "Das klingt wichtig. Wie geht es weiter?",
      "Kannst du das etwas genauer erklären?",
      "Was steht dazu noch in der Quelle?",
      "Gibt es dazu ein konkretes Detail?"
    ],
    nextSource: (title) => `Weiter zur nächsten Quelle: „${title}“. Was ist dort der Kern?`,
    outro: (titles) =>
      titles ? `Damit sind wir am Ende. Wir hatten heute ${titles}.` : "Damit sind wir am Ende.",
    outroExpert:
      "Wer tiefer einsteigen will, findet alle Stellen über die Nummern im Transkript direkt in den Quellen.",
    listJoin: " und "
  },
  en: {
    intro: (title, count) =>
      `Welcome to the audio overview of “${title}”. Today we walk through ${count === 1 ? "one source" : `${count} sources`} and stay close to the text.`,
    introExpert:
      "Sure. Everything I am about to say is in the sources. The numbers in the transcript show where it comes from.",
    openSource: (title) => `Let's start with “${title}”. What is it about?`,
    bridges: [
      "And what follows from that?",
      "That sounds important. What comes next?",
      "Can you explain that in a bit more detail?",
      "What else does the source say about it?",
      "Is there a concrete detail on that?"
    ],
    nextSource: (title) => `On to the next source: “${title}”. What is the core of it?`,
    outro: (titles) =>
      titles
        ? `That brings us to the end. Today we covered ${titles}.`
        : "That brings us to the end.",
    outroExpert:
      "If you want to dig deeper, the numbers in the transcript take you straight to each passage in the sources.",
    listJoin: " and "
  }
};

const MIN_TURN_MS = 1500;
const MAX_QUOTE_CHARS = 160;

/** Wörter zählen (Leerraum-getrennt). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Geschätzte Sprechdauer in Millisekunden bei 150 Wörtern pro Minute. */
export function estimateSpeechMs(words: number): number {
  return Math.round((words / AUDIO_OVERVIEW_WORDS_PER_MINUTE) * 60_000);
}

/** Erster Satz eines Abschnitts als Zitat, auf 160 Zeichen gekürzt. */
export function quoteFromChunk(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(normalized);
  const sentence = match?.[1] ?? normalized;
  if (sentence.length <= MAX_QUOTE_CHARS) return sentence;
  return `${sentence.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…`;
}

function formatTitles(
  titles: readonly string[],
  phrases: Phrases,
  language: AudioOverviewLanguage
) {
  const quoted = titles.map((title) => (language === "de" ? `„${title}“` : `“${title}”`));
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")}${phrases.listJoin}${quoted[quoted.length - 1]}`;
}

interface DraftTurn {
  readonly speaker: AudioOverviewSpeaker;
  readonly text: string;
  readonly lang: string;
  readonly citationIndexes: readonly number[];
}

/**
 * Skript erzeugen. Reihenfolge: Einleitung, je Quelle die Abschnitte der Reihe nach
 * (Host leitet über, Expertin bzw. Experte trägt den Abschnitt mit Zitat vor), Abschluss.
 * Abschnitte werden nur so lange aufgenommen, wie die Höchstdauer nicht überschritten wird;
 * ab der Zieldauer endet das Gespräch an der nächsten Abschnittsgrenze.
 */
export function buildAudioOverviewScript(
  input: BuildAudioOverviewScriptInput
): AudioOverviewScript {
  const { length, language } = input;
  const phrases = PHRASES[language];
  const spec = AUDIO_OVERVIEW_LENGTHS[length];
  const targetWords = spec.targetMinutes * AUDIO_OVERVIEW_WORDS_PER_MINUTE;
  const maxWords = spec.maxMinutes * AUDIO_OVERVIEW_WORDS_PER_MINUTE;
  const sources = input.sources.filter((source) =>
    source.chunks.some((chunk) => chunk.text.trim().length > 0)
  );
  const title = input.notebookTitle ?? sources[0]?.title ?? "Notebook";

  const drafts: DraftTurn[] = [];
  const citations: AudioOverviewCitation[] = [];
  const coveredTitles: string[] = [];
  let words = 0;
  let bridgeIndex = 0;
  let sourcesExhausted = true;

  const push = (turn: DraftTurn) => {
    drafts.push(turn);
    words += countWords(turn.text);
  };

  push({
    speaker: "host",
    text: phrases.intro(title, sources.length),
    lang: language,
    citationIndexes: []
  });
  push({ speaker: "expert", text: phrases.introExpert, lang: language, citationIndexes: [] });

  // Reserve für den Abschluss, damit er die Höchstdauer nicht sprengt
  const outroReserve =
    countWords(
      phrases.outro(
        formatTitles(
          sources.map((s) => s.title),
          phrases,
          language
        )
      )
    ) + countWords(phrases.outroExpert);

  outer: for (const [sourceIndex, source] of sources.entries()) {
    let firstInSource = true;
    for (const chunk of source.chunks) {
      const text = chunk.text.replace(/\s+/g, " ").trim();
      if (text.length === 0) continue;
      if (words >= targetWords) {
        sourcesExhausted = false;
        break outer;
      }
      const lead = firstInSource
        ? sourceIndex === 0
          ? phrases.openSource(source.title)
          : phrases.nextSource(source.title)
        : (phrases.bridges[bridgeIndex++ % phrases.bridges.length] as string);
      if (words + countWords(lead) + countWords(text) + outroReserve > maxWords) {
        sourcesExhausted = false;
        break outer;
      }
      if (firstInSource) coveredTitles.push(source.title);
      firstInSource = false;
      const citation: AudioOverviewCitation = {
        index: citations.length + 1,
        sourceId: source.id,
        sourceTitle: source.title,
        chunkId: chunk.id,
        pageNumber: chunk.pageNumber ?? null,
        quote: quoteFromChunk(text)
      };
      citations.push(citation);
      push({ speaker: "host", text: lead, lang: language, citationIndexes: [] });
      push({
        speaker: "expert",
        text,
        lang: source.lang ?? language,
        citationIndexes: [citation.index]
      });
    }
  }

  push({
    speaker: "host",
    text: phrases.outro(formatTitles(coveredTitles, phrases, language)),
    lang: language,
    citationIndexes: []
  });
  push({ speaker: "expert", text: phrases.outroExpert, lang: language, citationIndexes: [] });

  let cursor = 0;
  const turns: AudioOverviewTurn[] = drafts.map((draft, index) => {
    const turnWords = countWords(draft.text);
    const durationMs = Math.max(MIN_TURN_MS, estimateSpeechMs(turnWords));
    const turn: AudioOverviewTurn = {
      index,
      speaker: draft.speaker,
      text: draft.text,
      lang: draft.lang,
      citationIndexes: draft.citationIndexes,
      words: turnWords,
      startMs: cursor,
      durationMs
    };
    cursor += durationMs;
    return turn;
  });

  const targetMinMs = spec.minMinutes * 60_000;
  const targetMaxMs = spec.maxMinutes * 60_000;
  return {
    length,
    language,
    turns,
    citations,
    totalWords: words,
    estimatedDurationMs: cursor,
    targetMinMs,
    targetMaxMs,
    withinTarget: cursor >= targetMinMs && cursor <= targetMaxMs,
    sourcesExhausted: sourcesExhausted && cursor < targetMinMs
  };
}
