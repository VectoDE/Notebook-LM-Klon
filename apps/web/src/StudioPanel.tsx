import type {
  FlashcardItem,
  MindmapNode,
  PodcastStateMachine,
  QuizQuestion,
  VideoStoryboard
} from "@notebook-lm/shared";
import { useState } from "react";
import { DeepDiveStage } from "./DeepDiveStage.js";
import { FlashcardsViewer } from "./FlashcardsViewer.js";
import { InteractiveAudioHostPlayer } from "./InteractiveAudioHostPlayer.js";
import { MindmapViewer } from "./MindmapViewer.js";
import { QuizViewer } from "./QuizViewer.js";
import { VideoOverviewPlayer } from "./VideoOverviewPlayer.js";
import {
  exportBriefingToMarkdown,
  exportFlashcardsToAnkiCsv,
  exportMindmapToSvgString,
  exportQuizToJson,
  triggerBrowserDownload
} from "./artifact-exporters.js";
import type { CitationLocation } from "./workspace-types.js";

export type StudioTool =
  | "overview"
  | "audio"
  | "video"
  | "mindmap"
  | "flashcards"
  | "quiz"
  | "briefing";

export interface StudioPanelProps {
  readonly notebookTitle?: string | undefined;
  readonly activeTool?: StudioTool | undefined;
  readonly onSelectTool?: ((tool: StudioTool) => void) | undefined;
  readonly onSourceJump?: ((citation: CitationLocation) => void) | undefined;
  readonly mindmapData?: MindmapNode | undefined;
  readonly flashcardsData?: readonly FlashcardItem[] | undefined;
  readonly quizData?: readonly QuizQuestion[] | undefined;
  readonly videoStoryboard?: VideoStoryboard | undefined;
  readonly audioStateMachine?: PodcastStateMachine | undefined;
}

