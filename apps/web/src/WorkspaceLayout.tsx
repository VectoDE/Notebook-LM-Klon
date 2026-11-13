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
import { GraphViewer } from "./GraphViewer.js";
import { Icon, type IconName } from "./Icon.js";
import { NotebookTitle } from "./NotebookTitle.js";
import { PanelRail, PanelToggle, RailButton } from "./PanelRail.js";
import { SettingsDrawer } from "./SettingsDrawer.js";
import { ShareDialog } from "./ShareDialog.js";
import { SignInDialog } from "./SignInDialog.js";
import { SOURCE_FILE_ACCEPT, SourcesPanel } from "./SourcesPanel.js";
import { StudioPanel, type StudioTool } from "./StudioPanel.js";
import { Toast, type ToastMessage } from "./Toast.js";
import { triggerBrowserDownload } from "./artifact-exporters.js";
import {
  ChatApiError,
  errorKeyForStatus,
  fetchChatHistory,
  mapCitations,
  streamChat,
  technicalErrorDetail
} from "./chat-client.js";
import { chatToMarkdown } from "./chat-export.js";
import { wipeLocalData } from "./encrypted-store.js";
import { FOCUSABLE_SELECTOR, trapTabKey } from "./focus-trap.js";
import { buildKnowledgeGraph } from "./knowledge-graph.js";
import {
  type CollapsedPanels,
  type CollapsiblePanel,
  matchPanelShortcut,
  readChatId,
  readCollapsedPanels,
  readNotebookTitle,
  storeChatId,
  storeCollapsedPanels,
  storeNotebookTitle
} from "./layout-preferences.js";
import { signOutAndWipe } from "./local-session.js";
import { buildStructuredDemo } from "./structured-demo.js";
import { describeSyncStatus } from "./sync-status-text.js";
import { browserStorage, readStoredModel, storeModel } from "./theme-preferences.js";
import { useNotebookSync } from "./useNotebookSync.js";
import { documentLanguage, useTheme } from "./useTheme.js";
import type { CitationLocation, PanelFocusAttributes, WorkspaceSource } from "./workspace-types.js";

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
const loadDemoEntityGraph = () => import("./entity-graph-view.js").then((m) => m.DEMO_ENTITY_GRAPH);

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

/** Timeline, Datentabelle und Infografik der Demo, geprüft gegen die Demo-Quellen (Issue #239). */
const DEFAULT_STRUCTURED = buildStructuredDemo(DEFAULT_SOURCES);

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

export interface WorkspaceLayoutProps {
  readonly initialTool?: StudioTool | undefined;
  readonly initialPanelTab?: PanelTab | undefined;
  readonly notebookId?: string | undefined;
  /** Test-Hook: ersetzt fetch fuer den Chat-Client. */
  readonly chatFetch?: typeof fetch | undefined;
}

/** Standardtitel des Demo-Notebooks, bis er umbenannt wird. */
export const DEFAULT_NOTEBOOK_TITLE = "Cloudflare Edge Stack Architecture";

/** Unter 600 px: Logo, Titel und Menü-Knopf oben, Reiterleiste unten. */
const NARROW_HEADER_QUERY = "(max-width: 599.98px)";

/**
 * Unter 900 px ist nur ein Bereich sichtbar: die Reiter schalten um. Ab 900 px stehen alle
 * Spalten nebeneinander und sind selbst die Navigation (Issue #325).
 */
const SINGLE_PANEL_QUERY = "(max-width: 899.98px)";

/** Bereiche; graph teilt sich ab 900 px die mittlere Spalte mit dem Chat (Issue #327). */
type PanelTab = "sources" | "chat" | "studio" | "graph";
type Popover = "appearance" | "account";

/**
 * Bereiche des Arbeitsbereichs: Schlüssel im Sprachkatalog für den kurzen Namen und den
 * vollen Namen für Screenreader (beginnt mit dem sichtbaren Namen).
 */
const PANEL_TABS: readonly {
  readonly id: PanelTab;
  readonly labelKey: string;
  readonly ariaKey: string;
  /** Sprunglink zur Spalte; der Graph hat keine eigene Spalte und keinen Sprunglink. */
  readonly skipKey?: string | undefined;
  readonly icon: IconName;
}[] = [
  {
    id: "sources",
    labelKey: "navSources",
    ariaKey: "navSources",
    skipKey: "skipToSources",
    icon: "sources"
  },
  { id: "chat", labelKey: "navChat", ariaKey: "navChatAria", skipKey: "skipToChat", icon: "chat" },
  {
    id: "studio",
    labelKey: "navStudio",
    ariaKey: "navStudioAria",
    skipKey: "skipToStudio",
    icon: "studio"
  },
  { id: "graph", labelKey: "navGraph", ariaKey: "navGraphAria", icon: "graph" }
];

