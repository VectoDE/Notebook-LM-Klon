import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { CommentThread } from "./CommentThread.js";
import { EmptyState } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { ViewToggle } from "./ViewToggle.js";
import type { FetchLike } from "./comments-client.js";
import { trapTabKey } from "./focus-trap.js";
import { browserStorage, shouldReduceMotion } from "./theme-preferences.js";
import { type SourceUrlError, validateSourceUrl } from "./url-validation.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { useTheme } from "./useTheme.js";
import {
  type SourcesView,
  VIEW_STORAGE_KEYS,
  readSourcesView,
  storeView
} from "./view-preferences.js";
import type { CitationLocation, PanelFocusAttributes, WorkspaceSource } from "./workspace-types.js";

export interface SourcesPanelProps {
  readonly sources: readonly WorkspaceSource[];
  readonly activeCitation?: CitationLocation | null | undefined;
  readonly onToggleSelect?: ((sourceId: string) => void) | undefined;
  readonly onToggleSelectAll?: ((selected: boolean) => void) | undefined;
  readonly onUploadFiles?: ((files: readonly File[]) => void | Promise<void>) | undefined;
  readonly onImportUrl?:
    | ((url: string, title?: string | undefined) => void | Promise<void>)
    | undefined;
  readonly onClearActiveCitation?: (() => void) | undefined;
  /** Fokusziel für die Bereichsnavigation (data-panel, tabIndex). */
  readonly panelAttributes?: PanelFocusAttributes | undefined;
  /** Bedienelement am Spaltenrand im Kopf, z. B. der Knopf zum Einklappen (Issue #325). */
  readonly headerAction?: ReactNode | undefined;
  /** Notebook der Quellen; mit ID zeigt der Inspektor den Kommentar-Faden (Issue #353). */
  readonly notebookId?: string | undefined;
  /** Abrufe für Kommentare (Tests); Standard ist fetch. */
  readonly commentsFetch?: FetchLike | undefined;
}

/** Erlaubte Dateiarten beim Hochladen (auch für den Knopf in der eingeklappten Leiste). */
export const SOURCE_FILE_ACCEPT = ".pdf,.txt,.md,text/plain,text/markdown,application/pdf";

