/**
 * Beziehungsgraph-Ansicht (Issue #238): Personen, Organisationen und Themen aus den Quellen.
 *
 * - Grafik: eigenes SVG, Form je Art (rund = Person, eckig = Organisation, leicht abgerundet
 *   = Thema), Linienart je Prüfstatus (durchgezogen = bestätigt, gestrichelt = zu prüfen).
 *   Ein Tab-Stopp, Pfeiltasten wandern räumlich, Eingabe/Leertaste zeigt Beziehungen und
 *   Zitate. Zoom und Einpassen.
 * - Filter nach Art und Prüfstatus gelten für Grafik und Liste.
 * - Liste: derselbe Inhalt als Text (WCAG 1.1.1) samt Prüfung: bestätigen, berichtigen,
 *   ablehnen. Jede Beziehung zeigt ihr wörtliches Zitat; „Im Quelltext zeigen“ springt zur
 *   markierten Stelle in der Quelle.
 */

import {
  DEFAULT_ENTITY_FILTER,
  ENTITY_KINDS,
  ENTITY_STATUS_FILTERS,
  type EntityCorrection,
  type EntityEdge,
  type EntityGraph,
  type EntityKind,
  type EntityNode,
  type EntityStatusFilter,
  type ReviewStatus,
  applyEntityCorrection,
  countByKind,
  edgesOf,
  filterEntityGraph
} from "@notebook-lm/shared";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Icon } from "./Icon.js";
import { announceKey, layoutEntityGraph } from "./entity-graph-view.js";
import "./entity-graph.css";
import {
  GRAPH_FONT_SIZE,
  GRAPH_PADDING,
  GRAPH_TABS,
  type GraphTab,
  LINE_HEIGHT,
  fitZoom,
  graphOffset,
  graphTabTarget,
  layoutModeFor,
  nodeInDirection,
  stepZoom
} from "./knowledge-graph.js";
import { useTheme } from "./useTheme.js";
import type { CitationLocation } from "./workspace-types.js";

export interface EntityGraphViewProps {
  readonly graph: EntityGraph;
  /** Titel der Quellen für die Belegzeile. */
  readonly sources: readonly { readonly id: string; readonly title: string }[];
  /** Sprache von Namen, Beziehungen und Zitaten (BCP 47), für lang (WCAG 3.1.2). */
  readonly contentLang?: string | undefined;
  readonly onCitationJump?: ((citation: CitationLocation) => void) | undefined;
  /** Meldet den geprüften Graphen nach jeder Korrektur (z. B. zum Speichern). */
  readonly onChange?: ((graph: EntityGraph) => void) | undefined;
}

const FIRST_BASELINE = 27;
const LABEL_X = 16;

const KIND_KEY: Readonly<Record<EntityKind, string>> = {
  person: "egKindPerson",
  organization: "egKindOrganization",
  topic: "egKindTopic"
};
const KINDS_KEY: Readonly<Record<EntityKind, string>> = {
  person: "egKindsPerson",
  organization: "egKindsOrganization",
  topic: "egKindsTopic"
};
const LEGEND_KEY: Readonly<Record<EntityKind, string>> = {
  person: "egLegendPerson",
  organization: "egLegendOrganization",
  topic: "egLegendTopic"
};
const STATUS_KEY: Readonly<Record<EntityStatusFilter, string>> = {
  open: "egStatusOpen",
  suggested: "egStatusSuggested",
  confirmed: "egStatusConfirmed",
  rejected: "egStatusRejected"
};
/** Ecken je Art: Form statt Farbe (WCAG 1.4.1). */
const RADIUS: Readonly<Record<EntityKind, (height: number) => number>> = {
  person: (h) => h / 2,
  organization: () => 2,
  topic: () => 10
};

type Editing =
  | { readonly type: "node"; readonly id: string; readonly name: string; readonly kind: EntityKind }
  | { readonly type: "edge"; readonly id: string; readonly relation: string }
  | null;

