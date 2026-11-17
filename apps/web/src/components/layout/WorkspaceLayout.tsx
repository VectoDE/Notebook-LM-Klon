import { PodcastStateMachine, WORKSPACE_VERSION } from "@notebook-lm/shared";
import {
  type FunctionComponent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LazySettingsDrawer as SettingsDrawer,
  LazyShareDialog as ShareDialog,
  LazySignInDialog as SignInDialog
} from "@/components/lazy/index.js";
import type { ChatMessage } from "@/components/panels/ChatPanel.js";
import {
  ChatPanel,
  isSourceUsable,
  LegalFooter,
  SOURCE_FILE_ACCEPT,
  SourcesPanel,
  StudioPanel
} from "@/components/panels/index.js";

import type { StudioTool } from "@/components/panels/StudioPanel.js";
import type { UserRole } from "@/components/ui/AppearanceControls.js";
import { AppearanceControls, BrandLogo, Icon, Toast } from "@/components/ui/index.js";
import type { ToastMessage } from "@/components/ui/Toast.js";
import { GraphViewer } from "@/components/viewers/index.js";
import {
  DEFAULT_CONTENT_LANGS,
  DEFAULT_FLASHCARDS,
  DEFAULT_MINDMAP,
  DEFAULT_NOTEBOOK_TITLE,
  DEFAULT_QUIZ,
  DEFAULT_SOURCES,
  DEFAULT_VIDEO_STORYBOARD,
  loadDemoEntityGraph,
  loadStructuredDemo
} from "@/data/index.js";
import type { StructuredData } from "@/data/structured-demo.js";
import {
  documentLanguage,
  useMediaQuery,
  useNotebookSync,
  useOfflineChat,
  useTheme
} from "@/hooks/index.js";

import { FOCUSABLE_SELECTOR, isModalOpen, trapTabKey } from "@/lib/a11y/index.js";
import { chatToMarkdown, triggerBrowserDownload } from "@/lib/export/index.js";

import { buildKnowledgeGraph } from "@/lib/graph/index.js";
import { afterSettled } from "@/lib/utils/index.js";
import {
  matchPanelShortcut,
  readChatId,
  readCollapsedPanels,
  readNotebookTitle,
  storeChatId,
  storeCollapsedPanels,
  storeNotebookTitle
} from "@/preferences/index.js";
import type { CollapsedPanels, CollapsiblePanel } from "@/preferences/layout-preferences.js";
import {
  ChatApiError,
  createPendingSource,
  defaultUploadSourceFile,
  errorKeyForStatus,
  fetchChatHistory,
  mapCitations,
  markSourceFailed,
  markSourceReady,
  type SourceFileUploader,
  streamChat,
  technicalErrorDetail,
  uploadErrorKey
} from "@/services/api/index.js";

import { signOutAndWipe, wipeLocalData } from "@/services/storage/index.js";

import { describeSyncStatus } from "@/services/sync/index.js";
import { browserStorage, readStoredModel, storeModel } from "@/theme/index.js";
import type {
  CitationLocation,
  PanelFocusAttributes,
  WorkspaceSource
} from "@/types/workspace-types.js";
import { AccountStatus } from "./AccountStatus.js";
import { NotebookTitle } from "./NotebookTitle.js";
import { PanelRail, PanelToggle, RailButton } from "./PanelRail.js";
import {
  COLUMN_IDS,
  NARROW_HEADER_QUERY,
  PANEL_TABS,
  type PanelTab,
  type Popover,
  RAIL_TOOLS,
  SINGLE_PANEL_QUERY
} from "./workspace-config.js";

export interface WorkspaceLayoutProps {
  readonly initialTool?: StudioTool | undefined;
  readonly initialPanelTab?: PanelTab | undefined;
  readonly notebookId?: string | undefined;
  /** Test-Hook: ersetzt fetch fuer den Chat-Client. */
  readonly chatFetch?: typeof fetch | undefined;
  /** Test-Hook: ersetzt Lesen, Hochladen und Indexieren einer Datei (P6). */
  readonly uploadSourceFile?: SourceFileUploader | undefined;
}

