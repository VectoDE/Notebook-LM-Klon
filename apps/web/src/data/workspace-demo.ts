import type {
  FlashcardItem,
  MindmapNode,
  QuizQuestion,
  VideoStoryboard
} from "@notebook-lm/shared";
import type { WorkspaceSource } from "@/types/workspace-types.js";
import type { StructuredData } from "./structured-demo.js";

export const DEFAULT_MINDMAP: MindmapNode = {
  id: "cf_root",
  label: "Cloudflare Edge Stack",
  children: [
    {
      id: "cf_compute",
      label: "Compute",
      sourceCitation: "Architecture 1.1",
      children: [
        { id: "cf_c1", label: "Single Worker (Hono)" },
        { id: "cf_c2", label: "NotebookDO (In-Memory Vectors)" }
      ]
    },
    {
      id: "cf_storage",
      label: "Storage & RAG",
      sourceCitation: "Architecture 2.0",
      children: [
        { id: "cf_s1", label: "D1 SQLite Relational" },
        { id: "cf_s2", label: "int8 Quantized Vectors" }
      ]
    }
  ]
};

export const DEFAULT_FLASHCARDS: FlashcardItem[] = [
  {
    id: "fc_demo_1",
    front: "Was bewirkt die WebSocket Hibernation API in Durable Objects?",
    back: "Ermöglicht es Durable Objects, bei inaktiven WebSockets aus dem Speicher entladen zu werden, ohne Verbindungen zu trennen. Reduziert Kosten drastisch.",
    sourceHint: "Cloudflare Single Worker & Hibernating Durable Objects"
  },
  {
    id: "fc_demo_2",
    front: "Wie viel Speicher spart int8-Skalarquantisierung gegenüber float32?",
    back: "Genau 75% (1 Byte statt 4 Bytes pro Dimension, 768 Bytes statt 3072 Bytes bei 768 Dimensionen).",
    sourceHint: "D1 int8 Vektoren & FTS5 Hybrid Search mit RRF"
  }
];

export const DEFAULT_QUIZ: QuizQuestion[] = [
  {
    id: "qc_demo_1",
    question: "Welcher SQLite-Mechanismus wird in D1 für die Volltextsuche verwendet?",
    options: ["fts3", "FTS5 mit BM25", "RegEx Match", "LIKE '%query%'"],
    correctAnswerIndex: 1,
    explanation: "D1 nutzt die FTS5 Virtual Table mit BM25-Ranking und automatischen Triggern.",
    sourceCitation: "D1 Migration 0002"
  },
  {
    id: "qc_demo_2",
    question:
      "Welche Mindestgröße müssen barrierefreie Touch-Ziele nach WCAG 2.5.5 (AAA) aufweisen?",
    options: ["24x24px", "32x32px", "44x44px", "48x48px"],
    correctAnswerIndex: 2,
    explanation: "WCAG 2.5.5 Target Size (Enhanced) fordert mindestens 44x44 CSS-Pixel.",
    sourceCitation: "WCAG 2.2 AAA Leitfaden"
  }
];

/** Demo-Beziehungsgraph (Issue #238), erst beim Umschalten geladen. */
export const loadDemoEntityGraph = () =>
  import("@/lib/graph/entity-graph-view.js").then((m) => m.DEMO_ENTITY_GRAPH);

export const DEFAULT_SOURCES: WorkspaceSource[] = [
  {
    id: "src_1",
    title: "Cloudflare Worker & DO Architecture",
    originalName: "architecture.md",
    mimeType: "text/markdown",
    byteSize: 24500,
    chunksCount: 8,
    isSelected: true,
    rawText:
      "# Architecture Overview\n\nCloudflare Worker serves as the single unified entry point. In-Memory vectors are managed inside NotebookDO with int8 quantization.",
    lang: "en"
  },
  {
    id: "src_2",
    title: "D1 SQLite Relational & FTS5 Hybrid Search",
    originalName: "database-spec.pdf",
    mimeType: "application/pdf",
    byteSize: 112000,
    chunksCount: 14,
    isSelected: true,
    rawText:
      "D1 Migration 0002 introduces FTS5 tables with BM25 ranking for hybrid lexical and vector search.",
    lang: "en"
  }
];

