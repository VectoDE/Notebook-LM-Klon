import {
  type FlashcardItem,
  type MindmapNode,
  PodcastStateMachine,
  type QuizQuestion,
  type VideoStoryboard,
  WORKSPACE_VERSION
} from "@notebook-lm/shared";
import { type FunctionComponent, useCallback, useEffect, useRef, useState } from "react";
import { BrandLogo } from "./BrandLogo.js";
import { type ChatMessage, ChatPanel } from "./ChatPanel.js";
import { Icon, type IconName } from "./Icon.js";
import { SettingsDrawer } from "./SettingsDrawer.js";
import { SourcesPanel } from "./SourcesPanel.js";
import { StudioPanel, type StudioTool } from "./StudioPanel.js";
import { ChatApiError, mapCitations, streamChat } from "./chat-client.js";
import { type ColorMode, type DesignTheme, useTheme } from "./useTheme.js";
import type { CitationLocation, WorkspaceSource } from "./workspace-types.js";

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
      "# Architecture Overview\n\nCloudflare Worker serves as the single unified entry point. In-Memory vectors are managed inside NotebookDO with int8 quantization."
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
      "D1 Migration 0002 introduces FTS5 tables with BM25 ranking for hybrid lexical and vector search."
  }
];

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

export interface WorkspaceLayoutProps {
  readonly initialTool?: StudioTool | undefined;
  readonly initialPanelTab?: "sources" | "chat" | "studio" | undefined;
  readonly notebookId?: string | undefined;
  /** Test-Hook: ersetzt fetch fuer den Chat-Client. */
  readonly chatFetch?: typeof fetch | undefined;
}

/** Unter 600 px steht die Kopfzeile in zwei Zeilen; dort gelten Kurzbezeichnungen. */
const NARROW_HEADER_QUERY = "(max-width: 599.98px)";

/** Kurze, sprachneutrale Namen, damit die Auswahlfelder mobil nichts abschneiden. */
const SHORT_THEME_LABELS: Record<DesignTheme, string> = {
  pure: "Pure",
  "immersive-cinema": "Cinema",
  "editorial-calm": "Editorial",
  fusion: "Fusion"
};

type PanelTab = "sources" | "chat" | "studio";

/** Reiter der unteren Leiste: kurze sichtbare Namen, vollständige Namen für Screenreader. */
const MOBILE_TABS: readonly {
  readonly id: PanelTab;
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon: IconName;
}[] = [
  { id: "sources", label: "Quellen", ariaLabel: "Quellen", icon: "sources" },
  { id: "chat", label: "Chat", ariaLabel: "Chat & Zitate", icon: "chat" },
  { id: "studio", label: "Studio", ariaLabel: "Studio (6 Werkzeuge)", icon: "studio" }
];

