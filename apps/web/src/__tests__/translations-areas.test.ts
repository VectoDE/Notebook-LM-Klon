import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PodcastStateMachine, PodcastStateMachineContext } from "@notebook-lm/shared";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "../ChatPanel.js";
import { DeepDiveStage } from "../DeepDiveStage.js";
import { FlashcardsViewer, describeNextReview, describeRepetitions } from "../FlashcardsViewer.js";
import { InteractiveAudioHostPlayer } from "../InteractiveAudioHostPlayer.js";
import { LiveLyrics } from "../LiveLyrics.js";
import { MindmapViewer } from "../MindmapViewer.js";
import { QuizViewer } from "../QuizViewer.js";
import { SourcesPanel } from "../SourcesPanel.js";
import { StudioPanel } from "../StudioPanel.js";
import { VideoOverviewPlayer } from "../VideoOverviewPlayer.js";
import { podcastStateKey } from "../stage-visuals.js";
import { AREA_DE, AREA_EN } from "../translations-areas.js";
import {
  TRANSLATIONS,
  ThemeProvider,
  type ThemeProviderProps,
  fill,
  translate,
  useTheme
} from "../useTheme.js";

const SRC = join(__dirname, "..");

/** Schlüssel aus t("…"), tf("…") und labelKey/hintKey-Angaben im Quelltext. */
function usedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of readdirSync(SRC).filter((f) => /\.tsx?$/.test(f))) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const m of text.matchAll(/\bt[f]?\(\s*"([A-Za-z0-9]+)"/g)) {
      if (m[1]) found.set(m[1], file);
    }
  }
  return found;
}

describe("Bedientexte der Bereiche (Issue #320)", () => {
  it("jeder im Quelltext benutzte Schlüssel steht in Deutsch und Englisch", () => {
    for (const [key, file] of usedKeys()) {
      expect(TRANSLATIONS.de[key], `${file}: ${key} (de)`).toBeTruthy();
      expect(TRANSLATIONS.en[key], `${file}: ${key} (en)`).toBeTruthy();
    }
  });

  it("Deutsch und Englisch führen dieselben Platzhalter", () => {
    for (const key of Object.keys(AREA_DE)) {
      const names = (text: string | undefined) =>
        [...(text ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(AREA_EN[key]), key).toEqual(names(AREA_DE[key]));
    }
  });

  it("fill setzt Werte ein und lässt unbekannte Platzhalter stehen", () => {
    expect(fill("{n} von {total}", { n: 2, total: 5 })).toBe("2 von 5");
    expect(fill("{n} und {fehlt}", { n: 1 })).toBe("1 und {fehlt}");
  });

  it("tf im Provider und im Rückfall ohne Provider", () => {
    const seen: string[] = [];
    function Probe() {
      const { tf } = useTheme();
      seen.push(tf("studioSub", { n: 6 }));
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { defaultLanguage: "en" } as ThemeProviderProps,
        createElement(Probe)
      )
    );
    expect(seen).toEqual(["6 Werkzeuge aus Ihren Quellen", "6 tools from your sources"]);
  });

  it("Lernkarten-Texte folgen der Sprache", () => {
    expect(describeNextReview(0)).toBe("heute");
    expect(describeNextReview(0, "en")).toBe("today");
    expect(describeNextReview(1, "en")).toBe("tomorrow");
    expect(describeNextReview(6, "en")).toBe("in 6 days");
    expect(describeNextReview(6)).toBe("in 6 Tagen");
    expect(describeRepetitions(1, "en")).toBe("1 repetition");
    expect(describeRepetitions(3, "en")).toBe("3 repetitions");
    expect(describeRepetitions(3)).toBe("3 Wiederholungen");
  });

  it("Player-Zustände haben je einen Katalogschlüssel", () => {
    for (const state of ["idle", "playing", "paused", "interjecting", "answering", "resuming"]) {
      expect(translate("de", podcastStateKey(state)), state).toBeTruthy();
      expect(translate("en", podcastStateKey(state)), state).toBeTruthy();
    }
    expect(podcastStateKey("buffering")).toBe("podStateIdle");
  });
});

/** Deutsche Wörter, die in der englischen Oberfläche nicht vorkommen dürfen. */
const GERMAN_WORDS = [
  "Quellen",
  "Quelle ",
  "hochladen",
  "Datei",
  "Frage",
  "Antwort",
  "Werkzeuge",
  "Lernkarten",
  "Abbrechen",
  "Schließen",
  "Vorlesen",
  "Zurück",
  "Weiter",
  "Starten",
  "Kapitel",
  "Untertitel",
  "Abspielen",
  "Pausieren",
  "Einpassen",
  "Baumliste",
  "Richtig",
  "Falsch",
  "Wiederholung",
  "Bühne",
  "Inhaber",
  "Betrachter"
];

function renderEn(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
  );
}

/** Sichtbarer Text und Attribute, ohne die Inhalte, die als Demodaten gelten. */
function expectNoGerman(html: string, allowed: readonly string[] = []) {
  let text = html;
  for (const a of allowed) text = text.split(a).join("");
  for (const word of GERMAN_WORDS) expect(text, word).not.toContain(word);
}

function stateMachine(state: string): PodcastStateMachine {
  const ctx = {
    state,
    previousState: "idle",
    currentTimeMs: 15000,
    pausedAtMs: 15000,
    durationMs: 120000,
    trackUrl: "",
    interjectInputMode: null,
    currentQuestion: null,
    currentHostAnswer: null,
    hostAnswerDurationMs: 0,
    volume: 1,
    fadeStepMs: 40
  } as unknown as PodcastStateMachineContext;
  return {
    getContext: () => ({ ...ctx }),
    getState: () => ctx.state,
    subscribe: () => () => {},
    dispatch: () => true,
    fadeOut: async () => {},
    fadeIn: async () => {}
  } as unknown as PodcastStateMachine;
}