/**
 * Timeline, Datentabelle und Infografik der Demo, geprüft gegen die Demo-Quellen (Issue #239).
 * Die Prüfung braucht zod; sie läuft deshalb nach dem ersten Rendern aus einem eigenen Block.
 */
export const loadStructuredDemo = (): Promise<StructuredData> =>
  import("./structured-demo.js").then((m) => m.buildStructuredDemo(DEFAULT_SOURCES));

/**
 * Sprache der Demo-Inhalte (Issue #323): Zusammenfassung, Lernkarten und Quiz sind deutsch,
 * Quellentitel und Mindmap-Begriffe englisch. So bekommen sie in der jeweils anderen
 * Oberflächensprache ein lang-Attribut (WCAG 3.1.2). Der Notebook-Titel gilt als Name.
 */
export const DEFAULT_CONTENT_LANGS = {
  summary: "de",
  mindmap: "en",
  flashcards: "de",
  quiz: "de",
  sources: "en"
} as const;

export const DEFAULT_VIDEO_STORYBOARD: VideoStoryboard = {
  id: "vs_demo",
  notebookId: "nb_demo",
  title: "Cloudflare Edge Stack Video Overview",
  durationMs: 30000,
  aspectRatio: "16:9",
  fps: 60,
  resolution: { width: 1280, height: 720 },
  chapters: [
    {
      id: "ch_1",
      index: 0,
      title: "Einführung",
      startTimeMs: 0,
      endTimeMs: 15000,
      slideIds: ["sl_1"]
    },
    {
      id: "ch_2",
      index: 1,
      title: "Edge & Vektoren",
      startTimeMs: 15000,
      endTimeMs: 30000,
      slideIds: ["sl_2"]
    }
  ],
  slides: [
    {
      id: "sl_1",
      chapterIndex: 0,
      startTimeMs: 0,
      endTimeMs: 15000,
      durationMs: 15000,
      title: "Cloudflare Edge Stack",
      subtitle: "Architektur & Performance",
      bulletPoints: ["Single Worker Hono", "NotebookDO SQLite", "0ms Cold Starts"],
      spokenNarration: "Cloudflare Worker dient als einheitlicher Einstiegspunkt.",
      visualTheme: {
        backgroundGradient: ["#0f172a", "#1e293b"],
        textColor: "#ffffff",
        accentColor: "#38bdf8"
      },
      audioDescription: "Titel-Folie mit Cloudflare Edge Stack Überblick.",
      citations: []
    },
    {
      id: "sl_2",
      chapterIndex: 1,
      startTimeMs: 15000,
      endTimeMs: 30000,
      durationMs: 15000,
      title: "int8 Vektoren & FTS5",
      subtitle: "Hybrid Search",
      bulletPoints: ["75% RAM Ersparnis", "BM25 Ranking", "RRF Fusion"],
      spokenNarration: "int8 Quantisierung spart 75 Prozent Speicherplatz bei hoher Genauigkeit.",
      visualTheme: {
        backgroundGradient: ["#022c22", "#064e3b"],
        textColor: "#ffffff",
        accentColor: "#34d399"
      },
      audioDescription: "Folie zu int8 Quantisierung und Hybrid Search.",
      citations: []
    }
  ],
  subtitlesVtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:15.000\nCloudflare Worker",
  subtitles: [
    { id: "sub_1", startTimeMs: 0, endTimeMs: 15000, text: "Cloudflare Worker" },
    { id: "sub_2", startTimeMs: 15000, endTimeMs: 30000, text: "int8 Quantisierung" }
  ],
  audioDescriptionTrack: [
    { slideId: "sl_1", startTimeMs: 0, endTimeMs: 15000, description: "Titel-Folie" },
    { slideId: "sl_2", startTimeMs: 15000, endTimeMs: 30000, description: "int8-Folie" }
  ]
};

/** Standardtitel des Demo-Notebooks, bis er umbenannt wird. */
export const DEFAULT_NOTEBOOK_TITLE = "Cloudflare Edge Stack Architecture";