/** Reagiert auf eine Media Query; ohne window (Server-Rendering) immer false. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches)
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function WorkspaceLayout({
  initialTool = "overview",
  initialPanelTab = "chat",
  notebookId = "nb_active",
  chatFetch
}: WorkspaceLayoutProps) {
  const { theme, setTheme, colorMode, setColorMode, t } = useTheme();
  const isNarrowHeader = useMediaQuery(NARROW_HEADER_QUERY);

  // Panels & Navigation state
  const [activeMobileTab, setActiveMobileTab] = useState<PanelTab>(initialPanelTab);
  const [sources, setSources] = useState<WorkspaceSource[]>(DEFAULT_SOURCES);
  const [activeCitation, setActiveCitation] = useState<CitationLocation | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeModel, setActiveModel] = useState("gemini-2.5-flash");
  const [userRole, setUserRole] = useState<"owner" | "editor" | "viewer">("owner");

  // Audio State Machine
  const [audioStateMachine] = useState<PodcastStateMachine>(() => new PodcastStateMachine());

  // Chat Messages
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_intro",
      role: "assistant",
      content:
        "Willkommen in Ihrem RelationNotes Arbeitsbereich. Ihre Quellen sind geladen. Sie können Zwischenfragen stellen oder die Studio-Werkzeuge rechts nutzen [1]."
    }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const chatIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string>("");

  // Laufende Anfrage beim Verlassen abbrechen
  useEffect(() => () => abortRef.current?.abort(), []);

  // Source selection toggles
  const handleToggleSelectSource = (id: string) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, isSelected: !s.isSelected } : s)));
  };

  const handleToggleSelectAllSources = (selected: boolean) => {
    setSources((prev) => prev.map((s) => ({ ...s, isSelected: selected })));
  };

  const handleUploadFiles = (files: readonly File[]) => {
    const newSources: WorkspaceSource[] = files.map((file, idx) => ({
      id: `src_up_${Date.now()}_${idx}`,
      title: file.name.replace(/\.[^/.]+$/, ""),
      originalName: file.name,
      mimeType: file.type || "text/plain",
      byteSize: file.size,
      chunksCount: 1,
      isSelected: true,
      rawText: `Inhalt von ${file.name}`
    }));
    setSources((prev) => [...prev, ...newSources]);
  };

  const handleImportUrl = (url: string, title?: string) => {
    const newSource: WorkspaceSource = {
      id: `src_url_${Date.now()}`,
      title: title || url,
      originalName: url,
      mimeType: "text/html",
      byteSize: 15000,
      chunksCount: 2,
      isSelected: true,
      rawText: `Importierter Inhalt von ${url}`
    };
    setSources((prev) => [...prev, newSource]);
  };

  // Citation Click -> Jump to Left Sources Panel
  const handleCitationClick = (citation: CitationLocation) => {
    setActiveCitation(citation);
    setActiveMobileTab("sources");
  };

  const updateMessage = useCallback((id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  const handleStopChat = () => {
    abortRef.current?.abort();
  };

  // Chat send message: SSE-Stream gegen /api/v1/notebooks/:id/chat
  const handleSendMessage = async (text: string, options?: { readonly isRetry?: boolean }) => {
    if (abortRef.current) return;
    lastPromptRef.current = text;
    const stamp = Date.now();
    const assistantId = `msg_a_${stamp}`;
    const controller = new AbortController();
    abortRef.current = controller;

    const retryBase = options?.isRetry
      ? (prev: ChatMessage[]) => prev.filter((m) => !m.error)
      : (prev: ChatMessage[]) => [
          ...prev,
          { id: `msg_u_${stamp}`, role: "user" as const, content: text }
        ];
    setMessages((prev) => [
      ...retryBase(prev),
      { id: assistantId, role: "assistant", content: "", isStreaming: true }
    ]);
    setIsGenerating(true);

    const selectedIds = sources.filter((s) => s.isSelected).map((s) => s.id);
    try {
      for await (const ev of streamChat({
        notebookId,
        message: text,
        chatId: chatIdRef.current,
        model: activeModel,
        sourceIds: selectedIds,
        signal: controller.signal,
        fetchImpl: chatFetch
      })) {
        if (ev.type === "token") {
          if (ev.chatId) chatIdRef.current = ev.chatId;
          updateMessage(assistantId, (m) => ({ ...m, content: m.content + ev.delta }));
        } else if (ev.type === "citations") {
          const citations = mapCitations(ev.citations);
          updateMessage(assistantId, (m) => ({ ...m, citations }));
        } else if (ev.type === "metadata") {
          updateMessage(assistantId, (m) => ({ ...m, modelUsed: ev.metadata.model }));
        } else if (ev.type === "done") {
          if (ev.chatId) chatIdRef.current = ev.chatId;
        } else if (ev.type === "error") {
          updateMessage(assistantId, (m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        updateMessage(assistantId, (m) => ({ ...m, aborted: true }));
      } else {
        const message =
          err instanceof ChatApiError ? err.message : "Unerwarteter Fehler beim Chat.";
        updateMessage(assistantId, (m) => ({ ...m, error: message }));
      }
    } finally {
      updateMessage(assistantId, (m) => ({ ...m, isStreaming: false }));
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleRetryChat = () => {
    if (lastPromptRef.current) void handleSendMessage(lastPromptRef.current, { isRetry: true });
  };

  return (
    <div className="workspace-shell" data-testid="workspace-shell">
      {/* Workspace Header: ein Bedienelement-System (gleiche Höhe, Schrift, Radius, Rand) */}
      <header data-testid="workspace-header" className="workspace-header">
        <div className="workspace-brand">
          <h1 id="app-title" className="workspace-title">
            <BrandLogo height={32} />
          </h1>
          <span className="workspace-version">v{WORKSPACE_VERSION}</span>
        </div>

        {/* Rolle: sichtbare Beschriftung im Feld, gemeinsame Grundlinie mit dem Wert */}
        <div className="workspace-role">
          <div className="rn-control">
            <label htmlFor="role-select" className="rn-control-lead workspace-role-label">
              Rolle
            </label>
            <select
              id="role-select"
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as "owner" | "editor" | "viewer")}
              data-testid="role-switcher-select"
              className="rn-control-input"
            >
              <option value="owner">{isNarrowHeader ? "Inhaber" : "Inhaber (Owner)"}</option>
              <option value="editor">
                {isNarrowHeader ? "Bearbeiter" : "Bearbeiter (Editor)"}
              </option>
              <option value="viewer">
                {isNarrowHeader ? "Betrachter" : "Betrachter (Viewer)"}
              </option>
            </select>
            <Icon name="chevron" size={16} className="rn-control-chevron" />
          </div>
        </div>

        {/* Design, Farbschema, Einstellungen */}
        <div className="workspace-actions">
          <div className="rn-control">
            <Icon name="palette" size={18} className="rn-control-lead rn-control-icon" />
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as DesignTheme)}
              data-testid="theme-selector-header"
              aria-label={t("themeLabel")}
              className="rn-control-input"
            >
              <option value="pure">
                {isNarrowHeader ? SHORT_THEME_LABELS.pure : t("themePure")}
              </option>
              <option value="immersive-cinema">
                {isNarrowHeader ? SHORT_THEME_LABELS["immersive-cinema"] : t("themeCinema")}
              </option>
              <option value="editorial-calm">
                {isNarrowHeader ? SHORT_THEME_LABELS["editorial-calm"] : t("themeEditorial")}
              </option>
              <option value="fusion">
                {isNarrowHeader ? SHORT_THEME_LABELS.fusion : t("themeFusion")}
              </option>
            </select>
            <Icon name="chevron" size={16} className="rn-control-chevron" />
          </div>

          {/* Farbschema: Hell, Dunkel, AAA-Hochkontrast */}
          <div className="rn-control">
            <Icon name="contrast" size={18} className="rn-control-lead rn-control-icon" />
            <select
              value={colorMode}
              onChange={(e) => setColorMode(e.target.value as ColorMode)}
              data-testid="color-mode-selector-header"
              aria-label={t("colorModeLabel")}
              className="rn-control-input"
            >
              <option value="light">{t("modeLight")}</option>
              <option value="dark">{t("modeDark")}</option>
              <option value="aaa-contrast">{isNarrowHeader ? "AAA" : t("modeAAA")}</option>
            </select>
            <Icon name="chevron" size={16} className="rn-control-chevron" />
          </div>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            data-testid="btn-open-settings"
            aria-label="Einstellungen & Compliance öffnen"
            className="rn-control rn-control--button workspace-settings-button"
          >
            <Icon name="settings" size={18} />
            {!isNarrowHeader && <span>Einstellungen</span>}
          </button>
        </div>
      </header>

      {/* Main 3-Panel Workspace Container */}
      <div id="workspace-main" data-testid="workspace-3panel-container" className="workspace-main">
        {/* Panel 1: Left Sources Panel */}
        <div
          data-testid="panel-left-wrapper"
          className={`workspace-panel panel-left ${activeMobileTab === "sources" ? "panel-active" : ""}`}
        >
          <SourcesPanel
            sources={sources}
            activeCitation={activeCitation}
            onToggleSelect={handleToggleSelectSource}
            onToggleSelectAll={handleToggleSelectAllSources}
            onUploadFiles={handleUploadFiles}
            onImportUrl={handleImportUrl}
            onClearActiveCitation={() => setActiveCitation(null)}
          />
        </div>

        {/* Panel 2: Center Citation Chat Panel */}
        <div
          data-testid="panel-center-wrapper"
          className={`workspace-panel panel-center ${activeMobileTab === "chat" ? "panel-active" : ""}`}
        >
          <ChatPanel
            notebookTitle="Cloudflare Edge Stack Architecture"
            notebookSummary="Dieses Notebook dokumentiert die vollständige Cloudflare Single-Worker- und In-Memory-Vektor-Architektur für latenzfreie Inferenz."
            messages={messages}
            activeModel={activeModel}
            onSendMessage={(text) => handleSendMessage(text)}
            onStop={handleStopChat}
            onRetry={handleRetryChat}
            onCitationClick={handleCitationClick}
            isGenerating={isGenerating}
          />
        </div>

        {/* Panel 3: Right Studio Panel */}
        <div
          data-testid="panel-right-wrapper"
          className={`workspace-panel panel-right ${activeMobileTab === "studio" ? "panel-active" : ""}`}
        >
          <StudioPanel
            notebookTitle="Cloudflare Edge Stack Architecture"
            activeTool={initialTool}
            mindmapData={DEFAULT_MINDMAP}
            flashcardsData={DEFAULT_FLASHCARDS}
            quizData={DEFAULT_QUIZ}
            videoStoryboard={DEFAULT_VIDEO_STORYBOARD}
            audioStateMachine={audioStateMachine}
            onSourceJump={handleCitationClick}
          />
        </div>
      </div>

      {/* Untere Reiterleiste (unter 900 px): im Daumenbereich, Symbol und Kurzname */}
      <nav
        aria-label="Mobile Arbeitsbereich Navigation"
        data-testid="mobile-bottom-nav"
        className="mobile-bottom-nav"
      >
        {MOBILE_TABS.map((tab) => {
          const isActive = activeMobileTab === tab.id;
          const isSources = tab.id === "sources";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveMobileTab(tab.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={isSources ? `Quellen (${sources.length})` : tab.ariaLabel}
              data-testid={`tab-btn-${tab.id}`}
              className="rn-tab"
            >
              <span className="rn-tab-indicator">
                <Icon name={tab.icon} size={22} />
                {isSources && <span className="rn-tab-count">{sources.length}</span>}
              </span>
              <span className="rn-tab-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Settings & Compliance Drawer Modal */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeModel={activeModel}
        onModelChange={(model) => setActiveModel(model)}
      />
    </div>
  );
}

export interface AppProps {
  readonly initialTool?: "overview" | "mindmap" | "flashcards" | "quiz" | undefined;
}

export const App: FunctionComponent<AppProps> = ({ initialTool = "overview" }: AppProps = {}) => {
  return (
    <main aria-labelledby="app-title">
      <WorkspaceLayout initialTool={initialTool} />
    </main>
  );
};