export function WorkspaceLayout({
  initialTool = "overview",
  initialPanelTab = "chat",
  notebookId = "nb_active",
  chatFetch,
  uploadSourceFile = defaultUploadSourceFile
}: WorkspaceLayoutProps) {
  const { theme, setTheme, colorMode, setColorMode, t, tf, language } = useTheme();
  const { offlineChat, offlineChatRef, online, loadOfflineChat } = useOfflineChat();
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
    handleStudioToolSelected(tool);
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
  const [structuredDemo, setStructuredDemo] = useState<StructuredData | undefined>(undefined);
  const structuredRequestedRef = useRef(false);
  /** Lädt Timeline, Tabelle und Infografik der Demo einmal, beim Bedarf oder nach dem Laden. */
  const ensureStructuredDemo = useCallback(() => {
    if (structuredRequestedRef.current) return;
    structuredRequestedRef.current = true;
    void loadStructuredDemo().then(setStructuredDemo);
  }, []);
  // Nicht im Weg des LCP: erst nach dem Laden, sofern kein Werkzeug sie früher braucht.
  useEffect(() => {
    if (initialTool === "timeline" || initialTool === "table" || initialTool === "infographic") {
      ensureStructuredDemo();
    }
    return afterSettled(ensureStructuredDemo);
  }, [ensureStructuredDemo, initialTool]);
  const handleStudioToolSelected = useCallback(
    (tool: StudioTool) => {
      if (tool === "timeline" || tool === "table" || tool === "infographic") ensureStructuredDemo();
    },
    [ensureStructuredDemo]
  );
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
    // Quellen in Verarbeitung oder mit Fehler bleiben abgewählt
    setSources((prev) => prev.map((s) => (isSourceUsable(s) ? { ...s, isSelected: selected } : s)));
  };

  /**
   * Eigene Dateien (P6): Platzhalter sofort zeigen, dann lesen, hochladen und indexieren.
   * Erst danach trägt die Quelle die Server-ID und ist für den Chat ausgewählt; ein
   * Fehlschlag bleibt mit Grund in der Liste stehen.
   */
  const handleUploadFiles = async (files: readonly File[]) => {
    const stamp = Date.now();
    const pending = files.map((file, idx) => createPendingSource(file, `src_up_${stamp}_${idx}`));
    setSources((prev) => [...prev, ...pending]);

    const results = await Promise.all(
      files.map(async (file, idx) => {
        const placeholder = pending[idx] as WorkspaceSource;
        try {
          const result = await uploadSourceFile(file, notebookId);
          setSources((prev) => markSourceReady(prev, placeholder.id, result));
          return true;
        } catch (error) {
          setSources((prev) => markSourceFailed(prev, placeholder.id, uploadErrorKey(error)));
          notify(tf("toastSourceFailed", { title: placeholder.title }));
          return false;
        }
      })
    );

    const added = pending.filter((_, idx) => results[idx]);
    const [first] = added;
    if (added.length === 1 && first) notify(tf("toastSourceAdded", { title: first.title }));
    else if (added.length > 1) notify(tf("toastSourcesAdded", { n: added.length }));
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

    const selectedIds = sources.filter((s) => s.isSelected && isSourceUsable(s)).map((s) => s.id);
    const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

    // Ohne Netz oder ohne erreichbaren Server: lokales Modell (Issue #346)
    const answerOffline = async (fallback: boolean) => {
      const local = offlineChatRef.current;
      if (!local) {
        updateMessage(assistantId, (m) => ({ ...m, error: t("errorOfflineNoModel") }));
        return;
      }
      if (fallback) notify(local.text("chatOfflineFallback", language));
      try {
        const result = await local.answer({
          question: text,
          sources,
          language,
          history: messages
            .filter((m) => m.id !== "msg_intro" && !m.error && m.role !== "system")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          signal: controller.signal,
          onStart: (offline) =>
            updateMessage(assistantId, (m) => ({
              ...m,
              content: "",
              error: undefined,
              errorDetail: undefined,
              modelUsed: offline.modelLabel,
              offline
            })),
          onText: (content) => updateMessage(assistantId, (m) => ({ ...m, content }))
        });
        if (result !== "answered") {
          const error = local.errorText(result, language);
          updateMessage(assistantId, (m) => ({ ...m, error, errorDetail: undefined }));
        }
      } catch (err) {
        if (isAbort(err)) updateMessage(assistantId, (m) => ({ ...m, aborted: true }));
        else {
          const error = local.errorText("failed", language);
          updateMessage(assistantId, (m) => ({ ...m, error, errorDetail: undefined }));
        }
      }
    };

    try {
      if (!navigator.onLine) {
        await answerOffline(false);
        return;
      }
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
      if (isAbort(err)) {
        updateMessage(assistantId, (m) => ({ ...m, aborted: true }));
      } else if (
        err instanceof ChatApiError &&
        err.status === 0 &&
        offlineChatRef.current?.canAnswer()
      ) {
        await answerOffline(true);
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
                  if (files.length > 0) void handleUploadFiles(files);
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
              modeSlot={
                offlineChat ? (
                  <offlineChat.Control online={online} onNotify={notify} />
                ) : (
                  <div className="rn-offline-chat rn-offline-chat--start">
                    <output
                      className="rn-chat-mode"
                      data-testid="chat-mode"
                      data-mode={online ? "online" : "offline-no-model"}
                    >
                      <span className="rn-chat-mode-dot" aria-hidden="true" />
                      {t(online ? "chatModeOnlineShort" : "chatModeOfflineNoModel")}
                    </output>
                    <button
                      type="button"
                      className="rn-btn rn-btn--ghost rn-btn--compact rn-offline-setup"
                      data-testid="btn-offline-chat-setup"
                      disabled={!online}
                      onClick={loadOfflineChat}
                    >
                      <Icon name="download" size={18} />
                      <span className="rn-offline-setup-label">{t("offlineChatSetup")}</span>
                    </button>
                  </div>
                )
              }
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
              onSelectTool={handleStudioToolSelected}
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
              structuredData={structuredDemo}
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

      {/* Datenschutz und Cookie-Einstellungen (Widerruf), jederzeit erreichbar (Issue #261) */}
      <LegalFooter />

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

            {/* Datenschutz und Cookie-Einstellungen; unter 600 px nur hier (Issue #261) */}
            <LegalFooter placement="sheet" onOpen={() => closeMenu(false)} />
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

export interface AppProps {
  readonly initialTool?: "overview" | "mindmap" | "flashcards" | "quiz" | undefined;
}

export const App: FunctionComponent<AppProps> = ({ initialTool = "overview" }: AppProps = {}) => {
  return <WorkspaceLayout initialTool={initialTool} />;
};