const STORYBOARD = {
  id: "vs",
  notebookId: "nb",
  title: "Demo video",
  durationMs: 10000,
  resolution: { width: 640, height: 360 },
  slides: [
    {
      id: "s1",
      startTimeMs: 0,
      endTimeMs: 10000,
      title: "Slide one",
      bulletPoints: ["Point"],
      visualTheme: {
        backgroundGradient: ["#000000", "#111111"],
        textColor: "#fff",
        accentColor: "#0ff"
      },
      audioDescription: "Described",
      citations: [{ sourceTitle: "Doc", quote: "Quote" }]
    }
  ],
  subtitles: [],
  chapters: [{ id: "c1", index: 0, title: "Intro", startTimeMs: 0, endTimeMs: 10000 }]
} as never;

describe("Englische Oberfläche der Bereiche und Werkzeuge", () => {
  const source = {
    id: "s1",
    title: "Demo source",
    originalName: "demo.md",
    mimeType: "text/markdown",
    byteSize: 2048
  } as never;

  it("Quellen", () => {
    const html = renderEn(createElement(SourcesPanel, { sources: [source] }));
    for (const text of [
      "Upload file",
      "Drop files here",
      "Filter sources …",
      "Select all sources",
      "1 source",
      "Selected sources feed into every answer."
    ]) {
      expect(html, text).toContain(text);
    }
    expectNoGerman(html);
    expect(renderEn(createElement(SourcesPanel, { sources: [] }))).toContain("0 sources");
  });

  it("Chat mit Vorschlagsfragen und eigenen Fragen", () => {
    const messages = [
      { id: "m1", role: "assistant", content: "Demo answer", modelUsed: "m" },
      { id: "m2", role: "assistant", content: "", isStreaming: true }
    ] as never;
    const html = renderEn(createElement(ChatPanel, { messages }));
    for (const text of [
      "Summarize the key findings",
      "Ask a question about your sources …",
      "Read aloud",
      "AI-generated · m",
      "Creating answer …"
    ]) {
      expect(html, text).toContain(text);
    }
    expectNoGerman(html);
    const custom = renderEn(createElement(ChatPanel, { messages, promptChips: ["Eigene Frage"] }));
    expect(custom).toContain("Eigene Frage");
    expect(custom).not.toContain("Summarize the key findings");
  });

  it("Studio", () => {
    const html = renderEn(createElement(StudioPanel, {}));
    for (const text of [
      "6 tools from your sources",
      "Listen",
      "Watch video",
      "Flashcards",
      "Export as Markdown"
    ]) {
      expect(html, text).toContain(text);
    }
    expectNoGerman(html);
  });

  it("Quiz und Lernkarten", () => {
    const quiz = renderEn(
      createElement(QuizViewer, {
        questions: [
          {
            id: "q",
            question: "Demo?",
            options: ["A", "B"],
            correctAnswerIndex: 0,
            explanation: "Demo explanation"
          }
        ]
      })
    );
    expect(quiz).toContain("Question 1 of 1");
    expect(quiz).toContain("Finish quiz");
    expectNoGerman(quiz);
    expect(renderEn(createElement(QuizViewer, { questions: [] }))).toContain(
      "Once sources are selected, questions with explanations and citations appear here."
    );

    const cards = renderEn(
      createElement(FlashcardsViewer, {
        cards: [{ id: "c", front: "Front text", back: "Back text" }]
      })
    );
    expect(cards).toContain("Card 1 of 1");
    expect(cards).toContain("Reveal answer");
    expect(cards).toContain("Next review: today · 0 repetitions");
    expectNoGerman(cards);
    expect(renderEn(createElement(FlashcardsViewer, { cards: [] }))).toContain(
      "Once sources are selected, cards for review appear here."
    );
  });

  it("Mindmap, Video, Audio, Bühne und Transkript", () => {
    const mindmap = renderEn(
      createElement(MindmapViewer, { rootNode: { id: "r", label: "Root", children: [] } })
    );
    expect(mindmap).toContain("Tree list");
    expectNoGerman(mindmap);

    const video = renderEn(createElement(VideoOverviewPlayer, { storyboard: STORYBOARD }));
    expect(video).toContain("Play");
    expect(video).toContain("Source: “Doc” – “Quote”");
    expectNoGerman(video, ['lang="de"']);

    const audio = renderEn(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb",
        stateMachine: stateMachine("paused")
      })
    );
    expect(audio).toContain("Status: Paused");
    expect(audio).toContain("Join / ask a question");
    expectNoGerman(audio);

    const interject = renderEn(
      createElement(InteractiveAudioHostPlayer, {
        notebookId: "nb",
        stateMachine: stateMachine("interjecting")
      })
    );
    expect(interject).toContain("Ask the podcast hosts a question");
    expect(interject).toContain("minute 0:15");
    expectNoGerman(interject);

    const stage = renderEn(
      createElement(DeepDiveStage, {
        isOpen: true,
        onClose: () => {},
        transcriptLines: []
      })
    );
    expect(stage).toContain("Join / ask the hosts a question");
    expectNoGerman(stage);

    const lyrics = renderEn(createElement(LiveLyrics, { lines: [], currentTimeMs: 0 }));
    expect(lyrics).toContain("Live transcript and lyrics");
  });
});