export function SourcesPanel({
  sources,
  activeCitation = null,
  onToggleSelect,
  onToggleSelectAll,
  onUploadFiles,
  onImportUrl,
  onClearActiveCitation,
  panelAttributes,
  headerAction,
  notebookId,
  commentsFetch
}: SourcesPanelProps) {
  const { t, tf } = useTheme();
  const [filterText, setFilterText] = useState("");
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlTitleInput, setUrlTitleInput] = useState("");
  const [urlError, setUrlError] = useState<SourceUrlError | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Liste mit Haken oder Karten; die Wahl bleibt auf dem Gerät (Issue #329)
  const [view, setView] = useState<SourcesView>(() => readSourcesView(browserStorage()));
  const [inspectedSourceId, setInspectedSourceId] = useState<string | null>(
    () => activeCitation?.sourceId ?? null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const urlDialogRef = useRef<HTMLDialogElement>(null);
  const urlButtonRef = useRef<HTMLButtonElement>(null);
  const urlAddressRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();
  const urlDialogTitleId = useId();
  const urlErrorId = useId();

  // Vor showModal(): Auslöser merken, nach dem Schließen dorthin zurück (#314)
  useReturnFocus(isUrlModalOpen, () => urlButtonRef.current);

  // Modal öffnen: Hintergrund wird inert, Escape löst "cancel" aus, Fokus ins URL-Feld.
  useEffect(() => {
    const dialog = urlDialogRef.current;
    if (isUrlModalOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
      urlAddressRef.current?.focus();
    }
  }, [isUrlModalOpen]);

  // If activeCitation arrives or changes, open inspector for that source
  useEffect(() => {
    if (activeCitation?.sourceId) {
      setInspectedSourceId(activeCitation.sourceId);
    }
  }, [activeCitation]);

  // Zur markierten Zitatstelle scrollen; ohne Markierung die Vorschau ins Bild holen
  // (die Liste scrollt mit dem Panel, die Vorschau steht darunter; Issue #335)
  useEffect(() => {
    if (!inspectedSourceId) return;
    // "Bewegung reduzieren" springt ohne Animation (WCAG 2.3.3, Issue #323)
    const behavior = shouldReduceMotion(document.documentElement, window.matchMedia?.bind(window))
      ? "auto"
      : "smooth";
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior, block: "center" });
      highlightRef.current.focus?.();
    } else {
      inspectorRef.current?.scrollIntoView?.({ behavior, block: "nearest" });
    }
  }, [inspectedSourceId]);

  const filteredSources = sources.filter((s) =>
    s.title.toLowerCase().includes(filterText.toLowerCase())
  );

  const allSelected = sources.length > 0 && sources.every((s) => s.isSelected !== false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
    if (droppedFiles.length > 0) {
      onUploadFiles?.(droppedFiles);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length > 0) {
      onUploadFiles?.(selectedFiles);
    }
    // reset input value so re-uploading same file triggers change
    e.target.value = "";
  };

  const closeUrlDialog = () => {
    setUrlError(null);
    setIsUrlModalOpen(false);
  };

  // Eigene Fehlermeldung statt Browserblase; der Fokus bleibt im URL-Feld (Issue #323)
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateSourceUrl(urlInput);
    setUrlError(error);
    if (error) {
      urlAddressRef.current?.focus();
      return;
    }
    await onImportUrl?.(urlInput.trim(), urlTitleInput.trim() || undefined);
    setUrlInput("");
    setUrlTitleInput("");
    closeUrlDialog();
  };

  const inspectedSource = sources.find((s) => s.id === inspectedSourceId);

  const changeView = (next: SourcesView) => {
    setView(next);
    storeView(browserStorage(), VIEW_STORAGE_KEYS.sources, next);
  };

  return (
    <section
      aria-label={t("srcPanelLabel")}
      className="sources-panel rn-panel-body"
      data-testid="sources-panel"
      {...panelAttributes}
    >
      <header className="rn-panel-head">
        <div className="rn-panel-heading">
          {/* Zähler neben dem Titel: der Rand bleibt frei für den Knopf zum Einklappen */}
          <div className="rn-panel-title-row">
            <h2>{t("sourcesTitle")}</h2>
            <span data-testid="sources-count-badge" className="rn-count">
              {tf(sources.length === 1 ? "srcCountOne" : "srcCountMany", { n: sources.length })}
            </span>
          </div>
          <p className="rn-panel-sub rn-panel-sub--help">{t("srcSub")}</p>
        </div>
        {headerAction}
      </header>

      {/* Hochladen und Importieren */}
      <div className="rn-source-actions">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="btn-upload rn-btn rn-btn--primary"
          data-testid="btn-upload-file"
        >
          <Icon name="upload" size={18} />
          {t("srcUpload")}
        </button>
        <button
          ref={urlButtonRef}
          type="button"
          onClick={() => setIsUrlModalOpen(true)}
          className="btn-import-url rn-btn rn-btn--secondary"
          data-testid="btn-open-url-dialog"
          aria-label={t("srcLinkAria")}
        >
          <Icon name="link" size={18} />
          {t("srcLink")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SOURCE_FILE_ACCEPT}
          hidden
          data-testid="file-upload-input"
          onChange={handleFileInputChange}
          aria-label={t("srcFileInputAria")}
        />
      </div>

      {/* Ablagefläche: Ziehen ist optional, der Knopf oben erreicht dasselbe */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label={t("srcDropzoneLabel")}
        data-testid="dropzone-area"
        data-dragging={isDragging ? "true" : undefined}
        className="rn-dropzone"
      >
        <Icon name="file" size={22} />
        <div>
          <p className="rn-dropzone-title">{t("srcDropTitle")}</p>
          <small className="rn-dropzone-hint">{t("srcDropHint")}</small>
        </div>
      </section>

      {/* Filter */}
      <div className="rn-search">
        <label htmlFor={searchInputId} className="rn-visually-hidden">
          {t("srcSearchLabel")}
        </label>
        <Icon name="search" size={18} className="rn-search-icon" />
        <input
          id={searchInputId}
          ref={searchInputRef}
          type="search"
          placeholder={t("srcSearchPlaceholder")}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          data-testid="sources-filter-input"
          className="rn-input rn-search-input"
        />
      </div>

      {sources.length > 0 && (
        <div className="rn-sources-toolbar">
          {/* Ganze Zeile ist das Label: Trefferfläche 44 px hoch (WCAG 2.5.5, Issue #315) */}
          <label className="rn-select-all" htmlFor="select-all-sources-checkbox">
            <input
              id="select-all-sources-checkbox"
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleSelectAll?.(e.target.checked)}
              data-testid="select-all-sources-checkbox"
              className="rn-checkbox"
            />
            <span>{t("srcSelectAll")}</span>
          </label>
          <ViewToggle
            label={t("viewToggleSources")}
            value={view}
            onChange={changeView}
            testId="sources-view-toggle"
            options={[
              { value: "list", label: t("viewList"), icon: "list" },
              { value: "cards", label: t("viewCards"), icon: "grid" }
            ]}
          />
        </div>
      )}

      {/* Liste */}
      <ul
        aria-label={t("srcListLabel")}
        data-testid="sources-list"
        data-view={filteredSources.length > 0 ? view : undefined}
        className="rn-sources"
      >
        {filteredSources.length === 0 ? (
          <li data-testid="no-sources-message" className="rn-sources-empty">
            {sources.length === 0 ? (
              <EmptyState
                art="sources"
                title={t("srcEmptyNoneTitle")}
                text={t("srcEmptyNoneText")}
              />
            ) : (
              <EmptyState
                art="filter"
                title={t("srcEmptyFilterTitle")}
                text={tf("srcEmptyFilterText", { query: filterText.trim() })}
                compact
              >
                <button
                  type="button"
                  onClick={() => {
                    // Der Knopf verschwindet mit dem Leerzustand: Fokus zurück ins Suchfeld
                    setFilterText("");
                    searchInputRef.current?.focus();
                  }}
                  data-testid="btn-clear-sources-filter"
                  className="rn-btn rn-btn--secondary"
                >
                  {t("srcClearFilter")}
                </button>
              </EmptyState>
            )}
          </li>
        ) : (
          filteredSources.map((source) => {
            const isSelected = source.isSelected !== false;
            const isInspected = inspectedSourceId === source.id;

            return (
              <li
                key={source.id}
                data-testid={`source-item-${source.id}`}
                data-inspected={isInspected ? "true" : undefined}
                className="rn-source"
              >
                <div className="rn-source-main">
                  {/* Label als 44-px-Trefferfläche um das 20-px-Kästchen (Issue #315) */}
                  <label
                    className="rn-check-hit"
                    htmlFor={`source-checkbox-${source.id}`}
                    data-testid={`source-check-hit-${source.id}`}
                  >
                    <input
                      type="checkbox"
                      id={`source-checkbox-${source.id}`}
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(source.id)}
                      aria-label={tf("srcSelectAria", { title: source.title })}
                      data-testid={`source-checkbox-${source.id}`}
                      className="rn-checkbox"
                    />
                  </label>
                  <div className="rn-source-text">
                    <span className="rn-source-title" lang={source.lang}>
                      {source.title}
                    </span>
                    <small className="rn-source-meta">
                      <span className="rn-source-type" aria-hidden="true">
                        {sourceTypeLabel(source.mimeType)}
                      </span>
                      {source.originalName} ·{" "}
                      <span className="rn-source-size">
                        {Math.round(source.byteSize / 1024)} KB
                      </span>
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setInspectedSourceId(isInspected ? null : source.id)}
                  aria-label={tf(isInspected ? "srcCloseAria" : "srcViewAria", {
                    title: source.title
                  })}
                  data-testid={`btn-inspect-source-${source.id}`}
                  title={t(isInspected ? "srcClose" : "srcView")}
                  className="rn-icon-btn rn-source-inspect"
                >
                  <Icon name={isInspected ? "close" : "eye"} />
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Quell-Inspektor */}
      {inspectedSource && (
        <aside
          ref={inspectorRef}
          aria-label={tf("srcInspectorLabel", { title: inspectedSource.title })}
          data-testid="source-inspector-drawer"
          className="rn-inspector"
        >
          <div className="rn-inspector-head">
            <h3 lang={inspectedSource.lang}>{inspectedSource.title}</h3>
            <button
              type="button"
              onClick={() => {
                setInspectedSourceId(null);
                onClearActiveCitation?.();
              }}
              data-testid="btn-close-inspector"
              aria-label={t("srcInspectorClose")}
              className="rn-icon-btn"
            >
              <Icon name="close" />
            </button>
          </div>

          {activeCitation && activeCitation.sourceId === inspectedSource.id && (
            <div className="rn-inspector-badge" data-testid="citation-active-badge">
              {t("srcCitationFocus")}{" "}
              {activeCitation.page ? tf("srcCitationPage", { page: activeCitation.page }) : ""}
            </div>
          )}

          <div
            data-testid="inspector-source-content"
            className="rn-inspector-content"
            lang={inspectedSource.rawText ? inspectedSource.lang : undefined}
          >
            {activeCitation?.quote &&
            inspectedSource.rawText &&
            inspectedSource.rawText.includes(activeCitation.quote) ? (
              (() => {
                const parts = inspectedSource.rawText.split(activeCitation.quote);
                return (
                  <>
                    <span>{parts[0]}</span>
                    <mark
                      ref={highlightRef}
                      tabIndex={-1}
                      data-testid="highlighted-citation-passage"
                      className="rn-inspector-mark"
                    >
                      {activeCitation.quote}
                    </mark>
                    <span>{parts.slice(1).join(activeCitation.quote)}</span>
                  </>
                );
              })()
            ) : (
              <span>{inspectedSource.rawText ?? t("srcNoFulltext")}</span>
            )}
          </div>

          {notebookId && (
            <CommentThread
              key={inspectedSource.id}
              notebookId={notebookId}
              targetType="source"
              targetId={inspectedSource.id}
              targetTitle={inspectedSource.title}
              fetchFn={commentsFetch}
            />
          )}
        </aside>
      )}

      {/* Link-Import */}
      {isUrlModalOpen && (
        <dialog
          ref={urlDialogRef}
          aria-labelledby={urlDialogTitleId}
          data-testid="url-import-dialog"
          className="rn-dialog"
          onCancel={(e) => {
            e.preventDefault();
            closeUrlDialog();
          }}
          // Tab läuft im Dialog um, statt in die Browserleiste zu springen
          onKeyDown={(e) => {
            if (urlDialogRef.current) trapTabKey(e, urlDialogRef.current, document.activeElement);
          }}
        >
          <div className="rn-dialog-card">
            <h3 id={urlDialogTitleId}>{t("srcDialogTitle")}</h3>
            <p className="rn-dialog-text">{t("srcDialogText")}</p>

            <form onSubmit={handleUrlSubmit} className="rn-form" noValidate>
              <div className="rn-field">
                <label htmlFor="url-title-input">{t("srcTitleLabel")}</label>
                <input
                  id="url-title-input"
                  type="text"
                  value={urlTitleInput}
                  onChange={(e) => setUrlTitleInput(e.target.value)}
                  placeholder={t("srcTitlePlaceholder")}
                  data-testid="url-title-input"
                  className="rn-input"
                />
              </div>

              <div className="rn-field">
                <label htmlFor="url-address-input">{t("srcUrlLabel")}</label>
                <input
                  id="url-address-input"
                  ref={urlAddressRef}
                  type="url"
                  required
                  aria-invalid={urlError ? "true" : undefined}
                  aria-describedby={urlError ? urlErrorId : undefined}
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    // Nach einer Korrektur verschwindet die Meldung, sobald die Adresse passt
                    if (urlError) setUrlError(validateSourceUrl(e.target.value));
                  }}
                  placeholder="https://docs.google.com/document/d/…"
                  data-testid="url-address-input"
                  className="rn-input"
                />
                {urlError && (
                  <p id={urlErrorId} data-testid="url-address-error" className="rn-field-error">
                    {t(urlError)}
                  </p>
                )}
              </div>

              <div className="rn-dialog-actions">
                <button
                  type="button"
                  onClick={closeUrlDialog}
                  data-testid="btn-cancel-url-dialog"
                  className="rn-btn rn-btn--secondary"
                >
                  {t("srcCancel")}
                </button>
                <button
                  type="submit"
                  data-testid="btn-submit-url-dialog"
                  className="rn-btn rn-btn--primary"
                >
                  {t("srcImport")}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </section>
  );
}

/** Kurzes Kürzel für die Dateiart, rein visuell (der Dateiname steht daneben). */
function sourceTypeLabel(mimeType: string): string {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("markdown")) return "MD";
  if (mimeType.includes("html")) return "WEB";
  return "TXT";
}
