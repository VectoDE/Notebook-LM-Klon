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
import { Icon, type IconName } from "./Icon.js";
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

interface StudioAction {
  readonly label: string;
  readonly testId: string;
  readonly run: () => void;
}

interface StudioToolEntry {
  readonly id: Exclude<StudioTool, "overview">;
  readonly icon: IconName;
  readonly title: string;
  readonly description: string;
  readonly primary: StudioAction;
  readonly secondary?:
    | (StudioAction & { readonly ariaLabel: string; readonly icon: IconName })
    | undefined;
}

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

  // Werkzeugliste: eine Quelle für Symbol, Titel, Beschreibung und Aktionen
  const tools: readonly StudioToolEntry[] = [
    {
      id: "audio",
      icon: "audio",
      title: "Audio-Overview",
      description: "Zwei-Sprecher-Podcast mit interaktiver Host-Zwischenfrage.",
      primary: {
        label: "Player öffnen",
        testId: "btn-open-audio-tool",
        run: () => selectTool("audio")
      },
      secondary: {
        label: "Bühne",
        ariaLabel: "Bühne im Vollbild öffnen (Deep Dive)",
        icon: "stage",
        testId: "btn-open-deep-dive-stage",
        run: () => setIsDeepDiveOpen(true)
      }
    },
    {
      id: "video",
      icon: "video",
      title: "Video-Overview",
      description: "Animierte Folien, Diagramme und WebM-Videoexport.",
      primary: {
        label: "Video ansehen",
        testId: "btn-open-video-tool",
        run: () => selectTool("video")
      }
    },
    {
      id: "mindmap",
      icon: "mindmap",
      title: "Wissens-Mindmap",
      description: "Interaktiver hierarchischer Wissensbaum mit SVG-Export.",
      primary: {
        label: "Erkunden",
        testId: "btn-open-mindmap-tool",
        run: () => selectTool("mindmap")
      },
      secondary: {
        label: "SVG",
        ariaLabel: "SVG exportieren (Mindmap)",
        icon: "download",
        testId: "btn-export-mindmap-svg",
        run: () => handleExport("mindmap")
      }
    },
    {
      id: "flashcards",
      icon: "cards",
      title: "Lernkarten",
      description: "Spaced-Repetition-Karten (SM-2) mit Anki-CSV-Export.",
      primary: {
        label: "Lernen",
        testId: "btn-open-flashcards-tool",
        run: () => selectTool("flashcards")
      },
      secondary: {
        label: "Anki",
        ariaLabel: "Anki-CSV exportieren (Lernkarten)",
        icon: "download",
        testId: "btn-export-anki-csv",
        run: () => handleExport("anki")
      }
    },
    {
      id: "quiz",
      icon: "quiz",
      title: "Interaktives Quiz",
      description: "Multiple-Choice-Test mit quellenbelegten Erklärungen.",
      primary: { label: "Starten", testId: "btn-open-quiz-tool", run: () => selectTool("quiz") },
      secondary: {
        label: "JSON",
        ariaLabel: "JSON exportieren (Quiz)",
        icon: "download",
        testId: "btn-export-quiz-md",
        run: () => handleExport("quiz")
      }
    },
    {
      id: "briefing",
      icon: "briefing",
      title: "Briefing & Timeline",
      description: "Management-Zusammenfassung, FAQ und Meilensteine.",
      primary: {
        label: "Als Markdown exportieren",
        testId: "btn-export-briefing-md",
        run: () => handleExport("briefing")
      }
    }
  ];

  return (
    <section
      aria-label="Studio-Panel"
      className="studio-panel rn-panel-body"
      data-testid="studio-panel"
    >
      <header className="rn-panel-head">
        <div className="rn-panel-heading">
          <h2>Studio</h2>
          {/* In einer Werkzeugansicht trägt deren eigener Kopf den Notebook-Titel */}
          {currentTool === "overview" && (
            <p className="rn-panel-sub">{`${tools.length} Werkzeuge aus Ihren Quellen`}</p>
          )}
        </div>
        {currentTool !== "overview" && (
          <button
            type="button"
            onClick={() => selectTool("overview")}
            data-testid="btn-back-to-studio-overview"
            className="rn-btn rn-btn--ghost rn-btn--compact"
          >
            <Icon name="back" size={18} />
            Alle Werkzeuge
          </button>
        )}
      </header>

      {/* Werkzeugansicht: Schlüssel je Werkzeug, damit die Einblendung bei jedem Wechsel läuft */}
      <div
        key={currentTool}
        data-testid="studio-tool-view"
        className="rn-cinema-enter rn-tool-view"
      >
        {currentTool === "overview" && (
          <ul data-testid="studio-tools-grid" className="rn-tools" aria-label="Studio-Werkzeuge">
            {tools.map((tool) => (
              <li key={tool.id}>
                <article data-testid={`tool-card-${tool.id}`} className="rn-tool">
                  <span className="rn-tool-tile">
                    <Icon name={tool.icon} size={22} />
                  </span>
                  <div className="rn-tool-text">
                    <h3 className="rn-tool-title">{tool.title}</h3>
                    <p className="rn-tool-desc">{tool.description}</p>
                  </div>
                  <div className="rn-tool-actions">
                    <button
                      type="button"
                      onClick={tool.primary.run}
                      data-testid={tool.primary.testId}
                      className="rn-btn rn-btn--primary rn-tool-primary"
                    >
                      {tool.primary.label}
                    </button>
                    {tool.secondary && (
                      <button
                        type="button"
                        onClick={tool.secondary.run}
                        data-testid={tool.secondary.testId}
                        aria-label={tool.secondary.ariaLabel}
                        className="rn-btn rn-btn--secondary"
                      >
                        <Icon name={tool.secondary.icon} size={18} />
                        {tool.secondary.label}
                      </button>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
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
        // Nach "Frage stellen" ist der Bühnen-Knopf weg; der Fokus geht an den Audio-Player
        returnFocusFallback={() =>
          document.querySelector<HTMLElement>('[data-testid="btn-audio-interject"]')
        }
      />
    </section>
  );
}
