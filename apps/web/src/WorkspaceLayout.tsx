import {
  type FlashcardItem,
  type MindmapNode,
  PodcastStateMachine,
  type QuizQuestion,
  type VideoStoryboard,
  WORKSPACE_VERSION
} from "@notebook-lm/shared";
import {
  type FunctionComponent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { AppearanceControls, type UserRole } from "./AppearanceControls.js";
import { BrandLogo } from "./BrandLogo.js";
import { type ChatMessage, ChatPanel } from "./ChatPanel.js";
import { Icon, type IconName } from "./Icon.js";
import { SettingsDrawer } from "./SettingsDrawer.js";
import { SourcesPanel } from "./SourcesPanel.js";
import { StudioPanel, type StudioTool } from "./StudioPanel.js";
import {
  ChatApiError,
  errorKeyForStatus,
  mapCitations,
  streamChat,
  technicalErrorDetail
} from "./chat-client.js";
import { FOCUSABLE_SELECTOR, trapTabKey } from "./focus-trap.js";
import { browserStorage, readStoredModel, storeModel } from "./theme-preferences.js";
import { useTheme } from "./useTheme.js";
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

/** Unter 600 px: Logo und Menü-Knopf oben, Reiterleiste unten. */
const NARROW_HEADER_QUERY = "(max-width: 599.98px)";

/** Unter 900 px ist nur ein Bereich sichtbar: die Navigation schaltet um (Reiterlogik). */
const SINGLE_PANEL_QUERY = "(max-width: 899.98px)";

/** Dauer der kurzen Markierung eines angesprungenen Bereichs (ab 900 px). */
const PANEL_FLASH_MS = 1200;

type PanelTab = "sources" | "chat" | "studio";

/**
 * Bereiche des Arbeitsbereichs: Schlüssel im Sprachkatalog für den kurzen Namen und den
 * vollen Namen für Screenreader (beginnt mit dem sichtbaren Namen).
 */
const PANEL_TABS: readonly {
  readonly id: PanelTab;
  readonly labelKey: string;
  readonly ariaKey: string;
  readonly icon: IconName;
}[] = [
  { id: "sources", labelKey: "navSources", ariaKey: "navSources", icon: "sources" },
  { id: "chat", labelKey: "navChat", ariaKey: "navChatAria", icon: "chat" },
  { id: "studio", labelKey: "navStudio", ariaKey: "navStudioAria", icon: "studio" }
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
  const isSinglePanel = useMediaQuery(SINGLE_PANEL_QUERY);

  // Panels & Navigation state
  const [activeMobileTab, setActiveMobileTab] = useState<PanelTab>(initialPanelTab);
  const [sources, setSources] = useState<WorkspaceSource[]>(DEFAULT_SOURCES);
  const [activeCitation, setActiveCitation] = useState<CitationLocation | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Modellwahl übersteht das Neuladen (nur bekannte Werte, Issue #319)
  const [activeModel, setActiveModel] = useState<string>(() => readStoredModel(browserStorage()));
  const [flashedPanel, setFlashedPanel] = useState<PanelTab | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Kurzinfos der Kopfknöpfe: Escape blendet sie aus, bis Zeiger oder Fokus den Knopf verlassen
  const [tipsHidden, setTipsHidden] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>("owner");
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const appearanceAnchorRef = useRef<HTMLDivElement>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const appearancePanelRef = useRef<HTMLDialogElement>(null);
  const appearanceOpenedByKeyboard = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);

  const appearanceProps = {
    role: userRole,
    onRoleChange: setUserRole,
    theme,
    onThemeChange: setTheme,
    colorMode,
    onColorModeChange: setColorMode
  };

  /**
   * Bereich wählen; der Fokus springt in das Panel (Tastatur landet direkt im Inhalt).
   * Ab 900 px sind alle Bereiche sichtbar: dann ist der Klick ein Sprung, und der Bereich
   * wird kurz markiert (Issue #319).
   */
  const goToPanel = (tab: PanelTab) => {
    setActiveMobileTab(tab);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-panel="${tab}"]`)?.focus({ preventScroll: true });
      if (isSinglePanel) return;
      clearTimeout(flashTimerRef.current);
      setFlashedPanel(null);
      requestAnimationFrame(() => setFlashedPanel(tab));
      flashTimerRef.current = setTimeout(() => setFlashedPanel(null), PANEL_FLASH_MS);
    });
  };

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  // WCAG 1.4.13: Kurzinfo per Escape schließen, ohne Zeiger oder Fokus zu bewegen
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setTipsHidden(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const showTips = () => setTipsHidden(false);

  // Beim Wechsel zwischen Telefon- und Desktop-Kopf sind offene Menüs ungültig
  const [menuLayoutNarrow, setMenuLayoutNarrow] = useState(isNarrowHeader);
  if (menuLayoutNarrow !== isNarrowHeader) {
    setMenuLayoutNarrow(isNarrowHeader);
    setIsAppearanceOpen(false);
    setIsMenuOpen(false);
  }

  // Darstellungsmenü: Fokus hinein, Klick außerhalb schließt
  useEffect(() => {
    if (!isAppearanceOpen) return;
    // Tastatur: Fokus auf die gewählte Option unter „Design“; Maus: auf das Menü selbst
    const panel = appearancePanelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (appearanceOpenedByKeyboard.current ? first : panel)?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!appearanceAnchorRef.current?.contains(event.target as Node)) {
        setIsAppearanceOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isAppearanceOpen]);

  const handleAppearanceKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsAppearanceOpen(false);
      appearanceButtonRef.current?.focus();
      return;
    }
    trapTabKey(event, event.currentTarget, document.activeElement);
  };

  // Mobiles Sheet als modaler Dialog: Seite dahinter ist inert, Escape schließt
  useEffect(() => {
    const dialog = sheetRef.current;
    if (!dialog) return;
    if (isMenuOpen && !dialog.open) dialog.showModal();
    if (!isMenuOpen && dialog.open) dialog.close();
  }, [isMenuOpen]);

  const closeMenu = (restoreFocus = true) => {
    setIsMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const handleSheetKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    trapTabKey(event, event.currentTarget, document.activeElement);
  };

  // Audio State Machine
  const [audioStateMachine] = useState<PodcastStateMachine>(() => new PodcastStateMachine());

  // Chat Messages
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_intro",
      role: "assistant",
      // Ortsneutral (mobil liegt Studio nicht rechts); Text aus dem Sprachkatalog, siehe chatMessages
      content: t("chatWelcome")
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
        // Klartext mit Handlungshinweis; Statuscode und Servertext nur als Detail (Issue #315)
        const error = t(
          err instanceof ChatApiError ? errorKeyForStatus(err.status) : "errorGeneric"
        );
        const errorDetail =
          err instanceof ChatApiError
            ? `${t("errorTechnical")}: ${technicalErrorDetail(err.status, err.message)}`
            : undefined;
        updateMessage(assistantId, (m) => ({ ...m, error, errorDetail }));
      }
    } finally {
      updateMessage(assistantId, (m) => ({ ...m, isStreaming: false }));
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  // Begrüßung folgt der gewählten Sprache, auch nach einem Wechsel
  const chatMessages = useMemo(
    () => messages.map((m) => (m.id === "msg_intro" ? { ...m, content: t("chatWelcome") } : m)),
    [messages, t]
  );

  const handleRetryChat = () => {
    if (lastPromptRef.current) void handleSendMessage(lastPromptRef.current, { isRetry: true });
  };

  return (
    <div className="workspace-shell" data-testid="workspace-shell">
      {/* Sprunglink: erstes fokussierbares Element, nur bei Fokus sichtbar */}
      <a href="#workspace-main" className="rn-skip-link" data-testid="skip-link">
        {t("skipToContent")}
      </a>

      {/* Kopf: Logo links, Bereiche als Reiterleiste, Darstellung in einem Menü */}
      <header
        data-testid="workspace-header"
        className="workspace-header"
        data-tips-hidden={tipsHidden ? "true" : undefined}
      >
        <div className="workspace-brand">
          <h1 id="app-title" className="workspace-title">
            <BrandLogo height={32} />
          </h1>
          <span className="workspace-version">v{WORKSPACE_VERSION}</span>
        </div>

        <nav aria-label={t("navAreas")} className="rn-topnav" data-testid="top-nav">
          {PANEL_TABS.map((tab) => {
            const isSources = tab.id === "sources";
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goToPanel(tab.id)}
                // Nur wenn genau ein Bereich sichtbar ist, bedeutet „aktuell“ etwas
                aria-current={isSinglePanel && activeMobileTab === tab.id ? "true" : undefined}
                data-testid={`top-tab-${tab.id}`}
                className="rn-topnav-item rn-tip-host"
                onPointerLeave={showTips}
                onBlur={showTips}
              >
                <Icon name={tab.icon} size={18} />
                <span className="rn-topnav-label">{t(tab.labelKey)}</span>
                {isSources && (
                  <span className="rn-topnav-count">
                    <span className="rn-visually-hidden">, </span>
                    {sources.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Einstellungen und Darstellung öffnen Dialoge, keine Bereiche: außerhalb der Navigation */}
        <div className="rn-header-end">
          <button
            ref={settingsButtonRef}
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            data-testid="btn-open-settings"
            aria-haspopup="dialog"
            className="rn-control rn-control--button rn-settings-button rn-tip-host"
            onPointerLeave={showTips}
            onBlur={showTips}
          >
            <Icon name="settings" size={18} />
            <span className="rn-settings-button-label">{t("navSettings")}</span>
          </button>
          <div className="rn-popover-anchor" ref={appearanceAnchorRef}>
            <button
              ref={appearanceButtonRef}
              type="button"
              onClick={(event) => {
                // detail 0: per Enter oder Leertaste ausgelöst
                appearanceOpenedByKeyboard.current = event.detail === 0;
                setIsAppearanceOpen((open) => !open);
              }}
              aria-expanded={isAppearanceOpen}
              aria-controls="appearance-menu"
              aria-haspopup="dialog"
              data-testid="btn-open-appearance"
              className="rn-control rn-control--button rn-appearance-button rn-tip-host"
              onPointerLeave={showTips}
              onBlur={showTips}
            >
              <Icon name="palette" size={18} />
              <span className="rn-appearance-button-label">{t("appearanceTitle")}</span>
              <Icon name="chevron" size={16} className="rn-icon rn-appearance-chevron" />
            </button>
            {isAppearanceOpen && !isNarrowHeader && (
              <dialog
                id="appearance-menu"
                ref={appearancePanelRef}
                open
                tabIndex={-1}
                aria-label={t("appearanceTitle")}
                data-testid="appearance-menu"
                className="rn-popover"
                onKeyDown={handleAppearanceKeyDown}
              >
                <AppearanceControls idPrefix="appearance" {...appearanceProps} />
              </dialog>
            )}
          </div>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-expanded={isMenuOpen}
            aria-controls="nav-sheet"
            aria-haspopup="dialog"
            aria-label={t("menuOpen")}
            data-testid="btn-open-menu"
            className="rn-control rn-control--button rn-menu-button"
          >
            <Icon name="menu" size={22} />
          </button>
        </div>
      </header>

      {/* Main 3-Panel Workspace Container */}
      <main
        id="workspace-main"
        tabIndex={-1}
        aria-labelledby="app-title"
        data-testid="workspace-3panel-container"
        className="workspace-main"
      >
        {/* Panel 1: Left Sources Panel */}
        <div
          data-testid="panel-left-wrapper"
          data-panel="sources"
          data-flash={flashedPanel === "sources" ? "true" : undefined}
          tabIndex={-1}
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
          data-panel="chat"
          data-flash={flashedPanel === "chat" ? "true" : undefined}
          tabIndex={-1}
          className={`workspace-panel panel-center ${activeMobileTab === "chat" ? "panel-active" : ""}`}
        >
          <ChatPanel
            notebookTitle="Cloudflare Edge Stack Architecture"
            notebookSummary="Dieses Notebook dokumentiert die vollständige Cloudflare Single-Worker- und In-Memory-Vektor-Architektur für latenzfreie Inferenz."
            messages={chatMessages}
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
          data-panel="studio"
          data-flash={flashedPanel === "studio" ? "true" : undefined}
          tabIndex={-1}
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
      </main>

      {/* Untere Reiterleiste (unter 600 px): im Daumenbereich, Symbol und Kurzname */}
      <nav aria-label={t("navAreas")} data-testid="mobile-bottom-nav" className="mobile-bottom-nav">
        {PANEL_TABS.map((tab) => {
          const isActive = activeMobileTab === tab.id;
          const isSources = tab.id === "sources";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => goToPanel(tab.id)}
              aria-current={isActive ? "true" : undefined}
              aria-label={isSources ? undefined : t(tab.ariaKey)}
              data-testid={`tab-btn-${tab.id}`}
              className="rn-tab"
            >
              <span className="rn-tab-indicator" aria-hidden="true">
                <Icon name={tab.icon} size={22} />
                {isSources && <span className="rn-tab-count">{sources.length}</span>}
              </span>
              <span className="rn-tab-label">{t(tab.labelKey)}</span>
              {isSources && <span className="rn-visually-hidden"> ({sources.length})</span>}
            </button>
          );
        })}
      </nav>

      {/* Mobiles Menü (unter 600 px): Vollbild-Sheet mit Bereichen und Darstellung */}
      {isNarrowHeader && (
        <dialog
          id="nav-sheet"
          ref={sheetRef}
          aria-labelledby="nav-sheet-title"
          data-testid="nav-sheet"
          className="rn-sheet"
          onCancel={(e) => {
            e.preventDefault();
            closeMenu();
          }}
          onKeyDown={handleSheetKeyDown}
        >
          <div className="rn-sheet-head">
            <h2 id="nav-sheet-title" className="rn-sheet-title">
              {t("menuTitle")}
            </h2>
            <button
              type="button"
              onClick={() => closeMenu()}
              aria-label={t("menuClose")}
              data-testid="btn-close-menu"
              className="rn-icon-btn rn-dialog-close"
            >
              <Icon name="close" size={22} />
            </button>
          </div>

          <div className="rn-sheet-body">
            {/* Die Bereiche (Quellen, Chat, Studio) stehen in der unteren Leiste, hier nur der Rest */}
            <ul className="rn-sheet-nav">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu(false);
                    setIsSettingsOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="sheet-open-settings"
                  className="rn-sheet-item"
                >
                  <Icon name="settings" size={22} />
                  <span className="rn-sheet-item-text">
                    <span className="rn-sheet-item-title">{t("navSettings")}</span>
                    <span className="rn-sheet-item-hint">{t("navSettingsHint")}</span>
                  </span>
                </button>
              </li>
            </ul>

            <section aria-labelledby="nav-sheet-appearance">
              <h3 id="nav-sheet-appearance" className="rn-sheet-section">
                {t("appearanceTitle")}
              </h3>
              <AppearanceControls idPrefix="sheet" {...appearanceProps} />
            </section>
          </div>
        </dialog>
      )}

      {/* Settings & Compliance Drawer Modal */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeModel={activeModel}
        onModelChange={(model) => {
          setActiveModel(model);
          storeModel(browserStorage(), model);
        }}
        // Aus dem Menü-Sheet geöffnet: das Sheet ist zu, der Fokus geht auf den Menüknopf
        returnFocusFallback={() =>
          isNarrowHeader ? menuButtonRef.current : settingsButtonRef.current
        }
      />
    </div>
  );
}

export interface AppProps {
  readonly initialTool?: "overview" | "mindmap" | "flashcards" | "quiz" | undefined;
}

export const App: FunctionComponent<AppProps> = ({ initialTool = "overview" }: AppProps = {}) => {
  return <WorkspaceLayout initialTool={initialTool} />;
};