export function StudioPanel({
  notebookTitle = "RelationNotes Studio",
  activeTool = "overview",
  onSelectTool,
  onSourceJump,
  mindmapData,
  flashcardsData,
  quizData,
  videoStoryboard,
  audioStateMachine
}: StudioPanelProps) {
  const [currentTool, setCurrentTool] = useState<StudioTool>(activeTool);
  const [isDeepDiveOpen, setIsDeepDiveOpen] = useState(false);

  const selectTool = (tool: StudioTool) => {
    setCurrentTool(tool);
    onSelectTool?.(tool);
  };

  const handleExport = (type: "anki" | "mindmap" | "quiz" | "briefing") => {
    if (type === "anki" && flashcardsData) {
      const result = exportFlashcardsToAnkiCsv(flashcardsData);
      triggerBrowserDownload(result.filename, result.content, result.mimeType);
    } else if (type === "mindmap" && mindmapData) {
      const svg = exportMindmapToSvgString(`<svg><text>${mindmapData.label}</text></svg>`);
      triggerBrowserDownload(`${notebookTitle}_mindmap.svg`, svg, "image/svg+xml");
    } else if (type === "quiz" && quizData) {
      const json = exportQuizToJson(quizData);
      triggerBrowserDownload(`${notebookTitle}_quiz.json`, json, "application/json");
    } else if (type === "briefing") {
      const result = exportBriefingToMarkdown(
        {
          executiveSummary: "Zusammenfassung des Notebooks.",
          keyTakeaways: ["Durable Objects", "D1 SQLite"],
          actionItems: ["Architektur umsetzen"]
        },
        notebookTitle
      );
      triggerBrowserDownload(result.filename, result.content, result.mimeType);
    }
  };

  return (
    <section
      aria-label="Studio-Panel"
      className="studio-panel"
      data-testid="studio-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        background: "var(--rn-color-panel)",
        color: "var(--rn-color-text-primary)",
        borderLeft: "1px solid var(--rn-color-border)",
        overflowY: "auto"
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px"
        }}
      >
        <h2 style={{ fontSize: "1.25rem", margin: 0, fontWeight: 700 }}>Studio</h2>
        {currentTool !== "overview" && (
          <button
            type="button"
            onClick={() => selectTool("overview")}
            data-testid="btn-back-to-studio-overview"
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: "1px solid var(--rn-color-border)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "0.875rem"
            }}
          >
            ← Alle Werkzeuge
          </button>
        )}
      </header>

      {/* Werkzeugansicht: Schlüssel je Werkzeug, damit die Einblendung (Cinema) bei jedem Wechsel läuft */}
      <div
        key={currentTool}
        data-testid="studio-tool-view"
        className="rn-cinema-enter"
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        {/* 6 Studio Cards Overview */}
        {currentTool === "overview" && (
          <div
            data-testid="studio-tools-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "12px",
              marginBottom: "20px"
            }}
          >
            {/* Card 1: Audio Overview */}
            <article
              data-testid="tool-card-audio"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Audio-Overview</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Zwei-Sprecher-Podcast mit interaktiver Host-Zwischenfrage.
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => selectTool("audio")}
                  data-testid="btn-open-audio-tool"
                  style={{
                    flex: 1,
                    minHeight: "36px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--rn-color-accent)",
                    color: "var(--rn-color-accent-text)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Player öffnen
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeepDiveOpen(true)}
                  data-testid="btn-open-deep-dive-stage"
                  aria-label="Deep-Dive-Bühne im Vollbild öffnen"
                  style={{
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border)",
                    background: "var(--rn-color-panel)",
                    fontSize: "0.875rem",
                    cursor: "pointer"
                  }}
                >
                  Cinema
                </button>
              </div>
            </article>

            {/* Card 2: Video Overview */}
            <article
              data-testid="tool-card-video"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Video-Overview</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Animierte Folien, Diagramme und WebM-Videoexport.
                </p>
              </div>
              <button
                type="button"
                onClick={() => selectTool("video")}
                data-testid="btn-open-video-tool"
                style={{
                  marginTop: "12px",
                  minHeight: "36px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--rn-color-accent)",
                  color: "var(--rn-color-accent-text)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Video ansehen
              </button>
            </article>

            {/* Card 3: Mindmap */}
            <article
              data-testid="tool-card-mindmap"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Wissens-Mindmap</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Interaktiver hierarchischer Wissensbaum mit SVG-Export.
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => selectTool("mindmap")}
                  data-testid="btn-open-mindmap-tool"
                  style={{
                    flex: 1,
                    minHeight: "36px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--rn-color-accent)",
                    color: "var(--rn-color-accent-text)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Erkunden
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("mindmap")}
                  data-testid="btn-export-mindmap-svg"
                  style={{
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border)",
                    background: "var(--rn-color-panel)",
                    fontSize: "0.875rem",
                    cursor: "pointer"
                  }}
                >
                  SVG
                </button>
              </div>
            </article>

            {/* Card 4: Flashcards */}
            <article
              data-testid="tool-card-flashcards"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Lernkarten</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Spaced-Repetition-Karten (SM-2) mit Anki-CSV-Export.
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => selectTool("flashcards")}
                  data-testid="btn-open-flashcards-tool"
                  style={{
                    flex: 1,
                    minHeight: "36px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--rn-color-accent)",
                    color: "var(--rn-color-accent-text)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Lernen
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("anki")}
                  data-testid="btn-export-anki-csv"
                  style={{
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border)",
                    background: "var(--rn-color-panel)",
                    fontSize: "0.875rem",
                    cursor: "pointer"
                  }}
                >
                  Anki
                </button>
              </div>
            </article>

            {/* Card 5: Quiz */}
            <article
              data-testid="tool-card-quiz"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Interaktives Quiz</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Multiple-Choice-Test mit quellenbelegten Erklärungen.
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => selectTool("quiz")}
                  data-testid="btn-open-quiz-tool"
                  style={{
                    flex: 1,
                    minHeight: "36px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--rn-color-accent)",
                    color: "var(--rn-color-accent-text)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Starten
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("quiz")}
                  data-testid="btn-export-quiz-md"
                  style={{
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border)",
                    background: "var(--rn-color-panel)",
                    fontSize: "0.875rem",
                    cursor: "pointer"
                  }}
                >
                  MD
                </button>
              </div>
            </article>

            {/* Card 6: Executive Briefing */}
            <article
              data-testid="tool-card-briefing"
              style={{
                padding: "14px",
                borderRadius: "12px",
                background: "var(--rn-color-surface-variant)",
                border: "1px solid var(--rn-color-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between"
              }}
            >
              <div>
                <h3 style={{ fontSize: "1rem", margin: "0 0 6px 0" }}>Briefing & Timeline</h3>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--rn-color-text-secondary)",
                    margin: 0
                  }}
                >
                  Management-Zusammenfassung, FAQ und Meilensteine.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleExport("briefing")}
                data-testid="btn-export-briefing-md"
                style={{
                  marginTop: "12px",
                  minHeight: "36px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--rn-color-accent)",
                  color: "var(--rn-color-accent-text)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Exportieren (MD)
              </button>
            </article>
          </div>
        )}

        {/* Tool Viewer: Audio */}
        {currentTool === "audio" && audioStateMachine && (
          <InteractiveAudioHostPlayer
            notebookId="nb_active"
            stateMachine={audioStateMachine}
            currentTrackTitle={notebookTitle}
          />
        )}

        {/* Tool Viewer: Video */}
        {currentTool === "video" && videoStoryboard && (
          <VideoOverviewPlayer storyboard={videoStoryboard} />
        )}

        {/* Tool Viewer: Mindmap */}
        {currentTool === "mindmap" && mindmapData && (
          <MindmapViewer
            rootNode={mindmapData}
            title={notebookTitle}
            onSourceJump={(src) =>
              onSourceJump?.({
                sourceId: src.sourceId ?? "src_1",
                chunkId: src.chunkId,
                quote: src.sourceCitation
              })
            }
          />
        )}

        {/* Tool Viewer: Flashcards */}
        {currentTool === "flashcards" && flashcardsData && (
          <FlashcardsViewer cards={flashcardsData} title={notebookTitle} />
        )}

        {/* Tool Viewer: Quiz */}
        {currentTool === "quiz" && quizData && (
          <QuizViewer questions={quizData} title={notebookTitle} />
        )}
      </div>

      {/* Deep-Dive Stage Overlay */}
      <DeepDiveStage
        isOpen={isDeepDiveOpen}
        onClose={() => setIsDeepDiveOpen(false)}
        notebookTitle={notebookTitle}
        stateMachine={audioStateMachine}
        onAskQuestion={() => {
          setIsDeepDiveOpen(false);
          selectTool("audio");
        }}
      />
    </section>
  );
}
