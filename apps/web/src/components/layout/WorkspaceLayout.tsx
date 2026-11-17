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
  useHeaderMenus,
  useMediaQuery,
  useNotebookSync,
  useOfflineChat,
  usePanelLayout,
  useTheme,
  useWorkspaceChat
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
import { MobileBottomNav } from "./MobileBottomNav.js";
import { MobileMenuSheet } from "./MobileMenuSheet.js";
import { NotebookTitle } from "./NotebookTitle.js";
import { PanelRail, PanelToggle, RailButton } from "./PanelRail.js";
import { TopNav } from "./TopNav.js";
import { WorkspaceColumns } from "./WorkspaceColumns.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";
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
  const {
    activeMobileTab,
    setActiveMobileTab,
    isGraphOpen,
    announcement,
    isCollapsed,
    setPanelCollapsed,
    togglePanel,
    goToPanel,
    panelAttributes
  } = usePanelLayout(initialPanelTab, isSinglePanel);

  const [sources, setSources] = useState<WorkspaceSource[]>(DEFAULT_SOURCES);
  const [activeCitation, setActiveCitation] = useState<CitationLocation | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  // Modellwahl übersteht das Neuladen (nur bekannte Werte, Issue #319)
  const [activeModel, setActiveModel] = useState<string>(() => readStoredModel(browserStorage()));
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
  // Hinweis-Leiste unten (Issue #329): Rückmeldung nach Export, neuer Quelle, Titel
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastCounter = useRef(0);
  const notify = useCallback((message: string) => {
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, message });
  }, []);
  const menus = useHeaderMenus(isNarrowHeader);
  const {
    tipsHidden,
    tipHandlers,
    openPopover,
    isMenuOpen,
    setIsMenuOpen,
    appearanceAnchorRef,
    accountAnchorRef,
    appearanceButtonRef,
    accountButtonRef,
    popoverPanelRef,
    menuButtonRef,
    settingsButtonRef,
    shareButtonRef,
    settingsFromAccountRef,
    sheetRef,
    togglePopover,
    closePopover,
    handlePopoverKeyDown,
    closeMenu,
    handleSheetKeyDown
  } = menus;
  const [userRole, setUserRole] = useState<UserRole>("owner");
  const railFileInputRef = useRef<HTMLInputElement>(null);

  const appearanceProps = {
    role: userRole,
    onRoleChange: setUserRole,
    theme,
    onThemeChange: setTheme,
    colorMode,
    onColorModeChange: setColorMode
  };

  /** Werkzeug aus der eingeklappten Studio-Leiste: Spalte ausklappen, Werkzeug öffnen. */
  const openStudioTool = (tool: StudioTool) => {
    setStudioToolRequest({ tool });
    handleStudioToolSelected(tool);
    goToPanel("studio");
  };

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

  // Audio State Machine
  const [audioStateMachine] = useState<PodcastStateMachine>(() => new PodcastStateMachine());

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
  const selectedIds = sources.filter((s) => s.isSelected && isSourceUsable(s)).map((s) => s.id);
  const {
    chatMessages,
    isGenerating,
    handleSendMessage,
    handleStopChat,
    handleRetryChat,
    handleExportChat
  } = useWorkspaceChat({
    notebookId,
    notebookTitle,
    chatFetch,
    sources,
    selectedIds,
    activeModel,
    offlineChatRef,
    notify
  });

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
      <WorkspaceHeader
        isNarrowHeader={isNarrowHeader}
        notebookTitle={notebookTitle}
        renameNotebook={renameNotebook}
        notebookSync={notebookSync}
        menus={menus}
        appearanceProps={appearanceProps}
        setIsShareOpen={setIsShareOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        setIsSignInOpen={setIsSignInOpen}
        signOut={signOut}
      />

      {/* Reiter 600 bis 899 px: nur hier ist genau ein Bereich sichtbar. Ab 900 px sind die
          Spalten die Navigation, unter 600 px liegt die Leiste unten (Issue #325). */}
      <TopNav
        isSinglePanel={isSinglePanel}
        activeMobileTab={activeMobileTab}
        sourceCount={sources.length}
        goToPanel={goToPanel}
      />

      {/* Main 3-Panel Workspace Container */}
      <WorkspaceColumns
        notebookId={notebookId}
        notebookTitle={notebookTitle}
        initialTool={initialTool}
        isSinglePanel={isSinglePanel}
        activeMobileTab={activeMobileTab}
        isGraphOpen={isGraphOpen}
        sourcesCollapsed={sourcesCollapsed}
        studioCollapsed={studioCollapsed}
        togglePanel={togglePanel}
        goToPanel={goToPanel}
        panelAttributes={panelAttributes}
        sources={sources}
        activeCitation={activeCitation}
        setActiveCitation={setActiveCitation}
        handleToggleSelectSource={handleToggleSelectSource}
        handleToggleSelectAllSources={handleToggleSelectAllSources}
        handleUploadFiles={handleUploadFiles}
        handleImportUrl={handleImportUrl}
        chatMessages={chatMessages}
        activeModel={activeModel}
        isGenerating={isGenerating}
        handleSendMessage={handleSendMessage}
        handleStopChat={handleStopChat}
        handleRetryChat={handleRetryChat}
        handleExportChat={handleExportChat}
        handleCitationClick={handleCitationClick}
        offlineChat={offlineChat}
        online={online}
        loadOfflineChat={loadOfflineChat}
        notify={notify}
        knowledgeGraph={knowledgeGraph}
        jumpToSourceFromGraph={jumpToSourceFromGraph}
        jumpToCitationFromGraph={jumpToCitationFromGraph}
        handleStudioToolSelected={handleStudioToolSelected}
        openStudioTool={openStudioTool}
        studioToolRequest={studioToolRequest}
        audioStateMachine={audioStateMachine}
        structuredDemo={structuredDemo}
      />

      {/* Datenschutz und Cookie-Einstellungen (Widerruf), jederzeit erreichbar (Issue #261) */}
      <LegalFooter />

      {/* Untere Reiterleiste (unter 600 px): im Daumenbereich, Symbol und Kurzname */}
      <MobileBottomNav
        activeMobileTab={activeMobileTab}
        sourceCount={sources.length}
        goToPanel={goToPanel}
      />

      {/* Meldungen für Screenreader: Spalte ein- oder ausgeklappt */}
      <output aria-live="polite" className="rn-visually-hidden" data-testid="layout-status">
        {announcement}
      </output>

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Mobiles Menü (unter 600 px): Vollbild-Sheet mit Teilen, Einstellungen, Konto, Darstellung */}
      {isNarrowHeader && (
        <MobileMenuSheet
          menus={menus}
          appearanceProps={appearanceProps}
          setIsShareOpen={setIsShareOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          setIsSignInOpen={setIsSignInOpen}
          signOut={signOut}
        />
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
