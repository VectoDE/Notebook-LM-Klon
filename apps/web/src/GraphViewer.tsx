/**
 * Wissensgraph-Ansicht (Issue #327): eigenes SVG ohne Abhängigkeit.
 *
 * - Grafik: Knoten (Begriffe abgerundet, Quellen eckig) und Kanten (durchgezogen = hängt
 *   zusammen mit, gestrichelt = kommt vor in). Ein Tab-Stopp (Roving Tabindex), Pfeiltasten
 *   wandern räumlich zwischen den Knoten, Eingabe/Leertaste zeigt die Details mit dem Sprung
 *   zur Quelle. Zoom und Einpassen; auf schmaler Fläche (Telefon) eine Spalte mit Bögen.
 * - Liste: derselbe Inhalt als Text (Textalternative, WCAG 1.1.1), mit Sprung zur Quelle.
 * Bewegung: nur Übergänge über Tokens, die bei reduzierter Bewegung 0 ms sind.
 */

import type { EntityGraph } from "@notebook-lm/shared";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Icon } from "./Icon.js";
import "./entity-graph.css";
import {
  GRAPH_FONT_SIZE,
  GRAPH_PADDING,
  GRAPH_TABS,
  type GraphNode,
  type GraphTab,
  type KnowledgeGraph,
  LINE_HEIGHT,
  degree,
  fitZoom,
  graphOffset,
  graphTabTarget,
  layoutGraph,
  layoutModeFor,
  nodeInDirection,
  nodeRelations,
  stepZoom
} from "./knowledge-graph.js";
import { useTheme } from "./useTheme.js";
import type { CitationLocation, PanelFocusAttributes } from "./workspace-types.js";

/** Beziehungsgraph erst beim Umschalten laden, damit der Start schlank bleibt (LCP). */
const EntityGraphView = lazy(() =>
  import("./EntityGraphView.js").then((m) => ({ default: m.EntityGraphView }))
);
export interface GraphViewerProps {
  readonly graph: KnowledgeGraph;
  /** Sprache der Begriffe und Quellentitel (BCP 47), für lang (WCAG 3.1.2). */
  readonly contentLang?: string | undefined;
  readonly onSourceJump?: ((sourceId: string) => void) | undefined;
  /** Nur ab 900 px: Rückweg zum Chat, der in derselben Spalte liegt. */
  readonly onClose?: (() => void) | undefined;
  readonly panelAttributes?: PanelFocusAttributes | undefined;
  /**
   * Beziehungsgraph (Issue #238): Personen, Organisationen, Themen mit Beleg je Kante.
   * Als Funktion wird er erst beim Umschalten geladen, damit der Start schlank bleibt.
   */
  readonly entityGraph?: EntityGraph | (() => Promise<EntityGraph>) | undefined;
  /** Quellen (id, Titel) für die Belegzeile des Beziehungsgraphen. */
  readonly entitySources?: readonly { readonly id: string; readonly title: string }[] | undefined;
  /** Sprung zur markierten Zitatstelle in der Quelle. */
  readonly onCitationJump?: ((citation: CitationLocation) => void) | undefined;
}

type GraphMode = "concepts" | "entities";

/** Erste Grundlinie im Knoten: Innenabstand oben plus Oberlänge bei 14 px. */
const FIRST_BASELINE = 27;
const LABEL_X = 16;