/**
 * Werkzeuge in der Symbolleiste der eingeklappten Studio-Spalte. Der Wissensgraph steht wie
 * im Studio nach der Mindmap; er öffnet in der mittleren Spalte (Issue #327, #335).
 */
const RAIL_TOOLS: readonly {
  readonly tool: Exclude<StudioTool, "overview" | "briefing"> | "graph";
  readonly icon: IconName;
  readonly labelKey: string;
}[] = [
  { tool: "audio", icon: "audio", labelKey: "studioAudioCard" },
  { tool: "video", icon: "video", labelKey: "studioVideoCard" },
  { tool: "mindmap", icon: "mindmap", labelKey: "toolMindmapTitle" },
  { tool: "graph", icon: "graph", labelKey: "toolGraphTitle" },
  { tool: "flashcards", icon: "cards", labelKey: "toolCardsTitle" },
  { tool: "quiz", icon: "quiz", labelKey: "toolQuizTitle" }
];

/** id der Spalteninhalte: Ziel von aria-controls und der Sprunglinks. */
const COLUMN_IDS: Readonly<Record<PanelTab, string>> = {
  sources: "sources-column",
  chat: "chat-column",
  studio: "studio-column",
  graph: "chat-column"
};

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

/** Ist gerade ein modaler Dialog offen? Dann wirken die Spalten-Kürzel nicht. */
function isModalOpen(): boolean {
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    return false;
  }
}

