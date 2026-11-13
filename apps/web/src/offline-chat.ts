import { fill } from "./i18n.js";
import { LOCAL_MODEL_LABEL } from "./local-llm-config.js";
import type { LocalChatMessage, LocalModelController, LocalModelState } from "./local-llm.js";
import { isEnglish, offlineChatTexts } from "./translations-offline-chat.js";
import type { CitationLocation, WorkspaceSource } from "./workspace-types.js";

/**
 * Offline-Chat (Issue #346): Wahl des Wegs, lokale Suche in den Quellen, Prompt für das
 * lokale Modell.
 *
 * Online antwortet der Server (RAG mit geprüften Zitaten). Ohne Netz oder ohne erreichbaren
 * Server antwortet das lokale Modell auf Grundlage der Quelltexte, die im Browser vorliegen.
 * Zitate kann es dabei nicht prüfen; die Oberfläche zeigt stattdessen die verwendeten Auszüge
 * und sagt das offen.
 */

export type ChatRoute =
  | "server"
  | "local"
  /** Offline, Modell noch nicht geladen: Zustimmung und Download nötig (mit Netz). */
  | "needs-model"
  /** Offline, Browser ohne WebGPU: kein lokaler Chat möglich. */
  | "unsupported";

/** Sichtbarer Modus über dem Eingabefeld. */
export type ChatMode = "online" | "offline-local" | "offline-no-model" | "offline-unsupported";

export function localRouteFor(state: LocalModelState): Exclude<ChatRoute, "server"> {
  if (state.kind === "ready" || state.kind === "cached") return "local";
  if (state.kind === "unsupported") return "unsupported";
  return "needs-model";
}

/** Weg für eine neue Frage. Online geht sie immer zuerst an den Server. */
export function chooseChatRoute(online: boolean, state: LocalModelState): ChatRoute {
  return online ? "server" : localRouteFor(state);
}

export function chatModeFor(online: boolean, state: LocalModelState): ChatMode {
  if (online) return "online";
  const route = localRouteFor(state);
  if (route === "local") return "offline-local";
  return route === "unsupported" ? "offline-unsupported" : "offline-no-model";
}

export interface LocalPassage {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly score: number;
}

const PASSAGE_CHARS = 700;
const MAX_PASSAGES = 4;

/** Wörter ab drei Zeichen, klein, ohne Satzzeichen (Unicode-Buchstaben und Ziffern). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word) => !STOPWORDS.has(word)
  );
}

const STOPWORDS: ReadonlySet<string> = new Set([
  "der",
  "die",
  "das",
  "und",
  "oder",
  "ist",
  "sind",
  "ein",
  "eine",
  "einen",
  "wie",
  "was",
  "wer",
  "mit",
  "für",
  "von",
  "den",
  "dem",
  "des",
  "auf",
  "the",
  "and",
  "for",
  "are",
  "what",
  "how",
  "who",
  "with",
  "from",
  "this",
  "that"
]);

/** Zerlegt einen Text in Abschnitte von höchstens maxChars Zeichen, an Absatz- oder Satzgrenzen. */
export function splitPassages(
  text: string,
  maxChars = PASSAGE_CHARS
): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (cut > maxChars / 3) end = start + cut + 1;
    }
    const slice = text.slice(start, end);
    if (slice.trim())
      parts.push({ text: slice.trim(), start: start + (slice.length - slice.trimStart().length) });
    start = end;
  }
  return parts;
}

/**
 * Sucht in den ausgewählten Quellen die Abschnitte mit den meisten Treffern der Frage
 * (Wortüberlappung, gewichtet nach Seltenheit). Ohne Treffer: die Anfänge der Quellen,
 * damit das Modell überhaupt Material hat.
 */
export function retrieveLocalPassages(
  question: string,
  sources: readonly WorkspaceSource[],
  limit = MAX_PASSAGES
): LocalPassage[] {
  const selected = sources.filter((s) => s.isSelected && s.rawText?.trim());
  const candidates = selected.flatMap((source) =>
    splitPassages(source.rawText as string).map((part) => ({ source, part }))
  );
  if (candidates.length === 0) return [];
  const query = new Set(terms(question));
  const docFreq = new Map<string, number>();
  const termSets = candidates.map(({ part }) => new Set(terms(part.text)));
  for (const set of termSets)
    for (const word of set) docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
  const scored = candidates.map(({ source, part }, i) => {
    let score = 0;
    const set = termSets[i] as Set<string>;
    for (const word of query) {
      // Seltene Wörter zählen mehr (IDF); docFreq ist für jedes Wort im Abschnitt gesetzt
      if (set.has(word)) score += Math.log(1 + candidates.length / (docFreq.get(word) as number));
    }
    return {
      sourceId: source.id,
      sourceTitle: source.title,
      text: part.text,
      startOffset: part.start,
      endOffset: part.start + part.text.length,
      score
    };
  });
  const hits = scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  if (hits.length > 0) return hits.slice(0, limit);
  // Kein Treffer: je Quelle der erste Abschnitt
  const firsts = new Map<string, LocalPassage>();
  for (const passage of scored)
    if (!firsts.has(passage.sourceId)) firsts.set(passage.sourceId, passage);
  return [...firsts.values()].slice(0, limit);
}