export function GraphViewer({
  graph,
  contentLang,
  onSourceJump,
  onClose,
  panelAttributes,
  entityGraph,
  entitySources = [],
  onCitationJump
}: GraphViewerProps) {
  const { t, tf } = useTheme();
  const baseId = useId();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<GraphTab, HTMLButtonElement | null>>({ visual: null, list: null });
  const [tab, setTab] = useState<GraphTab>("visual");
  const [graphMode, setGraphMode] = useState<GraphMode>("concepts");
  const [loadedEntityGraph, setLoadedEntityGraph] = useState<EntityGraph | undefined>();
  const shownEntityGraph = typeof entityGraph === "function" ? loadedEntityGraph : entityGraph;
  useEffect(() => {
    if (graphMode !== "entities" || typeof entityGraph !== "function") return;
    let active = true;
    void entityGraph().then((graph) => {
      if (active) setLoadedEntityGraph(graph);
    });
    return () => {
      active = false;
    };
  }, [graphMode, entityGraph]);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  /** null: eingepasst (folgt der Fläche); sonst der gewählte Zoom. */
  const [zoom, setZoom] = useState<number | null>(null);
  const firstId = graph.nodes[0]?.id ?? "";
  const [activeId, setActiveId] = useState(firstId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusNodeRef = useRef(false);

  // Größe der Fläche messen (Anordnung und Einpassen hängen davon ab)
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

  const mode = layoutModeFor(canvas.width);
  const layout = useMemo(() => layoutGraph(graph, mode), [graph, mode]);
  const fitted = fitZoom(layout, canvas);
  const scale = zoom ?? fitted;
  const offset = graphOffset(layout.width, scale, canvas.width);
  const svgWidth = Math.max(
    canvas.width,
    Math.ceil(offset.x + layout.width * scale + GRAPH_PADDING)
  );
  const svgHeight = Math.ceil(layout.height * scale + 2 * GRAPH_PADDING);

  // Bekannter aktiver Knoten, auch wenn Quellen hinzukommen oder wegfallen
  const current = graph.nodes.some((n) => n.id === activeId) ? activeId : firstId;
  const selected = graph.nodes.find((n) => n.id === selectedId);
  const nodeDomId = useCallback((id: string) => `${baseId}-node-${id}`, [baseId]);

  useEffect(() => {
    if (!focusNodeRef.current) return;
    focusNodeRef.current = false;
    document.getElementById(nodeDomId(current))?.focus();
  }, [current, nodeDomId]);

  const kindLabel = (node: GraphNode) =>
    t(node.kind === "source" ? "graphKindSource" : "graphKindConcept");

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

  const connected = (edgeFrom: string, edgeTo: string) =>
    selectedId !== null && (edgeFrom === selectedId || edgeTo === selectedId);

  const concepts = graph.nodes.filter((n) => n.kind === "concept");
  const sources = graph.nodes.filter((n) => n.kind === "source");

  /** Beziehungen eines Knotens als Text, für Details und Liste. */
  const relationLines = (node: GraphNode) => {
    const rel = nodeRelations(graph, node.id);
    const names = (nodes: readonly GraphNode[]) =>
      nodes.length > 0 ? nodes.map((n) => n.label).join(", ") : t("graphNone");
    return node.kind === "source"
      ? [{ key: "contains", label: t("graphContains"), value: names(rel.contains) }]
      : [
          { key: "related", label: t("graphRelated"), value: names(rel.related) },
          { key: "occurs", label: t("graphOccursIn"), value: names(rel.occursIn) }
        ];
  };

  const sourceButton = (node: GraphNode, testId: string) =>
    node.sourceId ? (
      <button
        type="button"
        className="rn-btn rn-btn--secondary rn-graph-jump"
        data-testid={testId}
        aria-label={tf("graphShowSourceAria", { title: node.label })}
        onClick={() => onSourceJump?.(node.sourceId as string)}
      >
        <Icon name="sources" size={18} />
        {t("graphShowSource")}
      </button>
    ) : null;

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="rn-panel-body rn-graph"
      data-testid="graph-panel"
      {...panelAttributes}
    >
      <header className="rn-panel-head">
        <div className="rn-panel-heading">
          <h2 id={`${baseId}-title`}>{t("graphTitle")}</h2>
          {graphMode === "concepts" && (
            <p className="rn-panel-sub">
              {tf("graphSub", {
                concepts: concepts.length,
                sources: sources.length,
                links: graph.edges.length
              })}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            data-testid="btn-close-graph"
            className="rn-btn rn-btn--ghost rn-btn--compact"
          >
            <Icon name="back" size={18} />
            {t("graphBack")}
          </button>
        )}
      </header>

      {entityGraph && (
        <fieldset className="rn-graph-mode">
          <legend className="rn-visually-hidden">{t("egModeLabel")}</legend>
          {(["concepts", "entities"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={graphMode === id}
              data-testid={`graph-mode-${id}`}
              className="rn-btn rn-btn--secondary rn-btn--compact"
              onClick={() => setGraphMode(id)}
            >
              {t(id === "concepts" ? "egModeConcepts" : "egModeEntities")}
            </button>
          ))}
        </fieldset>
      )}

      <div className="rn-tool-view rn-graph-view rn-cinema-enter" hidden={graphMode === "entities"}>
        <div className="rn-mindmap-toolbar" data-testid="graph-toolbar">
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
                data-testid={`graph-tab-${id}`}
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
                data-testid="graph-zoom-out"
                onClick={() => setZoom(stepZoom(scale, -1))}
              >
                <span aria-hidden="true">−</span>
              </button>
              <output className="rn-zoom-value" aria-live="polite" data-testid="graph-zoom-value">
                {Math.round(scale * 100)} %
              </output>
              <button
                type="button"
                className="rn-icon-btn"
                aria-label={t("mmZoomIn")}
                data-testid="graph-zoom-in"
                onClick={() => setZoom(stepZoom(scale, 1))}
              >
                <span aria-hidden="true">+</span>
              </button>
              <button
                type="button"
                className="rn-btn rn-btn--ghost rn-btn--compact"
                data-testid="graph-fit"
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

        {graph.nodes.length === 0 && <p className="rn-graph-empty">{t("graphEmpty")}</p>}

        <div
          id={`${baseId}-visual-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-visual-tab`}
          hidden={tab !== "visual"}
          className="rn-graph-visual"
        >
          <ul className="rn-graph-legend" aria-label={t("graphLegendLabel")}>
            <li>
              <svg aria-hidden="true" focusable="false" width="28" height="12">
                <line x1="2" y1="6" x2="26" y2="6" className="rn-graph-edge" />
              </svg>
              {t("graphLegendRelated")}
            </li>
            <li>
              <svg aria-hidden="true" focusable="false" width="28" height="12">
                <line x1="2" y1="6" x2="26" y2="6" className="rn-graph-edge" data-kind="occursIn" />
              </svg>
              {t("graphLegendOccurs")}
            </li>
            <li>
              <svg aria-hidden="true" focusable="false" width="22" height="16">
                <rect x="1" y="1" width="20" height="14" rx="7" className="rn-graph-swatch" />
              </svg>
              {t("graphLegendConcept")}
            </li>
            <li>
              <svg aria-hidden="true" focusable="false" width="22" height="16">
                <rect
                  x="1"
                  y="1"
                  width="20"
                  height="14"
                  rx="2"
                  className="rn-graph-swatch"
                  data-kind="source"
                />
              </svg>
              {t("graphLegendSource")}
            </li>
          </ul>

          <div ref={canvasRef} className="rn-graph-canvas" data-testid="graph-canvas">
            <p id={`${baseId}-hint`} className="rn-visually-hidden">
              {t("graphVisualHint")}
            </p>
            <svg
              data-testid="graph-svg"
              data-layout={layout.mode}
              width={svgWidth}
              height={svgHeight}
              className="rn-graph-svg"
            >
              <title>{t("graphSvgLabel")}</title>
              <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
                {layout.edges.map((edge) => (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={edge.d}
                    className="rn-graph-edge"
                    data-kind={edge.kind}
                    data-active={connected(edge.from, edge.to) ? "true" : undefined}
                  />
                ))}
                {layout.nodes.map((node) => {
                  const rx = node.kind === "source" ? 4 : 18;
                  return (
                    <g
                      key={node.id}
                      id={nodeDomId(node.id)}
                      // biome-ignore lint/a11y/useSemanticElements: SVG kennt kein button-Element; Rolle, Tabindex und Tasten sind gesetzt
                      role="button"
                      tabIndex={node.id === current ? 0 : -1}
                      aria-label={tf("graphNodeAria", {
                        label: node.label,
                        kind: kindLabel(node),
                        n: degree(graph, node.id)
                      })}
                      aria-pressed={node.id === selectedId}
                      aria-describedby={`${baseId}-hint`}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="rn-graph-node"
                      data-kind={node.kind}
                      data-testid={`graph-node-${node.id}`}
                      onClick={() => select(node.id)}
                      onFocus={() => setActiveId(node.id)}
                      onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                    >
                      <rect
                        width={node.width}
                        height={node.height}
                        rx={rx}
                        className="rn-graph-box"
                      />
                      <text
                        className="rn-graph-label"
                        fontSize={GRAPH_FONT_SIZE}
                        lang={contentLang}
                      >
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
                  );
                })}
              </g>
            </svg>
          </div>

          <section
            className="rn-graph-details"
            aria-labelledby={`${baseId}-details-title`}
            data-testid="graph-details"
          >
            <h3 id={`${baseId}-details-title`} className="rn-graph-details-title">
              {t("graphDetailsTitle")}
            </h3>
            <output aria-live="polite" className="rn-visually-hidden">
              {selected ? tf("graphSelected", { label: selected.label }) : ""}
            </output>
            {selected ? (
              <div className="rn-graph-details-body">
                <p className="rn-graph-item-name">
                  <strong lang={contentLang}>{selected.label}</strong>
                  <span className="rn-graph-kind">{kindLabel(selected)}</span>
                </p>
                <dl className="rn-graph-relations">
                  {relationLines(selected).map((line) => (
                    <div key={line.key}>
                      <dt>{line.label}</dt>
                      <dd lang={contentLang}>{line.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="rn-graph-actions">
                  {sourceButton(selected, "graph-details-jump")}
                  {nodeRelations(graph, selected.id).occursIn.map((src) => (
                    <button
                      key={src.id}
                      type="button"
                      className="rn-btn rn-btn--secondary rn-graph-jump"
                      data-testid={`graph-details-jump-${src.id}`}
                      aria-label={tf("graphShowSourceAria", { title: src.label })}
                      onClick={() => onSourceJump?.(src.sourceId as string)}
                    >
                      <Icon name="sources" size={18} />
                      <span lang={contentLang}>{src.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rn-graph-hint">{t("graphDetailsEmpty")}</p>
            )}
          </section>
        </div>

        <div
          id={`${baseId}-list-panel`}
          role="tabpanel"
          aria-labelledby={`${baseId}-list-tab`}
          hidden={tab !== "list"}
          className="rn-graph-list"
          data-testid="graph-list"
        >
          {[
            { key: "concepts", title: t("graphListConcepts"), nodes: concepts },
            { key: "sources", title: t("graphListSources"), nodes: sources }
          ]
            .filter((group) => group.nodes.length > 0)
            .map((group) => (
              <section key={group.key} aria-labelledby={`${baseId}-list-${group.key}`}>
                <h3 id={`${baseId}-list-${group.key}`} className="rn-graph-list-title">
                  {group.title}
                </h3>
                <ul className="rn-graph-items">
                  {group.nodes.map((node) => (
                    <li key={node.id} className="rn-graph-item" data-kind={node.kind}>
                      <p className="rn-graph-item-name">
                        <strong lang={contentLang}>{node.label}</strong>
                        <span className="rn-graph-kind">{kindLabel(node)}</span>
                      </p>
                      <dl className="rn-graph-relations">
                        {relationLines(node).map((line) => (
                          <div key={line.key}>
                            <dt>{line.label}</dt>
                            <dd lang={contentLang}>{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                      {sourceButton(node, `graph-list-jump-${node.id}`)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      </div>
      {shownEntityGraph && graphMode === "entities" && (
        <Suspense fallback={null}>
          <EntityGraphView
            graph={shownEntityGraph}
            sources={entitySources}
            contentLang={contentLang}
            onCitationJump={onCitationJump}
          />
        </Suspense>
      )}
    </section>
  );
}
