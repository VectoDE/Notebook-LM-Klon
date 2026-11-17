import type { PodcastStateMachine } from "@notebook-lm/shared";
import { type Dispatch, type SetStateAction, useRef } from "react";
import type { ChatMessage } from "@/components/panels/ChatPanel.js";
import {
  ChatPanel,
  SOURCE_FILE_ACCEPT,
  SourcesPanel,
  StudioPanel
} from "@/components/panels/index.js";
import type { OfflineChat } from "@/components/panels/offline-chat-ui.js";
import type { StudioTool } from "@/components/panels/StudioPanel.js";
import { Icon } from "@/components/ui/index.js";
import { GraphViewer } from "@/components/viewers/index.js";
import {
  DEFAULT_CONTENT_LANGS,
  DEFAULT_FLASHCARDS,
  DEFAULT_MINDMAP,
  DEFAULT_QUIZ,
  DEFAULT_VIDEO_STORYBOARD,
  loadDemoEntityGraph
} from "@/data/index.js";
import type { StructuredData } from "@/data/structured-demo.js";
import { useTheme } from "@/hooks/index.js";
import type { KnowledgeGraph } from "@/lib/graph/knowledge-graph.js";
import type { CollapsiblePanel } from "@/preferences/layout-preferences.js";
import type {
  CitationLocation,
  PanelFocusAttributes,
  WorkspaceSource
} from "@/types/workspace-types.js";
import { PanelRail, PanelToggle, RailButton } from "./PanelRail.js";
import { COLUMN_IDS, type PanelTab, RAIL_TOOLS } from "./workspace-config.js";

export interface WorkspaceColumnsProps {
  readonly notebookId: string;
  readonly notebookTitle: string;
  readonly initialTool: StudioTool;
  readonly isSinglePanel: boolean;
  readonly activeMobileTab: PanelTab;
  readonly isGraphOpen: boolean;
  readonly sourcesCollapsed: boolean;
  readonly studioCollapsed: boolean;
  readonly togglePanel: (panel: CollapsiblePanel) => void;
  readonly goToPanel: (tab: PanelTab) => void;
  readonly panelAttributes: (tab: PanelTab) => PanelFocusAttributes;
  readonly sources: WorkspaceSource[];
  readonly activeCitation: CitationLocation | null;
  readonly setActiveCitation: Dispatch<SetStateAction<CitationLocation | null>>;
  readonly handleToggleSelectSource: (id: string) => void;
  readonly handleToggleSelectAllSources: (selected: boolean) => void;
  readonly handleUploadFiles: (files: readonly File[]) => Promise<void>;
  readonly handleImportUrl: (url: string, title?: string) => void;
  readonly chatMessages: ChatMessage[];
  readonly activeModel: string;
  readonly isGenerating: boolean;
  readonly handleSendMessage: (text: string) => Promise<void>;
  readonly handleStopChat: () => void;
  readonly handleRetryChat: () => void;
  readonly handleExportChat: () => void;
  readonly handleCitationClick: (citation: CitationLocation) => void;
  readonly offlineChat: OfflineChat | null;
  readonly online: boolean;
  readonly loadOfflineChat: () => void;
  readonly notify: (message: string) => void;
  readonly knowledgeGraph: KnowledgeGraph;
  readonly jumpToSourceFromGraph: (sourceId: string) => void;
  readonly jumpToCitationFromGraph: (citation: CitationLocation) => void;
  readonly handleStudioToolSelected: (tool: StudioTool) => void;
  readonly openStudioTool: (tool: StudioTool) => void;
  readonly studioToolRequest: { readonly tool: StudioTool } | undefined;
  readonly audioStateMachine: PodcastStateMachine;
  readonly structuredDemo: StructuredData | undefined;
}

/** Die drei Spalten Quellen, Chat (oder Wissensgraph) und Studio mit ihren Leisten. */
export function WorkspaceColumns({
  notebookId,
  notebookTitle,
  initialTool,
  isSinglePanel,
  activeMobileTab,
  isGraphOpen,
  sourcesCollapsed,
  studioCollapsed,
  togglePanel,
  goToPanel,
  panelAttributes,
  sources,
  activeCitation,
  setActiveCitation,
  handleToggleSelectSource,
  handleToggleSelectAllSources,
  handleUploadFiles,
  handleImportUrl,
  chatMessages,
  activeModel,
  isGenerating,
  handleSendMessage,
  handleStopChat,
  handleRetryChat,
  handleExportChat,
  handleCitationClick,
  offlineChat,
  online,
  loadOfflineChat,
  notify,
  knowledgeGraph,
  jumpToSourceFromGraph,
  jumpToCitationFromGraph,
  handleStudioToolSelected,
  openStudioTool,
  studioToolRequest,
  audioStateMachine,
  structuredDemo
}: WorkspaceColumnsProps) {
  const { t } = useTheme();
  const railFileInputRef = useRef<HTMLInputElement>(null);
  return (
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
  );
}
