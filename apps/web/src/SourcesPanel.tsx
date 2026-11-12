import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { Icon } from "./Icon.js";
import type { CitationLocation, WorkspaceSource } from "./workspace-types.js";

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
}

export function SourcesPanel({
  sources,
  activeCitation = null,
  onToggleSelect,
  onToggleSelectAll,
  onUploadFiles,
  onImportUrl,
  onClearActiveCitation
}: SourcesPanelProps) {
  const [filterText, setFilterText] = useState("");
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlTitleInput, setUrlTitleInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inspectedSourceId, setInspectedSourceId] = useState<string | null>(
    () => activeCitation?.sourceId ?? null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLElement>(null);
  const searchInputId = useId();
  const urlDialogTitleId = useId();

  // If activeCitation arrives or changes, open inspector for that source
  useEffect(() => {
    if (activeCitation?.sourceId) {
      setInspectedSourceId(activeCitation.sourceId);
    }
  }, [activeCitation]);

  // Scroll to highlighted citation passage
  useEffect(() => {
    if (inspectedSourceId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightRef.current.focus?.();
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

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    await onImportUrl?.(urlInput.trim(), urlTitleInput.trim() || undefined);
    setUrlInput("");
    setUrlTitleInput("");
    setIsUrlModalOpen(false);
  };

  const inspectedSource = sources.find((s) => s.id === inspectedSourceId);

  return (
    <section
      aria-label="Quellen-Panel"
      className="sources-panel rn-panel-body"
      data-testid="sources-panel"
    >
      <header className="rn-panel-head">
        <div className="rn-panel-heading">
          <h2>Quellen</h2>
          <p className="rn-panel-sub">Ausgewählte Quellen fließen in jede Antwort ein.</p>
        </div>
        <span data-testid="sources-count-badge" className="rn-count">
          {sources.length} {sources.length === 1 ? "Quelle" : "Quellen"}
        </span>
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
          Datei hochladen
        </button>
        <button
          type="button"
          onClick={() => setIsUrlModalOpen(true)}
          className="btn-import-url rn-btn rn-btn--secondary"
          data-testid="btn-open-url-dialog"
          aria-label="Link oder Google Docs importieren"
        >
          <Icon name="link" size={18} />
          Link
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
          hidden
          data-testid="file-upload-input"
          onChange={handleFileInputChange}
          aria-label="Dateien hochladen"
        />
      </div>

      {/* Ablagefläche: Ziehen ist optional, der Knopf oben erreicht dasselbe */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label="Datei-Dropzone"
        data-testid="dropzone-area"
        data-dragging={isDragging ? "true" : undefined}
        className="rn-dropzone"
      >
        <Icon name="file" size={22} />
        <div>
          <p className="rn-dropzone-title">Dateien hier ablegen</p>
          <small className="rn-dropzone-hint">PDF, TXT oder Markdown</small>
        </div>
      </section>

      {/* Filter */}
      <div className="rn-search">
        <label htmlFor={searchInputId} className="rn-visually-hidden">
          Quellen durchsuchen
        </label>
        <Icon name="search" size={18} className="rn-search-icon" />
        <input
          id={searchInputId}
          type="search"
          placeholder="Quellen filtern …"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          data-testid="sources-filter-input"
          className="rn-input rn-search-input"
        />
      </div>

      {sources.length > 0 && (
        <div className="rn-select-all">
          <input
            id="select-all-sources-checkbox"
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleSelectAll?.(e.target.checked)}
            data-testid="select-all-sources-checkbox"
            className="rn-checkbox"
          />
          <label htmlFor="select-all-sources-checkbox">Alle Quellen auswählen</label>
        </div>
      )}

      {/* Liste */}
      <ul aria-label="Hochgeladene Quellen" data-testid="sources-list" className="rn-sources">
        {filteredSources.length === 0 ? (
          <li data-testid="no-sources-message" className="rn-sources-empty">
            {sources.length === 0
              ? "Noch keine Quellen vorhanden. Laden Sie Dokumente hoch."
              : "Keine Quellen gefunden, die dem Filter entsprechen."}
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
                  <input
                    type="checkbox"
                    id={`source-checkbox-${source.id}`}
                    checked={isSelected}
                    onChange={() => onToggleSelect?.(source.id)}
                    aria-label={`Quelle ${source.title} für Chat auswählen`}
                    data-testid={`source-checkbox-${source.id}`}
                    className="rn-checkbox"
                  />
                  <span className="rn-source-type" aria-hidden="true">
                    {sourceTypeLabel(source.mimeType)}
                  </span>
                  <div className="rn-source-text">
                    <span className="rn-source-title">{source.title}</span>
                    <small className="rn-source-meta">
                      {source.originalName} · {Math.round(source.byteSize / 1024)} KB
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setInspectedSourceId(isInspected ? null : source.id)}
                  aria-label={`Quelle ${source.title} ${isInspected ? "schließen" : "ansehen"}`}
                  data-testid={`btn-inspect-source-${source.id}`}
                  title={isInspected ? "Schließen" : "Ansehen"}
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
          aria-label={`Quell-Inspektor: ${inspectedSource.title}`}
          data-testid="source-inspector-drawer"
          className="rn-inspector"
        >
          <div className="rn-inspector-head">
            <h3>{inspectedSource.title}</h3>
            <button
              type="button"
              onClick={() => {
                setInspectedSourceId(null);
                onClearActiveCitation?.();
              }}
              data-testid="btn-close-inspector"
              aria-label="Inspektor schließen"
              className="rn-icon-btn"
            >
              <Icon name="close" />
            </button>
          </div>

          {activeCitation && activeCitation.sourceId === inspectedSource.id && (
            <div className="rn-inspector-badge" data-testid="citation-active-badge">
              Fokussiertes Zitat {activeCitation.page ? `(Seite ${activeCitation.page})` : ""}
            </div>
          )}

          <div data-testid="inspector-source-content" className="rn-inspector-content">
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
              <span>
                {inspectedSource.rawText ??
                  "Kein Volltext hinterlegt. Dokumentinhalt wird im Viewer angezeigt."}
              </span>
            )}
          </div>
        </aside>
      )}

      {/* Link-Import */}
      {isUrlModalOpen && (
        <dialog
          open
          aria-labelledby={urlDialogTitleId}
          data-testid="url-import-dialog"
          className="rn-dialog"
          onKeyDown={(e: KeyboardEvent<HTMLDialogElement>) => {
            if (e.key === "Escape") {
              setIsUrlModalOpen(false);
            }
          }}
        >
          <div className="rn-dialog-card">
            <h3 id={urlDialogTitleId}>Web-Link oder Google Docs importieren</h3>
            <p className="rn-dialog-text">
              Geben Sie eine öffentlich zugängliche URL oder einen freigegebenen Google-Docs-Link
              ein.
            </p>

            <form onSubmit={handleUrlSubmit} className="rn-form">
              <div className="rn-field">
                <label htmlFor="url-title-input">Titel (optional)</label>
                <input
                  id="url-title-input"
                  type="text"
                  value={urlTitleInput}
                  onChange={(e) => setUrlTitleInput(e.target.value)}
                  placeholder="z. B. API-Dokumentation"
                  data-testid="url-title-input"
                  className="rn-input"
                />
              </div>

              <div className="rn-field">
                <label htmlFor="url-address-input">URL</label>
                <input
                  id="url-address-input"
                  type="url"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/document/d/…"
                  data-testid="url-address-input"
                  className="rn-input"
                />
              </div>

              <div className="rn-dialog-actions">
                <button
                  type="button"
                  onClick={() => setIsUrlModalOpen(false)}
                  data-testid="btn-cancel-url-dialog"
                  className="rn-btn rn-btn--secondary"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  data-testid="btn-submit-url-dialog"
                  className="rn-btn rn-btn--primary"
                >
                  Importieren
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