export function WorkspaceLayout({
  initialTool = "overview",
  initialPanelTab = "chat",
  notebookId = "nb_active",
  chatFetch
}: WorkspaceLayoutProps) {
  const { theme, setTheme, colorMode, setColorMode, t, tf, language } = useTheme();
  const isNarrowHeader = useMediaQuery(NARROW_HEADER_QUERY);
  const isSinglePanel = useMediaQuery(SINGLE_PANEL_QUERY);

  // Panels & Navigation state
  const [activeMobileTab, setActiveMobileTab] = useState<PanelTab>(initialPanelTab);
  // Wissensgraph statt Chat in der mittleren Spalte (Issue #327); der Chat bleibt erhalten
  const [isGraphOpen, setIsGraphOpen] = useState(initialPanelTab === "graph");
  const [sources, setSources] = useState<WorkspaceSource[]>(DEFAULT_SOURCES);
  const [activeCitation, setActiveCitation] = useState<CitationLocation | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  // Modellwahl übersteht das Neuladen (nur bekannte Werte, Issue #319)
  const [activeModel, setActiveModel] = useState<string>(() => readStoredModel(browserStorage()));
  // Eingeklappte Spalten und Titel bleiben auf dem Gerät gespeichert (Issue #325); ohne
  // gespeicherte Wahl startet das Studio auf schmalem Desktop eingeklappt (Issue #335)
  const [collapsed, setCollapsed] = useState<CollapsedPanels>(() =>
    readCollapsedPanels(
      browserStorage(),
      typeof window === "undefined" ? undefined : window.innerWidth
    )
  );
  const [notebookTitle, setNotebookTitle] = useState(() =>
    readNotebookTitle(browserStorage(), notebookId, DEFAULT_NOTEBOOK_TITLE)
  );
  // Offline-Bearbeiten mit Synchronisation (Issue #347): aktiv, sobald eine Sitzung besteht
  const notebookSync = useNotebookSync(
    notebookId,
    notebookTitle === DEFAULT_NOTEBOOK_TITLE ? undefined : notebookTitle,
    setNotebookTitle
  );
  const [studioToolRequest, setStudioToolRequest] = useState<{ readonly tool: StudioTool }>();
  // Kurze Meldung für Screenreader (Spalte ein- oder ausgeklappt, Titel gespeichert)
  const [announcement, setAnnouncement] = useState("");
  // Hinweis-Leiste unten (Issue #329): Rückmeldung nach Export, neuer Quelle, Titel
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastCounter = useRef(0);
  const notify = useCallback((message: string) => {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, message });
  }, []);
  // Kurzinfos der Symbolknöpfe: Escape blendet sie aus, bis Zeiger oder Fokus den Knopf verlassen
  const [tipsHidden, setTipsHidden] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>("owner");
  const [openPopover, setOpenPopover] = useState<Popover | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const appearanceAnchorRef = useRef<HTMLDivElement>(null);
  const accountAnchorRef = useRef<HTMLDivElement>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const popoverPanelRef = useRef<HTMLDialogElement>(null);
  const popoverOpenedByKeyboard = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const railFileInputRef = useRef<HTMLInputElement>(null);
  const settingsFromAccountRef = useRef(false);
  const sheetRef = useRef<HTMLDialogElement>(null);

  // Einklappen gilt nur, wenn alle Spalten nebeneinander stehen (ab 900 px)
  const isCollapsed = (panel: CollapsiblePanel) => !isSinglePanel && collapsed[panel];

  const appearanceProps = {
    role: userRole,
    onRoleChange: setUserRole,
    theme,
    onThemeChange: setTheme,
    colorMode,
    onColorModeChange: setColorMode
  };

  const setPanelCollapsed = (panel: CollapsiblePanel, value: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [panel]: value };
      storeCollapsedPanels(browserStorage(), next);
      return next;
    });
    const key =
      panel === "sources"
        ? value
          ? "panelSourcesCollapsed"
          : "panelSourcesExpanded"
        : value
          ? "panelStudioCollapsed"
          : "panelStudioExpanded";
    setAnnouncement(t(key));
  };

  /**
   * Spalte ein- oder ausklappen. Ging der Fokus dabei verloren (er lag in der eingeklappten
   * Spalte oder auf dem verschwundenen Knopf der Leiste), landet er auf dem Umschalter.
   */
  const togglePanel = (panel: CollapsiblePanel) => {
    const willCollapse = !collapsed[panel];
    setPanelCollapsed(panel, willCollapse);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || active.closest("[hidden]") !== null;
      if (!lost) return;
      document
        .querySelector<HTMLElement>(
          `[data-testid="btn-${willCollapse ? "expand" : "collapse"}-${panel}"]`
        )
        ?.focus();
    });
  };

  // Kürzel Alt+Umschalt+1 / +3 (nur ab 900 px und ohne offenen modalen Dialog)
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;
  useEffect(() => {
    if (isSinglePanel) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = matchPanelShortcut(event);
      if (!panel || event.defaultPrevented || isModalOpen()) return;
      event.preventDefault();
      togglePanelRef.current(panel);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSinglePanel]);

  /**
   * Bereich wählen; der Fokus springt in das Panel (Tastatur landet direkt im Inhalt).
   * Unter 900 px schaltet das den sichtbaren Bereich um; ab 900 px wird eine eingeklappte
   * Spalte dabei ausgeklappt.
   */
  const goToPanel = (tab: PanelTab) => {
    setActiveMobileTab(tab);
    if (tab === "graph") setIsGraphOpen(true);
    if (tab === "chat") setIsGraphOpen(false);
    if ((tab === "sources" || tab === "studio") && isCollapsed(tab)) {
      setPanelCollapsed(tab, false);
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-panel="${tab}"]`)?.focus({ preventScroll: true });
    });
  };

  /** Werkzeug aus der eingeklappten Studio-Leiste: Spalte ausklappen, Werkzeug öffnen. */
  const openStudioTool = (tool: StudioTool) => {
    setStudioToolRequest({ tool });
    goToPanel("studio");
  };

  // Fokusziel ist die benannte Region im Bereich, nicht der Layout-Wrapper (Issue #323)
  const panelAttributes = (tab: PanelTab): PanelFocusAttributes => ({
    "data-panel": tab,
    tabIndex: -1
  });

  /** Abmelden (Issue #348): lokale Daten löschen, dann die Sitzung am Server beenden. */
  const signOut = async () => {
    notebookSync.stop();
    const result = await signOutAndWipe({
      fetchFn: (input, init) => fetch(input, init),
      wipe: () => wipeLocalData(),
      storage: browserStorage()
    });
    setNotebookTitle(DEFAULT_NOTEBOOK_TITLE);
    if (!result.localWiped) notify(t("signOutFailed"));
    else notify(t(result.serverSignedOut ? "signOutDone" : "signOutLocalOnly"));
  };

  const renameNotebook = (title: string) => {
    setNotebookTitle(title);
    // Mit Sitzung übernimmt die Synchronisation (verschlüsselt), sonst wie bisher lokal
    if (!notebookSync.rename(title)) storeNotebookTitle(browserStorage(), notebookId, title);
    notify(tf("titleSaved", { title }));
  };

  // WCAG 1.4.13: Kurzinfo per Escape schließen, ohne Zeiger oder Fokus zu bewegen
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setTipsHidden(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const showTips = () => setTipsHidden(false);
  const tipHandlers = { onPointerLeave: showTips, onBlur: showTips };

  // Beim Wechsel zwischen Telefon- und Desktop-Kopf sind offene Menüs ungültig
  const [menuLayoutNarrow, setMenuLayoutNarrow] = useState(isNarrowHeader);
  if (menuLayoutNarrow !== isNarrowHeader) {
    setMenuLayoutNarrow(isNarrowHeader);
    setOpenPopover(null);
    setIsMenuOpen(false);
  }

  // Menüs im Kopf (Darstellung, Konto): Fokus hinein, Klick außerhalb schließt
  useEffect(() => {
    if (!openPopover) return;
    // Tastatur: Fokus auf das erste Feld (bei Radiogruppen das gewählte); Maus: auf das Menü
    const panel = popoverPanelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (popoverOpenedByKeyboard.current ? first : panel)?.focus();
    const anchor = (openPopover === "appearance" ? appearanceAnchorRef : accountAnchorRef).current;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor?.contains(event.target as Node)) setOpenPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openPopover]);

  const togglePopover = (popover: Popover, byKeyboard: boolean) => {
    popoverOpenedByKeyboard.current = byKeyboard;
    setOpenPopover((open) => (open === popover ? null : popover));
  };

  const closePopover = (restoreFocus: boolean) => {
    const open = openPopover;
    setOpenPopover(null);
    if (!restoreFocus || !open) return;
    (open === "appearance" ? appearanceButtonRef : accountButtonRef).current?.focus();
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover(true);
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

  // Gespeicherten Verlauf vollständig laden, Seite für Seite (Issue #243). Ohne Server
  // (Vorschau, Offline) bleibt es still bei der Begrüßung.
  useEffect(() => {
    const storedChatId = readChatId(browserStorage(), notebookId);
    if (!storedChatId) return;
    const controller = new AbortController();
    fetchChatHistory({ chatId: storedChatId, signal: controller.signal, fetchImpl: chatFetch })
      .then((items) => {
        chatIdRef.current = storedChatId;
        const restored: ChatMessage[] = items
          .filter((item) => item.role !== "system")
          .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            citations: mapCitations(item.citations ?? [])
          }));
        if (restored.length > 0) setMessages((prev) => [...prev.slice(0, 1), ...restored]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [notebookId, chatFetch]);

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
    const [first] = newSources;
    if (newSources.length === 1 && first) notify(tf("toastSourceAdded", { title: first.title }));
    else if (newSources.length > 1) notify(tf("toastSourcesAdded", { n: newSources.length }));
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
    notify(tf("toastSourceAdded", { title: newSource.title }));
  };

  // Citation Click -> Jump to Left Sources Panel
  const handleCitationClick = (citation: CitationLocation) => {
    setActiveCitation(citation);
    setActiveMobileTab("sources");
    // Eingeklappte Quellen klappen auf, damit die Fundstelle sichtbar wird
    if (isCollapsed("sources")) setPanelCollapsed("sources", false);
  };

  /**
   * Sprung aus dem Graphen in die Quellen. Unter 900 px verschwindet der Graph dabei aus dem
   * Bild: dann geht der Fokus in die Quellen, sonst bliebe er auf einem unsichtbaren Knopf.
   */
  const jumpToSourceFromGraph = (sourceId: string) => jumpToCitationFromGraph({ sourceId });

  /** Wie oben, mit Zitat: Die Quelle zeigt die belegte Stelle markiert (Issue #238). */
  const jumpToCitationFromGraph = (citation: CitationLocation) => {
    handleCitationClick(citation);
    if (!isSinglePanel) return;
    requestAnimationFrame(() => {
      if (document.activeElement?.closest("[data-panel='sources']")) return;
      document.querySelector<HTMLElement>("[data-panel='sources']")?.focus({ preventScroll: true });
    });
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
        // Antworten der KI: Leichte Sprache gilt für die Oberfläche, die Antwort kommt auf Deutsch.
        language: documentLanguage(language),
        signal: controller.signal,
        fetchImpl: chatFetch
      })) {
        if (ev.type === "token") {
          if (ev.chatId && ev.chatId !== chatIdRef.current) {
            chatIdRef.current = ev.chatId;
            storeChatId(browserStorage(), notebookId, ev.chatId);
          }
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

  // Verlauf mit Zitaten als Markdown sichern (Issue #243)
  const handleExportChat = () => {
    const titles = new Map(sources.map((s) => [s.id, s.title]));
    const markdown = chatToMarkdown(
      chatMessages.filter((m) => m.id !== "msg_intro"),
      {
        title: notebookTitle,
        date: new Date(),
        labels: {
          exportedAt: t("chatExportedAt"),
          user: t("chatUser"),
          assistant: t("chatAssistant"),
          sources: t("chatExportSources"),
          page: t("chatExportPage"),
          aborted: t("chatStatusAborted"),
          aiLabel: t("chatExportAiLabel")
        },
        sourceTitle: (id) => titles.get(id)
      }
    );
    const file = `${notebookTitle}_${t("chatExportFile")}.md`;
    if (triggerBrowserDownload(file, markdown, "text/markdown;charset=utf-8")) {
      notify(tf("toastDownload", { file }));
    }
  };

  const handleRetryChat = () => {
    if (lastPromptRef.current) void handleSendMessage(lastPromptRef.current, { isRetry: true });
  };

  // Wissensgraph aus Quellen und Mindmap (keine erfundenen Inhalte, Issue #327)
  const knowledgeGraph = useMemo(() => buildKnowledgeGraph(sources, DEFAULT_MINDMAP), [sources]);

  const sourcesCollapsed = isCollapsed("sources");
  const studioCollapsed = isCollapsed("studio");

  return (
    <div
      className="workspace-shell"
      data-testid="workspace-shell"
      data-tips-hidden={tipsHidden ? "true" : undefined}
    >
      {/* Sprunglinks: zuerst zum Inhalt, dann zu jeder Spalte; nur bei Fokus sichtbar */}
      <a href="#workspace-main" className="rn-skip-link" data-testid="skip-link">
        {t("skipToContent")}
      </a>
      {PANEL_TABS.filter((tab) => tab.skipKey).map((tab) => (
        <a
          key={tab.id}
          href={`#${COLUMN_IDS[tab.id]}`}
          className="rn-skip-link"
          data-testid={`skip-link-${tab.id}`}
          onClick={(event) => {
            event.preventDefault();
            goToPanel(tab.id);
          }}
        >
          {t(tab.skipKey as string)}
        </a>
      ))}

      {/* Anwendungsleiste: Logo, Notebook-Titel, Teilen, Einstellungen, Darstellung, Konto */}
      <header data-testid="workspace-header" className="workspace-header">
        <div className="workspace-brand">
          <span className="workspace-logo">
            <BrandLogo height={isNarrowHeader ? 26 : 32} />
          </span>
          <span className="workspace-version">v{WORKSPACE_VERSION}</span>
          <NotebookTitle id="notebook-title" title={notebookTitle} onRename={renameNotebook} />
          <output
            data-testid="sync-status"
            data-state={notebookSync.status?.state}
            className="rn-sync-status"
            title={notebookSync.status ? describeSyncStatus(notebookSync.status, tf) : undefined}
            hidden={!notebookSync.status}
          >
            {notebookSync.status && (
              <>
                <span className="rn-sync-dot" aria-hidden="true" />
                <span className="rn-sync-text">{describeSyncStatus(notebookSync.status, tf)}</span>
                {notebookSync.status.pending > 0 && (
                  <span className="rn-sync-count" aria-hidden="true">
                    {notebookSync.status.pending}
                  </span>
                )}
              </>
            )}
          </output>
        </div>

        <div className="rn-header-end">
          <button
            ref={shareButtonRef}
            type="button"
            onClick={() => setIsShareOpen(true)}
            data-testid="btn-open-share"
            aria-haspopup="dialog"
            className="rn-control rn-control--button rn-share-button rn-tip-host"
            {...tipHandlers}
          >
            <Icon name="share" size={18} />
            <span className="rn-share-button-label">{t("shareButton")}</span>
          </button>
          <button
            ref={settingsButtonRef}
            type="button"
            onClick={() => {
              settingsFromAccountRef.current = false;
              setIsSettingsOpen(true);
            }}
            data-testid="btn-open-settings"
            aria-haspopup="dialog"
            className="rn-control rn-control--button rn-settings-button rn-tip-host"
            {...tipHandlers}
          >
            <Icon name="settings" size={18} />
            <span className="rn-settings-button-label">{t("navSettings")}</span>
          </button>
          <div className="rn-popover-anchor" ref={appearanceAnchorRef}>
            <button
              ref={appearanceButtonRef}
              type="button"
              // detail 0: per Enter oder Leertaste ausgelöst
              onClick={(event) => togglePopover("appearance", event.detail === 0)}
              aria-expanded={openPopover === "appearance"}
              aria-controls="appearance-menu"
              aria-haspopup="dialog"
              data-testid="btn-open-appearance"
              className="rn-control rn-control--button rn-appearance-button rn-tip-host"
              {...tipHandlers}
            >
              <Icon name="palette" size={18} />
              <span className="rn-appearance-button-label">{t("appearanceTitle")}</span>
              <Icon name="chevron" size={16} className="rn-icon rn-appearance-chevron" />
            </button>
            {openPopover === "appearance" && !isNarrowHeader && (
              <dialog
                id="appearance-menu"
                ref={popoverPanelRef}
                open
                tabIndex={-1}
                aria-label={t("appearanceTitle")}
                data-testid="appearance-menu"
                className="rn-popover"
                onKeyDown={handlePopoverKeyDown}
              >
                <AppearanceControls idPrefix="appearance" {...appearanceProps} />
              </dialog>
            )}
          </div>
          <div className="rn-popover-anchor" ref={accountAnchorRef}>
            <button
              ref={accountButtonRef}
              type="button"
              onClick={(event) => togglePopover("account", event.detail === 0)}
              aria-expanded={openPopover === "account"}
              aria-controls="account-menu"
              aria-haspopup="dialog"
              data-testid="btn-open-account"
              className="rn-control rn-control--button rn-account-button rn-tip-host"
              {...tipHandlers}
            >
              <Icon name="account" size={22} />
              <span className="rn-tip rn-tip--below">
                <span className="rn-tip-label">{t("accountButton")}</span>
              </span>
            </button>
            {openPopover === "account" && !isNarrowHeader && (
              <dialog
                id="account-menu"
                ref={popoverPanelRef}
                open
                tabIndex={-1}
                aria-label={t("accountButton")}
                data-testid="account-menu"
                className="rn-popover rn-account"
                onKeyDown={handlePopoverKeyDown}
              >
                <AccountStatus />
                <button
                  type="button"
                  onClick={() => {
                    // Fokus zuerst auf den Konto-Knopf: der Dialog merkt ihn als Rückkehrziel
                    closePopover(true);
                    setIsSignInOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="account-open-sign-in"
                  className="rn-btn rn-btn--primary rn-btn--block"
                >
                  <Icon name="account" size={18} />
                  {t("signInOpen")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Fokus zuerst auf den Konto-Knopf: der Dialog merkt ihn als Rückkehrziel
                    closePopover(true);
                    settingsFromAccountRef.current = true;
                    setIsSettingsOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="account-open-settings"
                  className="rn-btn rn-btn--secondary rn-btn--block"
                >
                  <Icon name="settings" size={18} />
                  {t("accountOpenSettings")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closePopover(true);
                    void signOut();
                  }}
                  data-testid="account-sign-out"
                  className="rn-btn rn-btn--secondary rn-btn--block"
                >
                  {t("signOutWipe")}
                </button>
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

      {/* Reiter 600 bis 899 px: nur hier ist genau ein Bereich sichtbar. Ab 900 px sind die
          Spalten die Navigation, unter 600 px liegt die Leiste unten (Issue #325). */}
      <nav aria-label={t("navAreas")} className="rn-topnav" data-testid="top-nav">
        {PANEL_TABS.map((tab) => {
          const isSources = tab.id === "sources";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => goToPanel(tab.id)}
              aria-current={isSinglePanel && activeMobileTab === tab.id ? "true" : undefined}
              data-testid={`top-tab-${tab.id}`}
              className="rn-topnav-item"
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

      {/* Main 3-Panel Workspace Container */}
      <main
        id="workspace-main"
        tabIndex={-1}
        aria-labelledby="notebook-title"
        data-testid="workspace-3panel-container"
        className="workspace-main"
      >
        {/* Panel 1: Left Sources Panel */}
        <div
          data-testid="panel-left-wrapper"
          data-collapsed={sourcesCollapsed ? "true" : undefined}
          className={`workspace-panel panel-left ${activeMobileTab === "sources" ? "panel-active" : ""}`}
        >
          {sourcesCollapsed && (
            <PanelRail
              panel="sources"
              toggle={
                <PanelToggle
                  panel="sources"
                  collapsed
                  onToggle={() => togglePanel("sources")}
                  controls={COLUMN_IDS.sources}
                />
              }
            >
              <RailButton
                icon="plus"
                label={t("sourcesAdd")}
                onClick={() => railFileInputRef.current?.click()}
                tipSide="right"
                testId="rail-add-source"
              />
              <input
                ref={railFileInputRef}
                type="file"
                multiple
                accept={SOURCE_FILE_ACCEPT}
                hidden
                data-testid="rail-file-input"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) handleUploadFiles(files);
                  event.target.value = "";
                }}
                aria-label={t("srcFileInputAria")}
              />
            </PanelRail>
          )}
          <div id={COLUMN_IDS.sources} className="rn-panel-slot" hidden={sourcesCollapsed}>
            <SourcesPanel
              sources={sources}
              notebookId={notebookId}
              activeCitation={activeCitation}
              onToggleSelect={handleToggleSelectSource}
              onToggleSelectAll={handleToggleSelectAllSources}
              onUploadFiles={handleUploadFiles}
              onImportUrl={handleImportUrl}
              onClearActiveCitation={() => setActiveCitation(null)}
              panelAttributes={panelAttributes("sources")}
              headerAction={
                <PanelToggle
                  panel="sources"
                  collapsed={false}
                  onToggle={() => togglePanel("sources")}
                  controls={COLUMN_IDS.sources}
                />
              }
            />
          </div>
        </div>

        {/* Panel 2: Center Citation Chat Panel */}
        <div
          id={COLUMN_IDS.chat}
          data-testid="panel-center-wrapper"
          className={`workspace-panel panel-center ${activeMobileTab === "chat" || activeMobileTab === "graph" ? "panel-active" : ""}`}
        >
          <div className="rn-panel-slot" hidden={isGraphOpen}>
            <ChatPanel
              notebookTitle={notebookTitle}
              notebookSummary="Dieses Notebook dokumentiert die vollständige Cloudflare Single-Worker- und In-Memory-Vektor-Architektur für latenzfreie Inferenz."
              notebookSummaryLang={DEFAULT_CONTENT_LANGS.summary}
              messages={chatMessages}
              activeModel={activeModel}
              onSendMessage={(text) => handleSendMessage(text)}
              onStop={handleStopChat}
              onRetry={handleRetryChat}
              onExport={handleExportChat}
              onCitationClick={handleCitationClick}
              isGenerating={isGenerating}
              panelAttributes={panelAttributes("chat")}
            />
          </div>
          {isGraphOpen && (
            <GraphViewer
              graph={knowledgeGraph}
              contentLang={DEFAULT_CONTENT_LANGS.sources}
              onSourceJump={jumpToSourceFromGraph}
              entityGraph={loadDemoEntityGraph}
              entitySources={sources}
              onCitationJump={jumpToCitationFromGraph}
              onClose={isSinglePanel ? undefined : () => goToPanel("chat")}
              panelAttributes={panelAttributes("graph")}
            />
          )}
        </div>

        {/* Panel 3: Right Studio Panel */}
        <div
          data-testid="panel-right-wrapper"
          data-collapsed={studioCollapsed ? "true" : undefined}
          className={`workspace-panel panel-right ${activeMobileTab === "studio" ? "panel-active" : ""}`}
        >
          {studioCollapsed && (
            <PanelRail
              panel="studio"
              toggle={
                <PanelToggle
                  panel="studio"
                  collapsed
                  onToggle={() => togglePanel("studio")}
                  controls={COLUMN_IDS.studio}
                />
              }
            >
              {RAIL_TOOLS.map((item) => (
                <RailButton
                  key={item.tool}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  onClick={() =>
                    item.tool === "graph" ? goToPanel("graph") : openStudioTool(item.tool)
                  }
                  tipSide="left"
                  testId={`rail-tool-${item.tool}`}
                />
              ))}
            </PanelRail>
          )}
          <div id={COLUMN_IDS.studio} className="rn-panel-slot" hidden={studioCollapsed}>
            <StudioPanel
              notebookTitle={notebookTitle}
              activeTool={initialTool}
              toolRequest={studioToolRequest}
              onOpenGraph={() => goToPanel("graph")}
              mindmapData={DEFAULT_MINDMAP}
              flashcardsData={DEFAULT_FLASHCARDS}
              quizData={DEFAULT_QUIZ}
              videoStoryboard={DEFAULT_VIDEO_STORYBOARD}
              audioStateMachine={audioStateMachine}
              onSourceJump={handleCitationClick}
              contentLangs={DEFAULT_CONTENT_LANGS}
              selectedSourceCount={sources.filter((s) => s.isSelected !== false).length}
              onNotify={notify}
              structuredData={DEFAULT_STRUCTURED}
              structuredSources={sources}
              structuredLang="en"
              panelAttributes={panelAttributes("studio")}
              headerAction={
                <PanelToggle
                  panel="studio"
                  collapsed={false}
                  onToggle={() => togglePanel("studio")}
                  controls={COLUMN_IDS.studio}
                />
              }
            />
          </div>
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

      {/* Meldungen für Screenreader: Spalte ein- oder ausgeklappt */}
      <output aria-live="polite" className="rn-visually-hidden" data-testid="layout-status">
        {announcement}
      </output>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Mobiles Menü (unter 600 px): Vollbild-Sheet mit Teilen, Einstellungen, Konto, Darstellung */}
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
                    setIsShareOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="sheet-open-share"
                  className="rn-sheet-item"
                >
                  <Icon name="share" size={22} />
                  <span className="rn-sheet-item-text">
                    <span className="rn-sheet-item-title">{t("shareButton")}</span>
                    <span className="rn-sheet-item-hint">{t("shareMenuHint")}</span>
                  </span>
                </button>
              </li>
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

            <section aria-labelledby="nav-sheet-account" data-testid="sheet-account">
              <h3 id="nav-sheet-account" className="rn-sheet-section">
                {t("accountButton")}
              </h3>
              <AccountStatus />
              <button
                type="button"
                onClick={() => {
                  closeMenu(false);
                  setIsSignInOpen(true);
                }}
                aria-haspopup="dialog"
                data-testid="sheet-open-sign-in"
                className="rn-btn rn-btn--primary rn-btn--block"
              >
                {t("signInOpen")}
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMenu(false);
                  void signOut();
                }}
                data-testid="sheet-sign-out"
                className="rn-btn rn-btn--secondary rn-btn--block"
              >
                {t("signOutWipe")}
              </button>
            </section>

            <section aria-labelledby="nav-sheet-appearance">
              <h3 id="nav-sheet-appearance" className="rn-sheet-section">
                {t("appearanceTitle")}
              </h3>
              <AppearanceControls idPrefix="sheet" {...appearanceProps} />
            </section>
          </div>
        </dialog>
      )}

      {/* Teilen: nur Oberfläche, ohne Freigabe (Issue #325) */}
      <ShareDialog
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        notebookTitle={notebookTitle}
        returnFocusFallback={() =>
          isNarrowHeader ? menuButtonRef.current : shareButtonRef.current
        }
      />

      {/* Anmelden: Gastzugang und Magic-Link mit Turnstile (Issue #233) */}
      <SignInDialog
        isOpen={isSignInOpen}
        onClose={() => setIsSignInOpen(false)}
        returnFocusFallback={() =>
          isNarrowHeader ? menuButtonRef.current : accountButtonRef.current
        }
      />

      {/* Settings & Compliance Drawer Modal */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeModel={activeModel}
        onModelChange={(model) => {
          setActiveModel(model);
          storeModel(browserStorage(), model);
        }}
        // Aus Menü-Sheet oder Kontomenü geöffnet: dann geht der Fokus auf deren Knopf
        returnFocusFallback={() => {
          if (isNarrowHeader) return menuButtonRef.current;
          return settingsFromAccountRef.current
            ? accountButtonRef.current
            : settingsButtonRef.current;
        }}
      />
    </div>
  );
}

/** Gast-Zustand des Kontos, keine erfundenen Konten (Issue #325). Anmelden öffnet den Dialog (Issue #233). */
export function AccountStatus() {
  const { t } = useTheme();
  return (
    <div className="rn-account-status" data-testid="account-status">
      <span className="rn-account-avatar" aria-hidden="true">
        <Icon name="account" size={28} />
      </span>
      <div className="rn-account-text">
        <p className="rn-account-name">{t("accountGuest")}</p>
        <p className="rn-account-state">{t("accountSignedOut")}</p>
      </div>
      <p className="rn-account-hint">{t("accountText")}</p>
    </div>
  );
}

export interface AppProps {
  readonly initialTool?: "overview" | "mindmap" | "flashcards" | "quiz" | undefined;
}

export const App: FunctionComponent<AppProps> = ({ initialTool = "overview" }: AppProps = {}) => {
  return <WorkspaceLayout initialTool={initialTool} />;
};