/** Verwendete Auszüge als Sprungziele in die Quellen (keine geprüften Belege). */
export function passagesToLocations(passages: readonly LocalPassage[]): CitationLocation[] {
  return passages.map((p) => ({
    sourceId: p.sourceId,
    quote: p.text.length > 160 ? `${p.text.slice(0, 157)}…` : p.text,
    page: null,
    startOffset: p.startOffset,
    endOffset: p.endOffset
  }));
}

const SYSTEM_PROMPT = {
  de: [
    "Du bist ein Recherche-Assistent und arbeitest offline auf dem Gerät des Nutzers.",
    "Antworte auf Deutsch, knapp und sachlich, nur mit Informationen aus den Auszügen unten.",
    "Steht die Antwort nicht in den Auszügen, sage genau das und erfinde nichts.",
    "Schreibe keine Quellenmarker wie [1]."
  ].join(" "),
  en: [
    "You are a research assistant running offline on the user's device.",
    "Answer in English, briefly and factually, using only information from the excerpts below.",
    "If the answer is not in the excerpts, say so and do not make anything up.",
    "Do not write source markers such as [1]."
  ].join(" ")
} as const;

const NO_SOURCES = {
  de: "Es liegen keine ausgewählten Quelltexte vor. Sage, dass du ohne Quellen nicht antworten kannst.",
  en: "No selected source texts are available. Say that you cannot answer without sources."
} as const;

/** Nachrichten für das lokale Modell: Systemanweisung mit Auszügen, Verlauf, neue Frage. */
export function buildLocalMessages(
  question: string,
  passages: readonly LocalPassage[],
  language: "de" | "en",
  history: readonly LocalChatMessage[] = []
): LocalChatMessage[] {
  const excerpts =
    passages.length === 0
      ? NO_SOURCES[language]
      : passages.map((p, i) => `--- ${i + 1}: ${p.sourceTitle} ---\n${p.text}`).join("\n\n");
  return [
    { role: "system", content: `${SYSTEM_PROMPT[language]}\n\n${excerpts}` },
    // Nur die letzten Wechsel, damit das Kontextfenster (4096 Token) reicht
    ...history.slice(-4),
    { role: "user", content: question }
  ];
}

/** Entfernt Quellenmarker wie [1], die das Modell trotz Anweisung schreibt. */
export function stripMarkers(text: string): string {
  return text.replace(/\s?\[\d+\]/g, "");
}

/** Was die Chat-Oberfläche über eine Offline-Antwort anzeigt (Texte schon in der Sprache). */
export interface OfflineAnswerInfo {
  readonly modelLabel: string;
  /** Ehrlicher Hinweis: offline keine geprüften Zitate. */
  readonly note: string;
  readonly passages: readonly {
    readonly location: CitationLocation;
    readonly label: string;
  }[];
}

export interface OfflineAnswerRequest {
  readonly question: string;
  readonly sources: readonly WorkspaceSource[];
  readonly language: string;
  /** Geladener Katalog der Sprache, etwa Leichte Sprache (siehe offlineChatTexts). */
  readonly own?: Readonly<Record<string, string>> | undefined;
  readonly history?: readonly LocalChatMessage[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onStart: (info: OfflineAnswerInfo) => void;
  readonly onText: (content: string) => void;
}

export type OfflineAnswerResult = "answered" | "needs-model" | "unsupported";

type StreamingController = Pick<LocalModelController, "getState" | "stream">;

/**
 * Beantwortet eine Frage mit dem lokalen Modell. Ohne nutzbares Modell kommt der Grund zurück
 * (needs-model, unsupported), ohne dass etwas geladen wird. Abbruch wirft einen AbortError.
 */
export async function answerOffline(
  controller: StreamingController,
  request: OfflineAnswerRequest
): Promise<OfflineAnswerResult> {
  const route = localRouteFor(controller.getState());
  if (route !== "local") return route;
  const texts = offlineChatTexts(request.language, request.own);
  const language = isEnglish(request.language) ? "en" : "de";
  const passages = retrieveLocalPassages(request.question, request.sources);
  request.onStart({
    modelLabel: LOCAL_MODEL_LABEL,
    note: texts[passages.length > 0 ? "chatOfflineNote" : "chatOfflineNoPassages"] as string,
    passages: passagesToLocations(passages).map((location, i) => ({
      location,
      label: fill(texts.chatOfflinePassageAria as string, { n: i + 1 })
    }))
  });
  let raw = "";
  const messages = buildLocalMessages(request.question, passages, language, request.history);
  for await (const delta of controller.stream(messages, request.signal)) {
    raw += delta;
    request.onText(stripMarkers(raw));
  }
  return "answered";
}

/** Fehlertext zur Lage, in der Sprache der Oberfläche. */
export function offlineErrorText(
  reason: Exclude<OfflineAnswerResult, "answered"> | "failed",
  language: string,
  own: Readonly<Record<string, string>> = {}
): string {
  const key =
    reason === "unsupported"
      ? "errorOfflineUnsupported"
      : reason === "needs-model"
        ? "errorOfflineNoModel"
        : "errorLocalFailed";
  return offlineChatTexts(language, own)[key] as string;
}
