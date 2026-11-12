import type {
  FlashcardItem,
  MindmapNode,
  PodcastStateMachine,
  QuizQuestion,
  VideoStoryboard
} from "@notebook-lm/shared";
import { type ReactNode, useEffect, useState } from "react";
import { DeepDiveStage } from "./DeepDiveStage.js";
import { FlashcardsViewer } from "./FlashcardsViewer.js";
import { Icon, type IconName } from "./Icon.js";
import { InteractiveAudioHostPlayer } from "./InteractiveAudioHostPlayer.js";
import { MindmapViewer } from "./MindmapViewer.js";
import { QuizViewer } from "./QuizViewer.js";
import { VideoOverviewPlayer } from "./VideoOverviewPlayer.js";
import {
  escapeHtmlText,
  exportBriefingToMarkdown,
  exportFlashcardsToAnkiCsv,
  exportMindmapToSvgString,
  exportQuizToJson,
  triggerBrowserDownload
} from "./artifact-exporters.js";
import { useTheme } from "./useTheme.js";
import type { CitationLocation, PanelFocusAttributes } from "./workspace-types.js";

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
  /** graph öffnet den Wissensgraphen außerhalb des Studios (Issue #327). */
  readonly id: Exclude<StudioTool, "overview"> | "graph";
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
  /**
   * Sprache je Artefakt (BCP 47), für lang bei abweichender Oberfläche (Issue #323).
   * sources gilt für Quellenhinweise in den Lernkarten.
   */
  readonly contentLangs?:
    | {
        readonly mindmap?: string | undefined;
        readonly flashcards?: string | undefined;
        readonly quiz?: string | undefined;
        readonly sources?: string | undefined;
      }
    | undefined;
  /** Fokusziel für die Bereichsnavigation (data-panel, tabIndex). */
  readonly panelAttributes?: PanelFocusAttributes | undefined;
  /** Bedienelement am Spaltenrand im Kopf, z. B. der Knopf zum Einklappen (Issue #325). */
  readonly headerAction?: ReactNode | undefined;
  /**
   * Werkzeug von außen öffnen (Symbolleiste der eingeklappten Spalte). Jede neue Anfrage
   * (neues Objekt) wählt das Werkzeug, auch wenn es dasselbe ist.
   */
  readonly toolRequest?: { readonly tool: StudioTool } | undefined;
  /**
   * Wissensgraph öffnen (Issue #327). Er liegt nicht im Studio, sondern in der mittleren
   * Spalte bzw. im Reiter „Graph“; ohne diese Funktion fehlt der Eintrag.
   */
  readonly onOpenGraph?: (() => void) | undefined;
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
  audioStateMachine,
  contentLangs,
  panelAttributes,
  headerAction,
  toolRequest,
  onOpenGraph
}: StudioPanelProps) {
  const { t, tf } = useTheme();
  const [currentTool, setCurrentTool] = useState<StudioTool>(activeTool);
  const [isDeepDiveOpen, setIsDeepDiveOpen] = useState(false);

  useEffect(() => {
    if (toolRequest) setCurrentTool(toolRequest.tool);
  }, [toolRequest]);

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
        // Der Titel ist frei bearbeitbar: als reiner Text in die Markdown-Datei
        escapeHtmlText(notebookTitle)
      );
      triggerBrowserDownload(result.filename, result.content, result.mimeType);
    }
  };

  // Werkzeugliste: eine Quelle für Symbol, Titel, Beschreibung und Aktionen
  const tools: readonly StudioToolEntry[] = [
    {
      id: "audio",
      icon: "audio",
      title: t("studioAudioCard"),
      description: t("toolAudioDesc"),
      primary: {
        label: t("studioAudioOpen"),
        testId: "btn-open-audio-tool",
        run: () => selectTool("audio")
      },
      secondary: {
        label: t("toolStage"),
        ariaLabel: t("toolStageAria"),
        icon: "stage",
        testId: "btn-open-deep-dive-stage",
        run: () => setIsDeepDiveOpen(true)
      }
    },
    {
      id: "video",
      icon: "video",
      title: t("studioVideoCard"),
      description: t("studioVideoDesc"),
      primary: {
        label: t("toolVideoOpen"),
        testId: "btn-open-video-tool",
        run: () => selectTool("video")
      }
    },
    {
      id: "mindmap",
      icon: "mindmap",
      title: t("toolMindmapTitle"),
      description: t("toolMindmapDesc"),
      primary: {
        label: t("toolMindmapOpen"),
        testId: "btn-open-mindmap-tool",
        run: () => selectTool("mindmap")
      },
      secondary: {
        label: t("toolMindmapExport"),
        ariaLabel: t("toolMindmapExportAria"),
        icon: "download",
        testId: "btn-export-mindmap-svg",
        run: () => handleExport("mindmap")
      }
    },
    ...(onOpenGraph
      ? [
          {
            id: "graph",
            icon: "graph",
            title: t("toolGraphTitle"),
            description: t("toolGraphDesc"),
            primary: {
              label: t("toolGraphOpen"),
              testId: "btn-open-graph-tool",
              run: onOpenGraph
            }
          } satisfies StudioToolEntry
        ]
      : []),
    {
      id: "flashcards",
      icon: "cards",
      title: t("toolCardsTitle"),
      description: t("studioFlashcardsDesc"),
      primary: {
        label: t("toolCardsOpen"),
        testId: "btn-open-flashcards-tool",
        run: () => selectTool("flashcards")
      },
      secondary: {
        label: t("toolCardsExport"),
        ariaLabel: t("toolCardsExportAria"),
        icon: "download",
        testId: "btn-export-anki-csv",
        run: () => handleExport("anki")
      }
    },
    {
      id: "quiz",
      icon: "quiz",
      title: t("toolQuizTitle"),
      description: t("toolQuizDesc"),
      primary: {
        label: t("toolQuizOpen"),
        testId: "btn-open-quiz-tool",
        run: () => selectTool("quiz")
      },
      secondary: {
        label: t("toolQuizExport"),
        ariaLabel: t("toolQuizExportAria"),
        icon: "download",
        testId: "btn-export-quiz-md",
        run: () => handleExport("quiz")
      }
    },
    {
      id: "briefing",
      icon: "briefing",
      title: t("toolBriefingTitle"),
      description: t("toolBriefingDesc"),
      primary: {
        label: t("toolBriefingExport"),
        testId: "btn-export-briefing-md",
        run: () => handleExport("briefing")
      }
    }
  ];

  return (
    <section
      aria-label={t("studioPanelLabel")}
      className="studio-panel rn-panel-body"
      data-testid="studio-panel"
      {...panelAttributes}
    >
      <header className="rn-panel-head">
        {headerAction}
        <div className="rn-panel-heading">
          <h2>{t("studioTitle")}</h2>
          {/* In einer Werkzeugansicht trägt deren eigener Kopf den Notebook-Titel */}
          {currentTool === "overview" && (
            <p className="rn-panel-sub">{tf("studioSub", { n: tools.length })}</p>
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
            {t("studioBack")}
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
          <ul
            data-testid="studio-tools-grid"
            className="rn-tools"
            aria-label={t("studioToolsLabel")}
          >
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
            contentLang={contentLangs?.mindmap}
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
          <FlashcardsViewer
            cards={flashcardsData}
            title={notebookTitle}
            contentLang={contentLangs?.flashcards}
            sourceLang={contentLangs?.sources}
          />
        )}

        {/* Tool Viewer: Quiz */}
        {currentTool === "quiz" && quizData && (
          <QuizViewer questions={quizData} title={notebookTitle} contentLang={contentLangs?.quiz} />
        )}
      </div>

      {/* Deep-Dive Stage Overlay */}
      <DeepDiveStage
        isOpen={isDeepDiveOpen}
        onClose={() => setIsDeepDiveOpen(false)}
        notebookTitle={notebookTitle}
        stateMachine={audioStateMachine}
        onAskQuestion={() => {
          // Bühne zu, Audio-Player auf, Zwischenfrage sofort offen (#314)
          setIsDeepDiveOpen(false);
          selectTool("audio");
          audioStateMachine?.dispatch({ type: "JOIN_INTERJECT", inputMode: "text" });
        }}
        // Nach "Frage stellen" ist der Bühnen-Knopf weg; der Fokus geht ins Fragefeld
        returnFocusFallback={() =>
          document.querySelector<HTMLElement>(
            '#interject-question-input, [data-testid="btn-audio-interject"]'
          )
        }
      />
    </section>
  );
}
