/**
 * Timeline, Infografik und Datentabelle (Issue #239).
 *
 * Alle drei zeigen KI-Vorschläge mit wörtlichem Zitat und Quelle. Der Mensch prüft jeden
 * Eintrag (bestätigen, ablehnen, wiederherstellen); abgelehnte Einträge fehlen in Grafik
 * und Export. „Im Quelltext zeigen“ springt zur markierten Stelle in der Quelle.
 * Der Prüfstand liegt beim Aufrufer (StudioPanel), damit ein Wechsel zu anderen Werkzeugen
 * nichts verliert.
 */

import {
  type DataTable,
  type InfographicFact,
  type ReviewStatus,
  type TimelineEntry,
  dataTableToCsv,
  renderInfographicSvg
} from "@notebook-lm/shared";
import { type ReactNode, useId } from "react";
import { Icon } from "./Icon.js";
import { triggerBrowserDownload } from "./artifact-exporters.js";
// Beleg- und Prüfstile teilt sich das Werkzeug mit dem Beziehungsgraphen (nachgeladen)
import "./entity-graph.css";
import "./structured-tools.css";
import { useTheme } from "./useTheme.js";
import type { CitationLocation } from "./workspace-types.js";

interface Evidence {
  readonly sourceId: string;
  readonly quote: string;
}

export interface CommonProps {
  readonly title: string;
  readonly sources: readonly { readonly id: string; readonly title: string }[];
  readonly contentLang?: string | undefined;
  readonly onCitationJump?: ((citation: CitationLocation) => void) | undefined;
  readonly onStatus: (id: string, status: ReviewStatus) => void;
  readonly onNotify?: ((message: string) => void) | undefined;
}

const STATUS_KEY: Readonly<Record<ReviewStatus, string>> = {
  suggested: "egStatusSuggested",
  confirmed: "egStatusConfirmed",
  rejected: "egStatusRejected"
};

function useSourceTitle(sources: CommonProps["sources"]) {
  const { t } = useTheme();
  return (id: string) => sources.find((s) => s.id === id)?.title ?? t("egUnknownSource");
}

/** Beleg mit Zitat, Quelle, Prüfstatus und Prüfknöpfen: für alle drei Werkzeuge gleich. */
function EvidenceBlock({
  id,
  name,
  status,
  evidence,
  testId,
  common
}: {
  readonly id: string;
  readonly name: string;
  readonly status: ReviewStatus;
  readonly evidence: Evidence;
  readonly testId: string;
  readonly common: CommonProps;
}) {
  const { t, tf } = useTheme();
  const sourceTitle = useSourceTitle(common.sources)(evidence.sourceId);
  const setStatus = (next: ReviewStatus) => {
    common.onStatus(id, next);
    common.onNotify?.(
      tf(
        next === "confirmed"
          ? "egAnnounceConfirmed"
          : next === "rejected"
            ? "egAnnounceRejected"
            : "egAnnounceRestored",
        { name }
      )
    );
  };
  return (
    <div className="rn-st-evidence">
      <p className="rn-eg-status" data-testid={`${testId}-status`}>
        {t(STATUS_KEY[status])}
      </p>
      <figure className="rn-eg-evidence">
        <blockquote lang={common.contentLang}>{evidence.quote}</blockquote>
        <figcaption>{tf("egEvidence", { title: sourceTitle })}</figcaption>
      </figure>
      <div className="rn-graph-actions">
        <button
          type="button"
          className="rn-btn rn-btn--secondary rn-btn--compact"
          data-testid={`${testId}-jump`}
          aria-label={tf("stShowQuoteAria", { title: sourceTitle, name })}
          onClick={() =>
            common.onCitationJump?.({ sourceId: evidence.sourceId, quote: evidence.quote })
          }
        >
          <Icon name="sources" size={18} />
          {t("egShowQuote")}
        </button>
        {status === "suggested" && (
          <button
            type="button"
            className="rn-btn rn-btn--secondary rn-btn--compact"
            data-testid={`${testId}-confirm`}
            aria-label={tf("egConfirmAria", { name })}
            onClick={() => setStatus("confirmed")}
          >
            {t("egConfirm")}
          </button>
        )}
        {status === "rejected" ? (
          <button
            type="button"
            className="rn-btn rn-btn--ghost rn-btn--compact"
            data-testid={`${testId}-restore`}
            aria-label={tf("egRestoreAria", { name })}
            onClick={() => setStatus("suggested")}
          >
            {t("egRestore")}
          </button>
        ) : (
          <button
            type="button"
            className="rn-btn rn-btn--ghost rn-btn--compact"
            data-testid={`${testId}-reject`}
            aria-label={tf("egRejectAria", { name })}
            onClick={() => setStatus("rejected")}
          >
            {t("egReject")}
          </button>
        )}
      </div>
    </div>
  );
}

function ToolHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="rn-st-head">
      <header className="rn-tool-view-head">
        <h2 className="rn-tool-view-title">{title}</h2>
        <span className="rn-tool-view-meta">{sub}</span>
      </header>
      {actions && <div className="rn-graph-actions">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

export function TimelineViewer({
  entries,
  ...common
}: CommonProps & { readonly entries: readonly TimelineEntry[] }) {
  const { t, tf } = useTheme();
  return (
    <div className="rn-st" data-testid="timeline-viewer">
      <ToolHead
        title={t("toolTimelineTitle")}
        sub={tf("stCount", {
          n: entries.length,
          open: entries.filter((e) => e.status === "suggested").length
        })}
      />
      <p className="rn-graph-hint">{t("stReviewHint")}</p>
      {entries.length === 0 ? (
        <p className="rn-graph-empty">{t("stTimelineEmpty")}</p>
      ) : (
        <ol className="rn-st-timeline">
          {entries.map((entry) => (
            <li key={entry.id} data-status={entry.status} data-testid={`timeline-${entry.id}`}>
              <p className="rn-st-date" lang={common.contentLang}>
                {entry.date}
              </p>
              <p className="rn-st-event" lang={common.contentLang}>
                {entry.event}
              </p>
              <EvidenceBlock
                id={entry.id}
                name={`${entry.date}: ${entry.event}`}
                status={entry.status}
                evidence={entry.evidence}
                testId={`timeline-${entry.id}`}
                common={common}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Datentabelle
   -------------------------------------------------------------------------- */

export function DataTableViewer({ table, ...common }: CommonProps & { readonly table: DataTable }) {
  const { t, tf } = useTheme();
  const captionId = useId();
  const sourceTitle = useSourceTitle(common.sources);
  const exportCsv = () => {
    const csv = dataTableToCsv(table, sourceTitle, {
      source: t("stColSource"),
      quote: t("stColQuote")
    });
    const filename = `${common.title}_tabelle.csv`;
    triggerBrowserDownload(filename, csv, "text/csv;charset=utf-8");
    common.onNotify?.(tf("toastDownload", { file: filename }));
  };
  return (
    <div className="rn-st" data-testid="datatable-viewer">
      <ToolHead
        title={t("toolTableTitle")}
        sub={tf("stCount", {
          n: table.rows.length,
          open: table.rows.filter((r) => r.status === "suggested").length
        })}
        actions={
          <button
            type="button"
            className="rn-btn rn-btn--secondary rn-btn--compact"
            data-testid="btn-export-table-csv"
            aria-label={t("stExportCsvAria")}
            onClick={exportCsv}
          >
            <Icon name="download" size={18} />
            {t("stExportCsv")}
          </button>
        }
      />
      <p className="rn-graph-hint">{t("stReviewHint")}</p>
      <div className="rn-st-table-wrap">
        <table className="rn-table rn-st-table" aria-labelledby={captionId} data-testid="datatable">
          <caption id={captionId} className="rn-visually-hidden">
            {t("toolTableTitle")}
          </caption>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column} scope="col" lang={common.contentLang}>
                  {column}
                </th>
              ))}
              <th scope="col">{t("stColSource")}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} data-status={row.status} data-testid={`datatable-${row.id}`}>
                {row.cells.map((cell, index) =>
                  index === 0 ? (
                    <th key={table.columns[index]} scope="row" lang={common.contentLang}>
                      {cell}
                    </th>
                  ) : (
                    <td key={table.columns[index]} lang={common.contentLang}>
                      {cell}
                    </td>
                  )
                )}
                <td>
                  <EvidenceBlock
                    id={row.id}
                    name={row.cells.filter(Boolean).join(", ")}
                    status={row.status}
                    evidence={row.evidence}
                    testId={`datatable-${row.id}`}
                    common={common}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length === 0 && <p className="rn-graph-empty">{t("stTableEmpty")}</p>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Infografik
   -------------------------------------------------------------------------- */

/** Zeichnet ein SVG (Text) auf ein Canvas und liefert PNG; nur im Browser. */
export async function svgStringToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 800);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 600);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG konnte nicht geladen werden"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kein Canvas-2D-Kontext");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG fehlgeschlagen"))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function InfographicViewer({
  facts,
  ...common
}: CommonProps & { readonly facts: readonly InfographicFact[] }) {
  const { t, tf } = useTheme();
  const sourceTitle = useSourceTitle(common.sources);
  const svg = renderInfographicSvg(facts, {
    title: common.title,
    lang: common.contentLang ?? "de",
    sourceTitle,
    sourcesLabel: t("stSourcesLabel"),
    emptyText: t("stInfographicEmpty")
  });
  const shown = facts.filter((f) => f.status !== "rejected");
  const alt = tf("stInfographicAlt", {
    title: common.title,
    facts: shown.map((f) => `${f.label}: ${f.value}`).join("; ") || t("stInfographicEmpty")
  });
  const notify = (filename: string) => common.onNotify?.(tf("toastDownload", { file: filename }));
  const exportSvg = () => {
    const filename = `${common.title}_infografik.svg`;
    triggerBrowserDownload(filename, svg, "image/svg+xml");
    notify(filename);
  };
  const exportPng = async () => {
    const blob = await svgStringToPngBlob(svg);
    const filename = `${common.title}_infografik.png`;
    triggerBrowserDownload(filename, blob, "image/png");
    notify(filename);
  };
  return (
    <div className="rn-st" data-testid="infographic-viewer">
      <ToolHead
        title={t("toolInfographicTitle")}
        sub={tf("stCount", {
          n: facts.length,
          open: facts.filter((f) => f.status === "suggested").length
        })}
        actions={
          <>
            <button
              type="button"
              className="rn-btn rn-btn--secondary rn-btn--compact"
              data-testid="btn-export-infographic-svg"
              aria-label={t("stExportSvgAria")}
              onClick={exportSvg}
            >
              <Icon name="download" size={18} />
              SVG
            </button>
            <button
              type="button"
              className="rn-btn rn-btn--secondary rn-btn--compact"
              data-testid="btn-export-infographic-png"
              aria-label={t("stExportPngAria")}
              onClick={() => void exportPng()}
            >
              <Icon name="download" size={18} />
              PNG
            </button>
          </>
        }
      />
      <figure className="rn-st-figure">
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={alt}
          data-testid="infographic-image"
          className="rn-st-image"
        />
      </figure>
      <p className="rn-graph-hint">{t("stReviewHint")}</p>
      <ul className="rn-graph-items">
        {facts.map((fact) => (
          <li
            key={fact.id}
            className="rn-graph-item"
            data-status={fact.status}
            data-testid={`infographic-${fact.id}`}
          >
            <p className="rn-graph-item-name" lang={common.contentLang}>
              <strong>{fact.value}</strong> <span>{fact.label}</span>
            </p>
            <EvidenceBlock
              id={fact.id}
              name={`${fact.label}: ${fact.value}`}
              status={fact.status}
              evidence={fact.evidence}
              testId={`infographic-${fact.id}`}
              common={common}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
