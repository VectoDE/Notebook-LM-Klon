import type {
  FlashcardItem,
  MindmapNode,
  QuizQuestion,
  VideoStoryboard
} from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeepDiveStage } from "../DeepDiveStage.js";
import { StudioPanel } from "../StudioPanel.js";

const MOCK_MINDMAP: MindmapNode = {
  id: "mm_1",
  label: "Cloud Architecture",
  children: [{ id: "mm_c1", label: "Worker Edge" }]
};

const MOCK_FLASHCARDS: FlashcardItem[] = [
  {
    id: "fc_1",
    front: "Was ist FTS5?",
    back: "SQLite Volltextsuche mit BM25."
  }
];

const MOCK_QUIZ: QuizQuestion[] = [
  {
    id: "qz_1",
    question: "Welche SQLite Engine nutzt D1?",
    options: ["SQLite 3", "PostgreSQL", "MySQL"],
    correctAnswerIndex: 0,
    explanation: "D1 basiert auf SQLite 3."
  }
];

const MOCK_VIDEO_STORYBOARD: VideoStoryboard = {
  id: "vs_1",
  notebookId: "nb_1",
  title: "Cloud Video Overview",
  durationMs: 20000,
  aspectRatio: "16:9",
  fps: 60,
  resolution: { width: 1280, height: 720 },
  chapters: [
    {
      id: "ch_1",
      index: 0,
      title: "Intro",
      startTimeMs: 0,
      endTimeMs: 20000,
      slideIds: ["sl_1"]
    }
  ],
  slides: [
    {
      id: "sl_1",
      chapterIndex: 0,
      startTimeMs: 0,
      endTimeMs: 20000,
      durationMs: 20000,
      title: "Slide 1",
      bulletPoints: ["Point A", "Point B"],
      spokenNarration: "Intro Folie.",
      visualTheme: {
        backgroundGradient: ["#000000", "#111111"],
        textColor: "#ffffff",
        accentColor: "#38bdf8"
      },
      audioDescription: "Intro",
      citations: []
    }
  ],
  subtitlesVtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:20.000\nIntro",
  subtitles: [{ id: "sub_1", startTimeMs: 0, endTimeMs: 20000, text: "Intro" }],
  audioDescriptionTrack: [
    { slideId: "sl_1", startTimeMs: 0, endTimeMs: 20000, description: "Intro" }
  ]
};

describe("StudioPanel & DeepDiveStage (Sub-Issue #133)", () => {
  it("renders 6 studio tool cards in overview mode", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        notebookTitle: "Test Studio Notebook",
        activeTool: "overview",
        mindmapData: MOCK_MINDMAP,
        flashcardsData: MOCK_FLASHCARDS,
        quizData: MOCK_QUIZ,
        videoStoryboard: MOCK_VIDEO_STORYBOARD
      })
    );

    expect(html).toContain('aria-label="Studio-Panel"');
    expect(html).toContain("studio-tools-grid");
    expect(html).toContain("tool-card-audio");
    expect(html).toContain("tool-card-video");
    expect(html).toContain("tool-card-mindmap");
    expect(html).toContain("tool-card-flashcards");
    expect(html).toContain("tool-card-quiz");
    expect(html).toContain("tool-card-briefing");
    expect(html).toContain("btn-export-mindmap-svg");
    expect(html).toContain("btn-export-anki-csv");
    expect(html).toContain("btn-export-quiz-md");
    expect(html).toContain("btn-export-briefing-md");
  });

  it("renders active Mindmap tool view", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        notebookTitle: "Test Studio Notebook",
        activeTool: "mindmap",
        mindmapData: MOCK_MINDMAP
      })
    );

    expect(html).toContain("btn-back-to-studio-overview");
    expect(html).toContain("Cloud Architecture");
  });

  it("renders active Flashcards tool view", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        notebookTitle: "Test Studio Notebook",
        activeTool: "flashcards",
        flashcardsData: MOCK_FLASHCARDS
      })
    );

    expect(html).toContain("Was ist FTS5?");
  });

  it("renders active Quiz tool view", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        notebookTitle: "Test Studio Notebook",
        activeTool: "quiz",
        quizData: MOCK_QUIZ
      })
    );

    expect(html).toContain("Welche SQLite Engine nutzt D1?");
  });

  it("renders active Video tool view", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        notebookTitle: "Test Studio Notebook",
        activeTool: "video",
        videoStoryboard: MOCK_VIDEO_STORYBOARD
      })
    );

    expect(html).toContain("video-overview-player");
    expect(html).toContain("slide-canvas");
  });

  it("renders DeepDiveStage modal when isOpen is true", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, {
        isOpen: true,
        onClose: () => {},
        notebookTitle: "Deep Dive Session"
      })
    );

    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="deep-dive-stage-title"');
    expect(html).toContain("Deep Dive Session");
    expect(html).toContain("aurora-orb-container");
    expect(html).toContain("live-lyrics-container");
    expect(html).toContain("btn-deep-dive-interject");
  });

  it("renders nothing for DeepDiveStage when isOpen is false", () => {
    const html = renderToStaticMarkup(
      createElement(DeepDiveStage, {
        isOpen: false,
        onClose: () => {}
      })
    );
    expect(html).toBe("");
  });
});
