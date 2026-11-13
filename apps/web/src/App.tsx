import {
  type FlashcardItem,
  type MindmapNode,
  type QuizQuestion,
  WORKSPACE_VERSION
} from "@notebook-lm/shared";
import type { FunctionComponent } from "react";
import { WorkspaceLayout } from "./WorkspaceLayout.js";
import {
  LazyFlashcardsViewer as FlashcardsViewer,
  LazyMindmapViewer as MindmapViewer,
  LazyQuizViewer as QuizViewer
} from "./lazy-viewers.js";

const DEFAULT_MINDMAP: MindmapNode = {
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

const DEFAULT_FLASHCARDS: FlashcardItem[] = [
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

const DEFAULT_QUIZ: QuizQuestion[] = [
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

export interface AppProps {
  readonly initialTool?: "overview" | "mindmap" | "flashcards" | "quiz" | undefined;
  readonly mode?: "legacy" | "workspace" | undefined;
}

export const App: FunctionComponent<AppProps> = ({
  initialTool = "overview",
  mode = "legacy"
}: AppProps = {}) => {
  if (mode === "workspace") {
    // WorkspaceLayout bringt Kopfzeile (banner) und main selbst mit
    return <WorkspaceLayout initialTool={initialTool} />;
  }

  const currentTool = initialTool;

  return (
    <main aria-labelledby="app-title">
      <header>
        <h1 id="app-title">RelationNotes – NotebookLM &amp; RelationFlow Knowledge Studio</h1>
        <p>
          Version {WORKSPACE_VERSION} – Bereit für Forschung, Quellenanalyse, Wissengraphen und
          Studio-Synthese.
        </p>

        {/* Studio Tools Navigation */}
        <nav
          aria-label="Studio Werkzeuge"
          style={{ display: "flex", gap: "8px", margin: "16px 0" }}
        >
          <a
            href="#overview"
            aria-current={currentTool === "overview" ? "page" : undefined}
            style={{ minHeight: "44px", padding: "10px 12px", textDecoration: "none" }}
          >
            Übersicht
          </a>
          <a
            href="#mindmap"
            aria-current={currentTool === "mindmap" ? "page" : undefined}
            style={{ minHeight: "44px", padding: "10px 12px", textDecoration: "none" }}
          >
            Mindmap
          </a>
          <a
            href="#flashcards"
            aria-current={currentTool === "flashcards" ? "page" : undefined}
            style={{ minHeight: "44px", padding: "10px 12px", textDecoration: "none" }}
          >
            Lernkarten
          </a>
          <a
            href="#quiz"
            aria-current={currentTool === "quiz" ? "page" : undefined}
            style={{ minHeight: "44px", padding: "10px 12px", textDecoration: "none" }}
          >
            Quiz
          </a>
        </nav>
      </header>

      {currentTool === "mindmap" && (
        <MindmapViewer rootNode={DEFAULT_MINDMAP} title="Studio: Wissens-Mindmap" />
      )}
      {currentTool === "flashcards" && (
        <FlashcardsViewer cards={DEFAULT_FLASHCARDS} title="Studio: Spaced-Repetition Lernkarten" />
      )}
      {currentTool === "quiz" && (
        <QuizViewer questions={DEFAULT_QUIZ} title="Studio: Interaktives Quiz" />
      )}
    </main>
  );
};