export function EntityGraphView({
  graph: initialGraph,
  sources,
  contentLang,
  onCitationJump,
  onChange
}: EntityGraphViewProps) {
  const { t, tf } = useTheme();
  const baseId = useId();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<GraphTab, HTMLButtonElement | null>>({ visual: null, list: null });
  const [graph, setGraph] = useState(initialGraph);
  const [kinds, setKinds] = useState<readonly EntityKind[]>(DEFAULT_ENTITY_FILTER.kinds);
  const [status, setStatus] = useState<EntityStatusFilter>(DEFAULT_ENTITY_FILTER.status);
  const [tab, setTab] = useState<GraphTab>("visual");
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [activeId, setActiveId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [announcement, setAnnouncement] = useState("");
  const focusNodeRef = useRef(false);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setCanvas({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visible = useMemo(
    () => filterEntityGraph(graph, { kinds, status }),
    [graph, kinds, status]
  );
  const mode = layoutModeFor(canvas.width);
  const layout = useMemo(() => layoutEntityGraph(visible, mode), [visible, mode]);
  const fitted = fitZoom(layout, canvas);
  const scale = zoom ?? fitted;
  const offset = graphOffset(layout.width, scale, canvas.width);
  const svgWidth = Math.max(
    canvas.width,
    Math.ceil(offset.x + layout.width * scale + GRAPH_PADDING)
  );
  const svgHeight = Math.ceil(layout.height * scale + 2 * GRAPH_PADDING);

  const firstId = layout.nodes[0]?.id ?? "";
  const current = layout.nodes.some((n) => n.id === activeId) ? activeId : firstId;
  const selected = visible.nodes.find((n) => n.id === selectedId);
  const nodeDomId = useCallback((id: string) => `${baseId}-entity-${id}`, [baseId]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const sourceTitle = (id: string) =>
    sources.find((s) => s.id === id)?.title ?? t("egUnknownSource");

  useEffect(() => {
    if (!focusNodeRef.current) return;
    focusNodeRef.current = false;
    document.getElementById(nodeDomId(current))?.focus();
  }, [current, nodeDomId]);

  const counts = countByKind(graph);
  const openCount =
    graph.nodes.filter((n) => n.status === "suggested").length +
    graph.edges.filter((e) => e.status === "suggested").length;

  const correct = (correction: EntityCorrection, message: string) => {
    const next = applyEntityCorrection(graph, correction);
    setGraph(next);
    onChange?.(next);
    setAnnouncement(message);
  };

  const setNodeStatus = (node: EntityNode, next: ReviewStatus) =>
    correct(
      { type: "setNodeStatus", id: node.id, status: next },
      tf(announceKey(node.status, next), { name: node.name })
    );

  const edgeName = (edge: EntityEdge) =>
    `${byId.get(edge.from)?.name ?? edge.from} – ${edge.relation} → ${byId.get(edge.to)?.name ?? edge.to}`;

  const setEdgeStatus = (edge: EntityEdge, next: ReviewStatus) =>
    correct(
      { type: "setEdgeStatus", id: edge.id, status: next },
      tf(announceKey(edge.status, next), { name: edgeName(edge) })
    );

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (editing.type === "node") {
      const node = byId.get(editing.id) as EntityNode;
      let next = applyEntityCorrection(graph, {
        type: "renameNode",
        id: editing.id,
        name: editing.name
      });
      if (editing.kind !== node.kind) {
        next = applyEntityCorrection(next, {
          type: "setNodeKind",
          id: editing.id,
          kind: editing.kind
        });
      }
      setGraph(next);
      onChange?.(next);
      setAnnouncement(
        tf("egAnnounceSaved", {
          name: (next.nodes.find((n) => n.id === editing.id) as EntityNode).name
        })
      );
    } else {
      correct(
        { type: "editEdgeRelation", id: editing.id, relation: editing.relation },
        tf("egAnnounceSaved", { name: editing.relation })
      );
    }
    setEditing(null);
  };

  const select = (id: string) => {
    setActiveId(id);
    setSelectedId(id);
  };

  const handleNodeKeyDown = (event: ReactKeyboardEvent, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(id);
      return;
    }
    const target = nodeInDirection(layout.nodes, id, event.key);
    if (!target) return;
    event.preventDefault();
    focusNodeRef.current = true;
    setActiveId(target);
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent) => {
    const target = graphTabTarget(tab, event.key);
    if (!target) return;
    event.preventDefault();
    setTab(target);
    tabRefs.current[target]?.focus();
  };

  const toggleKind = (kind: EntityKind) =>
    setKinds((prev) =>
      prev.includes(kind)
        ? prev.filter((k) => k !== kind)
        : ENTITY_KINDS.filter((k) => k === kind || prev.includes(k))
    );

  /** Beziehung mit Beleg und Sprung zur markierten Stelle in der Quelle. */
  const relationItem = (edge: EntityEdge, withReview: boolean, testPrefix: string) => {
    const title = sourceTitle(edge.evidence.sourceId);
    return (
      <li
        key={edge.id}
        className="rn-eg-relation"
        data-status={edge.status}
        data-testid={`${testPrefix}-${edge.id}`}
      >
        <p className="rn-eg-relation-line" lang={contentLang}>
          <strong>{byId.get(edge.from)?.name}</strong> <span>– {edge.relation} →</span>{" "}
          <strong>{byId.get(edge.to)?.name}</strong>
        </p>
        <p className="rn-eg-status">{t(STATUS_KEY[edge.status])}</p>
        <figure className="rn-eg-evidence">
          <blockquote lang={contentLang}>{edge.evidence.quote}</blockquote>
          <figcaption>{tf("egEvidence", { title })}</figcaption>
        </figure>
        <div className="rn-graph-actions">
          <button
            type="button"
            className="rn-btn rn-btn--secondary rn-graph-jump"
            data-testid={`${testPrefix}-jump-${edge.id}`}
            aria-label={tf("egShowQuoteAria", { title, relation: edgeName(edge) })}
            onClick={() =>
              onCitationJump?.({ sourceId: edge.evidence.sourceId, quote: edge.evidence.quote })
            }
          >
            <Icon name="sources" size={18} />
            {t("egShowQuote")}
          </button>
          {withReview &&
            reviewButtons(
              edge.status,
              edgeName(edge),
              `${testPrefix}-${edge.id}`,
              (next) => setEdgeStatus(edge, next),
              () => setEditing({ type: "edge", id: edge.id, relation: edge.relation })
            )}
        </div>
        {withReview && editing?.type === "edge" && editing.id === edge.id && (
          <form
            className="rn-eg-edit"
            onSubmit={saveEdit}
            data-testid={`${testPrefix}-${edge.id}-form`}
          >
            <label>
              {t("egRelationLabel")}
              <input
                type="text"
                value={editing.relation}
                maxLength={120}
                required
                lang={contentLang}
                // biome-ignore lint/a11y/noAutofocus: Fokus folgt der Aktion „Berichtigen“, der Nutzer hat das Feld eben geöffnet
                autoFocus
                onChange={(e) => setEditing({ ...editing, relation: e.target.value })}
              />
            </label>
            {editActions()}
          </form>
        )}
      </li>
    );
  };

  const editActions = () => (
    <div className="rn-graph-actions">
      <button type="submit" className="rn-btn rn-btn--primary rn-btn--compact">
        {t("egSave")}
      </button>
      <button
        type="button"
        className="rn-btn rn-btn--ghost rn-btn--compact"
        onClick={() => setEditing(null)}
      >
        {t("egCancel")}
      </button>
    </div>
  );

  const reviewButtons = (
    current: ReviewStatus,
    name: string,
    testId: string,
    onStatus: (next: ReviewStatus) => void,
    onEdit: () => void
  ) => (
    <>
      {current !== "confirmed" && current !== "rejected" && (
        <button
          type="button"
          className="rn-btn rn-btn--secondary rn-btn--compact"
          data-testid={`${testId}-confirm`}
          aria-label={tf("egConfirmAria", { name })}
          onClick={() => onStatus("confirmed")}
        >
          {t("egConfirm")}
        </button>
      )}
      {current === "rejected" ? (
        <button
          type="button"
          className="rn-btn rn-btn--secondary rn-btn--compact"
          data-testid={`${testId}-restore`}
          aria-label={tf("egRestoreAria", { name })}
          onClick={() => onStatus("suggested")}
        >
          {t("egRestore")}
        </button>
      ) : (
        <button
          type="button"
          className="rn-btn rn-btn--ghost rn-btn--compact"
          data-testid={`${testId}-reject`}
          aria-label={tf("egRejectAria", { name })}
          onClick={() => onStatus("rejected")}
        >
          {t("egReject")}
        </button>
      )}
      {current !== "rejected" && (
        <button
          type="button"
          className="rn-btn rn-btn--ghost rn-btn--compact"
          data-testid={`${testId}-edit`}
          aria-label={tf("egEditAria", { name })}
          onClick={onEdit}
        >
          {t("egEdit")}
        </button>
      )}
    </>
  );

  return (
    <div className="rn-tool-view rn-graph-view rn-eg rn-cinema-enter" data-testid="entity-graph">
      <p className="rn-panel-sub" data-testid="entity-graph-sub">
        {tf("egSub", {
          entities: graph.nodes.length,
          relations: graph.edges.length,
          open: openCount
        })}
      </p>
      <p className="rn-graph-hint">{t("egIntro")}</p>
      <output aria-live="polite" className="rn-visually-hidden" data-testid="entity-graph-live">
        {announcement}
      </output>

      <fieldset className="rn-eg-filter" data-testid="entity-graph-filter">
        <legend>{t("egFilterLegend")}</legend>
        <fieldset className="rn-eg-kinds">
          <legend>{t("egFilterKinds")}</legend>
          {ENTITY_KINDS.map((kind) => (
            <label key={kind} className="rn-eg-check">
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                data-testid={`entity-filter-${kind}`}
                onChange={() => toggleKind(kind)}
              />
              {tf("egKindCount", { label: t(KINDS_KEY[kind]), n: counts[kind] })}
            </label>
          ))}
        </fieldset>
        <label className="rn-eg-select">
          {t("egFilterStatus")}
          <select
            value={status}
            data-testid="entity-filter-status"
            onChange={(e) => setStatus(e.target.value as EntityStatusFilter)}
          >
            {ENTITY_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(STATUS_KEY[value])}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="rn-mindmap-toolbar" data-testid="entity-graph-toolbar">
        <div role="tablist" aria-label={t("mmViewLabel")} className="rn-seg-tabs">
          {GRAPH_TABS.map((id) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-${id}-tab`}
              aria-selected={tab === id}
              aria-controls={`${baseId}-${id}-panel`}
              tabIndex={tab === id ? 0 : -1}
              data-testid={`entity-tab-${id}`}
              className="rn-seg-tab"
              onClick={() => setTab(id)}
              onKeyDown={handleTabKeyDown}
            >
              {t(id === "visual" ? "mmTabVisual" : "graphTabList")}
            </button>
          ))}
        </div>
        {tab === "visual" && (
          <fieldset className="rn-zoom" aria-label={t("mmZoom")}>
            <button
              type="button"
              className="rn-icon-btn"
              aria-label={t("mmZoomOut")}
              data-testid="entity-zoom-out"
              onClick={() => setZoom(stepZoom(scale, -1))}
            >
              <span aria-hidden="true">−</span>
            </button>
            <output className="rn-zoom-value" aria-live="polite" data-testid="entity-zoom-value">
              {Math.round(scale * 100)} %
            </output>
            <button
              type="button"
              className="rn-icon-btn"
              aria-label={t("mmZoomIn")}
              data-testid="entity-zoom-in"
              onClick={() => setZoom(stepZoom(scale, 1))}
            >
              <span aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              className="rn-btn rn-btn--ghost rn-btn--compact"
              data-testid="entity-fit"
              onClick={() => {
                setZoom(null);
                canvasRef.current?.scrollTo({ left: 0, top: 0 });
              }}
            >
              {t("mmFit")}
            </button>
          </fieldset>
        )}
      </div>

      {visible.nodes.length === 0 && (
        <p className="rn-graph-empty" data-testid="entity-graph-empty">
          {t("egEmpty")}
        </p>
      )}

      <div
        id={`${baseId}-visual-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-visual-tab`}
        hidden={tab !== "visual"}
        className="rn-graph-visual"
      >
        <ul className="rn-graph-legend" aria-label={t("graphLegendLabel")}>
          {ENTITY_KINDS.map((kind) => (
            <li key={kind}>
              <svg aria-hidden="true" focusable="false" width="22" height="16">
                <rect
                  x="1"
                  y="1"
                  width="20"
                  height="14"
                  rx={RADIUS[kind](14)}
                  className="rn-graph-swatch"
                />
              </svg>
              {t(LEGEND_KEY[kind])}
            </li>
          ))}
          <li>
            <svg aria-hidden="true" focusable="false" width="28" height="12">
              <line x1="2" y1="6" x2="26" y2="6" className="rn-graph-edge" />
            </svg>
            {t("egLegendConfirmed")}
          </li>
          <li>
            <svg aria-hidden="true" focusable="false" width="28" height="12">
              <line
                x1="2"
                y1="6"
                x2="26"
                y2="6"
                className="rn-graph-edge"
                data-status="suggested"
              />
            </svg>
            {t("egLegendSuggested")}
          </li>
        </ul>

        <div ref={canvasRef} className="rn-graph-canvas" data-testid="entity-graph-canvas">
          <p id={`${baseId}-hint`} className="rn-visually-hidden">
            {t("egVisualHint")}
          </p>
          <svg
            data-testid="entity-graph-svg"
            data-layout={layout.mode}
            width={svgWidth}
            height={svgHeight}
            className="rn-graph-svg"
          >
            <title>{t("egSvgLabel")}</title>
            <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
              {layout.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  className="rn-graph-edge"
                  data-status={edge.status}
                  data-active={
                    selectedId !== null && (edge.from === selectedId || edge.to === selectedId)
                      ? "true"
                      : undefined
                  }
                />
              ))}
              {layout.nodes.map((node) => (
                <g
                  key={node.id}
                  id={nodeDomId(node.id)}
                  // biome-ignore lint/a11y/useSemanticElements: SVG kennt kein button-Element; Rolle, Tabindex und Tasten sind gesetzt
                  role="button"
                  tabIndex={node.id === current ? 0 : -1}
                  aria-label={tf("egNodeAria", {
                    name: node.name,
                    kind: t(KIND_KEY[node.kind]),
                    status: t(STATUS_KEY[node.status]),
                    n: edgesOf(visible, node.id).length
                  })}
                  aria-pressed={node.id === selectedId}
                  aria-describedby={`${baseId}-hint`}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="rn-graph-node rn-eg-node"
                  data-kind={node.kind}
                  data-status={node.status}
                  data-testid={`entity-node-${node.id}`}
                  onClick={() => select(node.id)}
                  onFocus={() => setActiveId(node.id)}
                  onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx={RADIUS[node.kind](node.height)}
                    className="rn-graph-box"
                  />
                  <text className="rn-graph-label" fontSize={GRAPH_FONT_SIZE} lang={contentLang}>
                    {node.lines.map((line, index) => (
                      <tspan
                        // biome-ignore lint/suspicious/noArrayIndexKey: Zeilen sind fest und ändern die Reihenfolge nicht
                        key={index}
                        x={LABEL_X}
                        y={FIRST_BASELINE + index * LINE_HEIGHT}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        <section
          className="rn-graph-details"
          aria-labelledby={`${baseId}-details-title`}
          data-testid="entity-graph-details"
        >
          <h3 id={`${baseId}-details-title`} className="rn-graph-details-title">
            {t("graphDetailsTitle")}
          </h3>
          <output aria-live="polite" className="rn-visually-hidden">
            {selected ? tf("egSelected", { name: selected.name }) : ""}
          </output>
          {selected ? (
            <div className="rn-graph-details-body">
              <p className="rn-graph-item-name">
                <strong lang={contentLang}>{selected.name}</strong>
                <span className="rn-graph-kind">{t(KIND_KEY[selected.kind])}</span>
                <span className="rn-graph-kind">{t(STATUS_KEY[selected.status])}</span>
              </p>
              <h4 className="rn-eg-subtitle">{t("egRelations")}</h4>
              {edgesOf(visible, selected.id).length > 0 ? (
                <ul className="rn-eg-relations">
                  {edgesOf(visible, selected.id).map((edge) =>
                    relationItem(edge, false, "entity-details")
                  )}
                </ul>
              ) : (
                <p className="rn-graph-hint">{t("egNoRelations")}</p>
              )}
            </div>
          ) : (
            <p className="rn-graph-hint">{t("egDetailsEmpty")}</p>
          )}
        </section>
      </div>

      <div
        id={`${baseId}-list-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-list-tab`}
        hidden={tab !== "list"}
        className="rn-graph-list"
        data-testid="entity-graph-list"
      >
        {ENTITY_KINDS.map((kind) => ({ kind, nodes: visible.nodes.filter((n) => n.kind === kind) }))
          .filter((group) => group.nodes.length > 0)
          .map((group) => (
            <section key={group.kind} aria-labelledby={`${baseId}-list-${group.kind}`}>
              <h3 id={`${baseId}-list-${group.kind}`} className="rn-graph-list-title">
                {t(KINDS_KEY[group.kind])}
              </h3>
              <ul className="rn-graph-items">
                {group.nodes.map((node) => (
                  <li
                    key={node.id}
                    className="rn-graph-item"
                    data-status={node.status}
                    data-testid={`entity-item-${node.id}`}
                  >
                    <p className="rn-graph-item-name">
                      <strong lang={contentLang}>{node.name}</strong>
                      <span className="rn-graph-kind">{t(KIND_KEY[node.kind])}</span>
                      <span className="rn-graph-kind">{t(STATUS_KEY[node.status])}</span>
                    </p>
                    <div className="rn-graph-actions">
                      {reviewButtons(
                        node.status,
                        node.name,
                        `entity-item-${node.id}`,
                        (next) => setNodeStatus(node, next),
                        () =>
                          setEditing({
                            type: "node",
                            id: node.id,
                            name: node.name,
                            kind: node.kind
                          })
                      )}
                    </div>
                    {editing?.type === "node" && editing.id === node.id && (
                      <form
                        className="rn-eg-edit"
                        onSubmit={saveEdit}
                        data-testid={`entity-item-${node.id}-form`}
                      >
                        <label>
                          {t("egNameLabel")}
                          <input
                            type="text"
                            value={editing.name}
                            maxLength={120}
                            required
                            lang={contentLang}
                            // biome-ignore lint/a11y/noAutofocus: Fokus folgt der Aktion „Berichtigen“, der Nutzer hat das Feld eben geöffnet
                            autoFocus
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          />
                        </label>
                        <label>
                          {t("egKindLabel")}
                          <select
                            value={editing.kind}
                            onChange={(e) =>
                              setEditing({ ...editing, kind: e.target.value as EntityKind })
                            }
                          >
                            {ENTITY_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {t(KIND_KEY[k])}
                              </option>
                            ))}
                          </select>
                        </label>
                        {editActions()}
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {visible.edges.length > 0 && (
          <section aria-labelledby={`${baseId}-list-relations`}>
            <h3 id={`${baseId}-list-relations`} className="rn-graph-list-title">
              {t("egListRelations")}
            </h3>
            <ul className="rn-graph-items">
              {visible.edges.map((edge) => relationItem(edge, true, "entity-relation"))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
