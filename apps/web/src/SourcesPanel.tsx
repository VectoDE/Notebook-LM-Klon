import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
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
      className="sources-panel"
      data-testid="sources-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        background: "var(--rn-color-surface, #ffffff)",
        color: "var(--rn-color-text-primary, #0f172a)",
        borderRight: "1px solid var(--rn-color-border, #e2e8f0)",
        overflowY: "auto"
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px"
        }}
      >
        <h2 style={{ fontSize: "1.25rem", margin: 0, fontWeight: 700 }}>Quellen</h2>
        <span
          data-testid="sources-count-badge"
          style={{
            fontSize: "0.85rem",
            padding: "2px 8px",
            borderRadius: "12px",
            background: "var(--rn-color-surface-variant, #f1f5f9)",
            color: "var(--rn-color-text-secondary, #64748b)"
          }}
        >
          {sources.length} {sources.length === 1 ? "Quelle" : "Quellen"}
        </span>
      </header>

      {/* Upload & Import Actions */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="btn-upload"
          data-testid="btn-upload-file"
          style={{
            flex: 1,
            minHeight: "44px",
            padding: "8px 12px",
            borderRadius: "8px",
            background: "var(--rn-color-primary, #2563eb)",
            color: "#ffffff",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.9rem"
          }}
        >
          + Datei hochladen
        </button>
        <button
          type="button"
          onClick={() => setIsUrlModalOpen(true)}
          className="btn-import-url"
          data-testid="btn-open-url-dialog"
          style={{
            flex: 1,
            minHeight: "44px",
            padding: "8px 12px",
            borderRadius: "8px",
            background: "var(--rn-color-surface-variant, #f1f5f9)",
            color: "var(--rn-color-text-primary, #0f172a)",
            border: "1px solid var(--rn-color-border, #cbd5e1)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.9rem"
          }}
        >
          Link / Docs Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
          style={{ display: "none" }}
          data-testid="file-upload-input"
          onChange={handleFileInputChange}
          aria-label="Dateien hochladen"
        />
      </div>

      {/* Drag & Drop Dropzone */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label="Datei-Dropzone"
        data-testid="dropzone-area"
        style={{
          border: isDragging
            ? "2px dashed var(--rn-color-primary, #2563eb)"
            : "2px dashed var(--rn-color-border, #cbd5e1)",
          background: isDragging
            ? "rgba(37, 99, 235, 0.08)"
            : "var(--rn-color-surface-variant, #f8fafc)",
          borderRadius: "8px",
          padding: "16px",
          textAlign: "center",
          marginBottom: "16px",
          transition: "background 150ms ease, border-color 150ms ease"
        }}
      >
        <p style={{ margin: "0 0 6px 0", fontSize: "0.85rem", fontWeight: 600 }}>
          Dateien hier ablegen (.pdf, .txt, .md)
        </p>
        <small style={{ color: "var(--rn-color-text-secondary, #64748b)" }}>
          oder Button oben nutzen (barrierefrei ohne Drag-Zwang)
        </small>
      </section>

      {/* Search Filter & Select All */}
      <div style={{ marginBottom: "12px" }}>
        <label htmlFor={searchInputId} style={{ display: "none" }}>
          Quellen durchsuchen
        </label>
        <input
          id={searchInputId}
          type="search"
          placeholder="Quellen filtern..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          data-testid="sources-filter-input"
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: "44px",
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--rn-color-border, #cbd5e1)",
            background: "var(--rn-color-background, #ffffff)",
            color: "var(--rn-color-text-primary, #0f172a)",
            fontSize: "0.9rem"
          }}
        />
      </div>

      {sources.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 0",
            marginBottom: "8px",
            borderBottom: "1px solid var(--rn-color-border, #e2e8f0)"
          }}
        >
          <input
            id="select-all-sources-checkbox"
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleSelectAll?.(e.target.checked)}
            data-testid="select-all-sources-checkbox"
            style={{ width: "18px", height: "18px", cursor: "pointer" }}
          />
          <label
            htmlFor="select-all-sources-checkbox"
            style={{ fontSize: "0.85rem", cursor: "pointer", fontWeight: 500 }}
          >
            Alle Quellen auswählen
          </label>
        </div>
      )}

      {/* Sources List */}
      <ul
        aria-label="Hochgeladene Quellen"
        data-testid="sources-list"
        style={{ listStyle: "none", padding: 0, margin: 0, flex: 1, overflowY: "auto" }}
      >
        {filteredSources.length === 0 ? (
          <li
            data-testid="no-sources-message"
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--rn-color-text-secondary, #64748b)",
              fontSize: "0.9rem"
            }}
          >
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  marginBottom: "6px",
                  background: isInspected
                    ? "rgba(37, 99, 235, 0.12)"
                    : "var(--rn-color-surface-variant, #f8fafc)",
                  border: isInspected
                    ? "1px solid var(--rn-color-primary, #2563eb)"
                    : "1px solid transparent"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                  <input
                    type="checkbox"
                    id={`source-checkbox-${source.id}`}
                    checked={isSelected}
                    onChange={() => onToggleSelect?.(source.id)}
                    aria-label={`Quelle ${source.title} für Chat auswählen`}
                    data-testid={`source-checkbox-${source.id}`}
                    style={{ width: "18px", height: "18px", cursor: "pointer" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "0.9rem",
                        color: "var(--rn-color-text-primary, #0f172a)"
                      }}
                    >
                      {source.title}
                    </span>
                    <small style={{ color: "var(--rn-color-text-secondary, #64748b)" }}>
                      {source.originalName} ({Math.round(source.byteSize / 1024)} KB)
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setInspectedSourceId(isInspected ? null : source.id)}
                  aria-label={`Quelle ${source.title} inspizieren`}
                  data-testid={`btn-inspect-source-${source.id}`}
                  style={{
                    minHeight: "36px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border, #cbd5e1)",
                    background: "var(--rn-color-surface, #ffffff)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 500
                  }}
                >
                  {isInspected ? "Schließen" : "Ansehen"}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Source Inspector Drawer */}
      {inspectedSource && (
        <aside
          aria-label={`Quell-Inspektor: ${inspectedSource.title}`}
          data-testid="source-inspector-drawer"
          style={{
            marginTop: "16px",
            padding: "16px",
            borderRadius: "8px",
            background: "var(--rn-color-surface-variant, #f1f5f9)",
            border: "1px solid var(--rn-color-border, #cbd5e1)",
            maxHeight: "260px",
            overflowY: "auto"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px"
            }}
          >
            <h3 style={{ fontSize: "1rem", margin: 0 }}>{inspectedSource.title}</h3>
            <button
              type="button"
              onClick={() => {
                setInspectedSourceId(null);
                onClearActiveCitation?.();
              }}
              data-testid="btn-close-inspector"
              aria-label="Inspektor schließen"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "1rem"
              }}
            >
              ×
            </button>
          </div>

          {activeCitation && activeCitation.sourceId === inspectedSource.id && (
            <div
              style={{
                marginBottom: "8px",
                padding: "6px 8px",
                borderRadius: "6px",
                background: "rgba(234, 179, 8, 0.2)",
                fontSize: "0.8rem",
                color: "#854d0e"
              }}
              data-testid="citation-active-badge"
            >
              Fokussiertes Zitat {activeCitation.page ? `(Seite ${activeCitation.page})` : ""}
            </div>
          )}

          <div
            data-testid="inspector-source-content"
            style={{ fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}
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
                      style={{
                        background: "var(--rn-color-highlight, #fef08a)",
                        color: "#713f12",
                        padding: "2px 4px",
                        borderRadius: "4px",
                        fontWeight: 600
                      }}
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

      {/* URL / Google Docs Import Modal */}
      {isUrlModalOpen && (
        <dialog
          open
          aria-labelledby={urlDialogTitleId}
          data-testid="url-import-dialog"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            width: "100%",
            height: "100%"
          }}
          onKeyDown={(e: KeyboardEvent<HTMLDialogElement>) => {
            if (e.key === "Escape") {
              setIsUrlModalOpen(false);
            }
          }}
        >
          <div
            style={{
              background: "var(--rn-color-surface, #ffffff)",
              color: "var(--rn-color-text-primary, #0f172a)",
              padding: "24px",
              borderRadius: "12px",
              maxWidth: "480px",
              width: "90%",
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)"
            }}
          >
            <h3 id={urlDialogTitleId} style={{ marginTop: 0, marginBottom: "12px" }}>
              Web-Link oder Google Docs importieren
            </h3>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--rn-color-text-secondary, #64748b)",
                marginBottom: "16px"
              }}
            >
              Geben Sie eine öffentlich zugängliche URL oder einen freigegebenen Google-Docs-Link
              ein.
            </p>

            <form onSubmit={handleUrlSubmit}>
              <div style={{ marginBottom: "12px" }}>
                <label
                  htmlFor="url-title-input"
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "4px"
                  }}
                >
                  Titel (optional):
                </label>
                <input
                  id="url-title-input"
                  type="text"
                  value={urlTitleInput}
                  onChange={(e) => setUrlTitleInput(e.target.value)}
                  placeholder="z.B. API Dokumentation"
                  data-testid="url-title-input"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: "40px",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border, #cbd5e1)"
                  }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label
                  htmlFor="url-address-input"
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "4px"
                  }}
                >
                  URL:
                </label>
                <input
                  id="url-address-input"
                  type="url"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/document/d/..."
                  data-testid="url-address-input"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: "40px",
                    padding: "8px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border, #cbd5e1)"
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsUrlModalOpen(false)}
                  data-testid="btn-cancel-url-dialog"
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--rn-color-border, #cbd5e1)",
                    background: "transparent",
                    cursor: "pointer"
                  }}
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  data-testid="btn-submit-url-dialog"
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--rn-color-primary, #2563eb)",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
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
