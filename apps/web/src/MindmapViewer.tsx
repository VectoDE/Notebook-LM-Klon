/**
 * Mindmap SVG Layout Engine and View Component.
 *
 * Implements Sub-Issue #122 (Decision #62, #70):
 * - Interactive SVG Mindmap with Zoom & Pan, Collapsible Branches, and Source Click Jump
 * - Accessible Screenreader Alternative with WAI-ARIA role="tree" / role="treeitem"
 * - Full Keyboard Navigation: ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Enter
 *
 * Issue #296: Roving Tabindex in der Baumliste (Fokus wandert mit), Pfeil links zum
 * Elternknoten, SVG für Hilfstechnik ausgeblendet, Reiter „Grafik“/„Baumliste“ nach APG Tabs.
 */

import type { MindmapNode } from "@notebook-lm/shared";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

export interface MindmapViewerProps {
  readonly rootNode: MindmapNode;
  readonly title?: string | undefined;
  readonly onSourceJump?:
    | ((sourceRef: {
        sourceId?: string | undefined;
        chunkId?: string | undefined;
        sourceCitation?: string | undefined;
      }) => void)
    | undefined;
  readonly initialZoom?: number | undefined;
}

export interface RenderLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isCollapsed: boolean;
  readonly sourceId?: string | undefined;
  readonly chunkId?: string | undefined;
  readonly sourceCitation?: string | undefined;
  readonly children: readonly RenderLayoutNode[];
}

export interface RenderLayoutConnection {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 44;
/** Schriftgröße der Knotenbeschriftung in px (Minimum 14 px, Vorgabe 16/14). */
export const NODE_FONT_SIZE = 14;
/** Konservative Breite je Zeichen bei 14 px Inter (600), damit nichts abgeschnitten wird. */
const CHAR_WIDTH = 8.6;
/** Rand links plus Platz für den Ein-/Ausklapp-Knopf rechts (24 px Ziel + Abstand). */
const LABEL_PADDING_LEFT = 16;
const TOGGLE_RESERVE = 40;
/** Radius des Ein-/Ausklapp-Knopfs: 12 px ergibt ein Ziel von 24 x 24 px (WCAG 2.5.8). */
export const TOGGLE_RADIUS = 12;

/**
 * Breite eines Knotens: mindestens NODE_WIDTH, sonst so breit, dass die
 * Beschriftung vollständig hineinpasst (kein Abschneiden, auch nicht an der Wurzel).
 */
export function nodeWidthFor(label: string, hasChildren: boolean): number {
  const text = Math.ceil(label.length * CHAR_WIDTH);
  const reserve = LABEL_PADDING_LEFT * 2 + (hasChildren ? TOGGLE_RESERVE : 0);
  return Math.max(NODE_WIDTH, text + reserve);
}
export interface MindmapFit {
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
}

/** Rand um die eingepasste Mindmap in px. */
export const FIT_PADDING = 24;
/** Kleinster Zoom beim Einpassen: Beschriftung bleibt bei 14 px mal 0,8 noch lesbar. */
const MIN_FIT_ZOOM = 0.8;
const MAX_FIT_ZOOM = 1;

/**
 * Passt die Mindmap in die sichtbare Fläche ein: so groß wie möglich (höchstens 100 %,
 * mindestens 80 %, damit die Schrift lesbar bleibt), vertikal mittig. Passt sie auch bei 80 % nicht in die Breite,
 * bleibt die Wurzel links am Rand sichtbar, der Rest ist per Scrollen erreichbar.
 */
export function fitMindmap(
  nodes: readonly { x: number; y: number; width: number; height: number }[],
  viewport: { width: number; height: number }
): MindmapFit {
  if (nodes.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { zoom: 1, pan: { x: FIT_PADDING, y: FIT_PADDING } };
  }
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const zoom = Math.max(
    MIN_FIT_ZOOM,
    Math.min(
      MAX_FIT_ZOOM,
      (viewport.width - 2 * FIT_PADDING) / contentW,
      (viewport.height - 2 * FIT_PADDING) / contentH
    )
  );
  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;
  const x =
    scaledW <= viewport.width - 2 * FIT_PADDING
      ? (viewport.width - scaledW) / 2 - minX * zoom
      : FIT_PADDING - minX * zoom;
  const y = Math.max(FIT_PADDING, (viewport.height - scaledH) / 2) - minY * zoom;
  return { zoom: Number(zoom.toFixed(2)), pan: { x: Math.round(x), y: Math.round(y) } };
}

const HORIZONTAL_SPACING = 90;
const VERTICAL_SPACING = 24;

/**
 * Computes deterministic 2D hierarchical positions for nodes given collapsed state.
 */
export function computeMindmapLayout(
  node: MindmapNode,
  collapsedIds: ReadonlySet<string>,
  depth = 0,
  startX = 40,
  startY = 40
): { layoutNode: RenderLayoutNode; totalHeight: number; connections: RenderLayoutConnection[] } {
  const isCollapsed = collapsedIds.has(node.id);
  const rawChildren = node.children ?? [];
  const hasChildren = rawChildren.length > 0;

  const childLayouts: RenderLayoutNode[] = [];
  const connections: RenderLayoutConnection[] = [];

  let currentY = startY;
  const width = nodeWidthFor(node.label, hasChildren);
  const childX = startX + width + HORIZONTAL_SPACING;

  if (hasChildren && !isCollapsed) {
    for (const child of rawChildren) {
      const childResult = computeMindmapLayout(child, collapsedIds, depth + 1, childX, currentY);
      childLayouts.push(childResult.layoutNode);
      connections.push(...childResult.connections);
      connections.push({
        fromX: startX + width,
        fromY: 0, // adjusted after node Y is finalized
        toX: childResult.layoutNode.x,
        toY: childResult.layoutNode.y + NODE_HEIGHT / 2
      });
      currentY += childResult.totalHeight + VERTICAL_SPACING;
    }
  }

  const subtreeHeight =
    hasChildren && !isCollapsed && childLayouts.length > 0
      ? currentY - startY - VERTICAL_SPACING
      : NODE_HEIGHT;

  // Center parent vertically relative to its children if expanded
  const nodeY =
    hasChildren && !isCollapsed && childLayouts.length > 0
      ? startY + (subtreeHeight - NODE_HEIGHT) / 2
      : startY;

  // Fix fromY for outgoing connections
  for (const conn of connections) {
    if (conn.fromX === startX + width && conn.fromY === 0) {
      (conn as { fromY: number }).fromY = nodeY + NODE_HEIGHT / 2;
    }
  }

  const layoutNode: RenderLayoutNode = {
    id: node.id,
    label: node.label,
    x: startX,
    y: nodeY,
    width,
    height: NODE_HEIGHT,
    depth,
    hasChildren,
    isCollapsed,
    ...(node.sourceId ? { sourceId: node.sourceId } : {}),
    ...(node.chunkId ? { chunkId: node.chunkId } : {}),
    ...(node.sourceCitation ? { sourceCitation: node.sourceCitation } : {}),
    children: childLayouts
  };

  const totalHeight = Math.max(NODE_HEIGHT, subtreeHeight);
  return { layoutNode, totalHeight, connections };
}

/**
 * Collects all layout nodes into a flat list for rendering and searching.
 */
export function flattenLayoutNodes(root: RenderLayoutNode): RenderLayoutNode[] {
  const result: RenderLayoutNode[] = [];
  function walk(node: RenderLayoutNode) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(root);
  return result;
}

/** Lage eines sichtbaren Eintrags im Baum (für aria-setsize, aria-posinset, Pfeil links). */
export interface TreeItemMeta {
  readonly parentId: string | undefined;
  readonly setSize: number;
  readonly posInSet: number;
}

/** Elternknoten, Geschwisterzahl und Position für jeden sichtbaren Knoten. */
export function buildTreeMeta(root: RenderLayoutNode): Map<string, TreeItemMeta> {
  const meta = new Map<string, TreeItemMeta>();
  meta.set(root.id, { parentId: undefined, setSize: 1, posInSet: 1 });
  function walk(node: RenderLayoutNode) {
    node.children.forEach((child, index) => {
      meta.set(child.id, {
        parentId: node.id,
        setSize: node.children.length,
        posInSet: index + 1
      });
      walk(child);
    });
  }
  walk(root);
  return meta;
}

/** Elternknoten aller Knoten des vollständigen Baums (auch eingeklappter Zweige). */
export function buildParentMap(root: MindmapNode): Map<string, string | undefined> {
  const parents = new Map<string, string | undefined>([[root.id, undefined]]);
  function walk(node: MindmapNode) {
    for (const child of node.children ?? []) {
      parents.set(child.id, node.id);
      walk(child);
    }
  }
  walk(root);
  return parents;
}

/**
 * Aktiver Knoten der Baumliste: der gewünschte, falls sichtbar, sonst der nächste
 * sichtbare Vorfahr (z. B. nachdem ein Zweig in der Grafik eingeklappt wurde).
 */
export function resolveActiveId(
  wantedId: string,
  visibleIds: ReadonlySet<string>,
  parents: ReadonlyMap<string, string | undefined>,
  rootId: string
): string {
  let id: string | undefined = wantedId;
  while (id !== undefined && !visibleIds.has(id)) {
    id = parents.get(id);
  }
  return id ?? rootId;
}

/** Ergebnis einer Taste in der Baumliste: wohin der Fokus geht, was auf- oder zuklappt. */
export interface TreeKeyResult {
  readonly focus?: string;
  readonly toggle?: string;
  readonly activate?: true;
}

/**
 * Tastatursteuerung der Baumliste nach WAI-ARIA APG „Tree View“.
 * Gibt `undefined` zurück, wenn die Taste nicht zur Baumliste gehört.
 */
export function treeKeyAction(
  flat: readonly RenderLayoutNode[],
  meta: ReadonlyMap<string, TreeItemMeta>,
  currentId: string,
  key: string
): TreeKeyResult | undefined {
  const index = flat.findIndex((n) => n.id === currentId);
  const node = flat[index];
  if (!node) return undefined;
  switch (key) {
    case "ArrowDown": {
      const next = flat[index + 1];
      return next ? { focus: next.id } : {};
    }
    case "ArrowUp": {
      const prev = flat[index - 1];
      return prev ? { focus: prev.id } : {};
    }
    case "ArrowRight": {
      if (!node.hasChildren) return {};
      if (node.isCollapsed) return { toggle: node.id };
      const first = node.children[0];
      return first ? { focus: first.id } : {};
    }
    case "ArrowLeft": {
      if (node.hasChildren && !node.isCollapsed) return { toggle: node.id };
      const parentId = meta.get(node.id)?.parentId;
      return parentId ? { focus: parentId } : {};
    }
    case "Home":
      return { focus: flat[0]?.id ?? node.id };
    case "End":
      return { focus: flat[flat.length - 1]?.id ?? node.id };
    case "Enter":
    case " ":
      return { activate: true };
    default:
      return undefined;
  }
}

export type MindmapTab = "visual" | "tree";
const TAB_ORDER: readonly MindmapTab[] = ["visual", "tree"];

/** Reiter nach APG „Tabs“: Pfeil links/rechts mit Umlauf, Pos1/Ende. */
export function tabKeyTarget(current: MindmapTab, key: string): MindmapTab | undefined {
  const index = TAB_ORDER.indexOf(current);
  const last = TAB_ORDER.length - 1;
  switch (key) {
    case "ArrowRight":
      return TAB_ORDER[index === last ? 0 : index + 1];
    case "ArrowLeft":
      return TAB_ORDER[index === 0 ? last : index - 1];
    case "Home":
      return TAB_ORDER[0];
    case "End":
      return TAB_ORDER[last];
    default:
      return undefined;
  }
}

export function MindmapViewer({
  rootNode,
  title = "Wissens-Mindmap",
  onSourceJump,
  initialZoom = 1.0
}: MindmapViewerProps) {
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [focusedNodeId, setFocusedNodeId] = useState<string>(rootNode.id);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<MindmapTab>("visual");
  const tabRefs = useRef<Record<MindmapTab, HTMLButtonElement | null>>({
    visual: null,
    tree: null
  });
  /** Nur nach Tastatur- oder Klickbedienung den Fokus nachziehen, nicht beim ersten Rendern. */
  const moveFocusRef = useRef(false);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const layout = useMemo(() => {
    return computeMindmapLayout(rootNode, collapsedIds);
  }, [rootNode, collapsedIds]);

  const flatVisibleNodes = useMemo(() => {
    return flattenLayoutNodes(layout.layoutNode);
  }, [layout.layoutNode]);

  const treeMeta = useMemo(() => buildTreeMeta(layout.layoutNode), [layout.layoutNode]);
  const parents = useMemo(() => buildParentMap(rootNode), [rootNode]);
  const activeId = useMemo(
    () =>
      resolveActiveId(
        focusedNodeId,
        new Set(flatVisibleNodes.map((n) => n.id)),
        parents,
        rootNode.id
      ),
    [focusedNodeId, flatVisibleNodes, parents, rootNode.id]
  );

  const containerId = useId();
  const itemDomId = useCallback((id: string) => `${containerId}-item-${id}`, [containerId]);

  // Roving Tabindex: nach einem Wechsel des aktiven Knotens den Fokus dorthin verschieben.
  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    document.getElementById(itemDomId(activeId))?.focus();
  }, [activeId, itemDomId]);

  // Tastatursteuerung der Baumliste (WAI-ARIA APG Tree View)
  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent, currentId: string) => {
      const result = treeKeyAction(flatVisibleNodes, treeMeta, currentId, event.key);
      if (!result) return;
      event.preventDefault();
      if (result.toggle) toggleCollapse(result.toggle);
      if (result.focus) {
        moveFocusRef.current = true;
        setFocusedNodeId(result.focus);
      }
      if (result.activate) {
        const node = flatVisibleNodes.find((n) => n.id === currentId);
        if (!node) return;
        if (node.sourceId || node.chunkId || node.sourceCitation) {
          onSourceJump?.({
            sourceId: node.sourceId,
            chunkId: node.chunkId,
            sourceCitation: node.sourceCitation
          });
        } else if (node.hasChildren) {
          toggleCollapse(node.id);
        }
      }
    },
    [flatVisibleNodes, treeMeta, onSourceJump, toggleCollapse]
  );

  // Reiter: automatische Aktivierung, Fokus folgt der Auswahl
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const target = tabKeyTarget(activeTab, event.key);
      if (!target) return;
      event.preventDefault();
      setActiveTab(target);
      tabRefs.current[target]?.focus();
    },
    [activeTab]
  );

  // Beim Öffnen und bei "Reset" einpassen: die Wurzel steht immer sichtbar in der Fläche.
  const fitToView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = fitMindmap(flatVisibleNodes, {
      width: canvas.clientWidth,
      height: canvas.clientHeight
    });
    setZoom(fit.zoom);
    setPan(fit.pan);
    canvas.scrollTo({ left: 0, top: 0 });
  }, [flatVisibleNodes]);

  const fittedOnce = useRef(false);
  useLayoutEffect(() => {
    if (fittedOnce.current || activeTab !== "visual") return;
    fittedOnce.current = true;
    fitToView();
  }, [activeTab, fitToView]);

  return (
    <section aria-label={`Mindmap: ${title}`} className="rn-tool-view rn-mindmap">
      <header className="rn-mindmap-head">
        <div className="rn-tool-view-head">
          <p className="rn-eyebrow">Mindmap</p>
          <h2 className="rn-tool-view-title">{title}</h2>
        </div>

        <div data-testid="mindmap-toolbar" className="rn-mindmap-toolbar">
          <div role="tablist" aria-label="Ansicht" className="rn-seg-tabs">
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                ref={(el) => {
                  tabRefs.current[tab] = el;
                }}
                type="button"
                role="tab"
                className="rn-seg-tab"
                aria-selected={activeTab === tab}
                aria-controls={`${containerId}-${tab}-panel`}
                id={`${containerId}-${tab}-tab`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={handleTabKeyDown}
              >
                {tab === "visual" ? "Grafik" : "Baumliste"}
              </button>
            ))}
          </div>

          {/* Zoom wirkt nur auf die Grafik; in der Baumliste wären es tote Tab-Stopps. */}
          {activeTab === "visual" && (
            <fieldset className="rn-zoom" aria-label="Zoom">
              <button
                type="button"
                className="rn-icon-btn"
                aria-label="Verkleinern"
                onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
              >
                <span aria-hidden="true">−</span>
              </button>
              <output className="rn-zoom-value" aria-live="polite">
                {Math.round(zoom * 100)} %
              </output>
              <button
                type="button"
                className="rn-icon-btn"
                aria-label="Vergrößern"
                onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(1))))}
              >
                <span aria-hidden="true">+</span>
              </button>
              <button
                type="button"
                className="rn-btn rn-btn--ghost rn-btn--compact"
                onClick={fitToView}
              >
                Einpassen
              </button>
            </fieldset>
          )}
        </div>
      </header>

      <div
        id={`${containerId}-visual-panel`}
        role="tabpanel"
        aria-labelledby={`${containerId}-visual-tab`}
        aria-describedby={`${containerId}-visual-hint`}
        hidden={activeTab !== "visual"}
        className="rn-mindmap-canvas"
        ref={canvasRef}
      >
        <p id={`${containerId}-visual-hint`} className="rn-visually-hidden">
          Die Grafik ist nur zum Ansehen. Alle Punkte der Mindmap stehen im Reiter Baumliste, dort
          per Tastatur und Screenreader bedienbar.
        </p>
        <svg
          data-testid="mindmap-svg"
          aria-hidden="true"
          focusable="false"
          width="100%"
          height="100%"
          className="rn-mindmap-svg"
        >
          <title>{`Mindmap: ${title}`}</title>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {layout.connections.map((conn, idx) => {
              const dx = (conn.toX - conn.fromX) / 2;
              const pathD = `M ${conn.fromX} ${conn.fromY} C ${conn.fromX + dx} ${conn.fromY}, ${conn.toX - dx} ${conn.toY}, ${conn.toX} ${conn.toY}`;
              return (
                <path
                  key={`conn-${idx}-${conn.fromX}-${conn.fromY}-${conn.toX}-${conn.toY}`}
                  d={pathD}
                  className="rn-mm-link"
                />
              );
            })}

            {flatVisibleNodes.map((node) => {
              const isRoot = node.depth === 0;
              const hasSource = Boolean(node.sourceId || node.chunkId || node.sourceCitation);
              const kind = isRoot ? "root" : hasSource ? "source" : "plain";

              const handleNodeAction = () => {
                if (hasSource) {
                  onSourceJump?.({
                    sourceId: node.sourceId,
                    chunkId: node.chunkId,
                    sourceCitation: node.sourceCitation
                  });
                } else if (node.hasChildren) {
                  toggleCollapse(node.id);
                }
              };

              return (
                // Die Grafik ist für Hilfstechnik ausgeblendet; Tastatur und Screenreader
                // bedienen dieselben Aktionen in der Baumliste.
                // biome-ignore lint/a11y/useKeyWithClickEvents: Mausweg, Tastaturweg ist die Baumliste
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="rn-mm-node"
                  data-kind={kind}
                  onClick={handleNodeAction}
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="10"
                    ry="10"
                    className="rn-mm-box"
                  />
                  <text
                    x={LABEL_PADDING_LEFT}
                    y={node.height / 2 + 5}
                    textAnchor="start"
                    fontSize={NODE_FONT_SIZE}
                    className="rn-mm-label"
                  >
                    {node.label}
                  </text>

                  {node.hasChildren && (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: Mausweg, Tastaturweg ist die Baumliste
                    <g
                      transform={`translate(${node.width - TOGGLE_RADIUS - 8}, ${node.height / 2})`}
                      className="rn-mm-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                    >
                      <circle r={TOGGLE_RADIUS} className="rn-mm-toggle-dot" />
                      <text
                        textAnchor="middle"
                        y="5"
                        fontSize={NODE_FONT_SIZE}
                        className="rn-mm-toggle-sign"
                      >
                        {node.isCollapsed ? "+" : "−"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div
        id={`${containerId}-tree-panel`}
        role="tabpanel"
        aria-labelledby={`${containerId}-tree-tab`}
        hidden={activeTab !== "tree"}
        className="rn-mindmap-tree"
      >
        <p className="rn-mindmap-hint" id={`${containerId}-tree-hint`}>
          Pfeil hoch und runter wechseln den Eintrag. Pfeil rechts öffnet einen Zweig, Pfeil links
          schließt ihn oder springt zum übergeordneten Eintrag. Pos1 und Ende springen an den Anfang
          und das Ende. Eingabe oder Leertaste öffnet die Quelle.
        </p>

        <ul
          role="tree"
          aria-label={`Baumliste der Mindmap ${title}`}
          aria-describedby={`${containerId}-tree-hint`}
          className="rn-tree"
        >
          {flatVisibleNodes.map((node) => {
            const isActive = node.id === activeId;
            const hasSource = Boolean(node.sourceId || node.chunkId || node.sourceCitation);
            const meta = treeMeta.get(node.id);

            return (
              <li
                key={node.id}
                role="treeitem"
                className="rn-tree-item"
                aria-level={node.depth + 1}
                aria-setsize={meta?.setSize}
                aria-posinset={meta?.posInSet}
                aria-expanded={node.hasChildren ? !node.isCollapsed : undefined}
                data-active={isActive ? "true" : undefined}
                tabIndex={isActive ? 0 : -1}
                id={itemDomId(node.id)}
                onKeyDown={(e) => handleTreeKeyDown(e, node.id)}
                onClick={() => {
                  moveFocusRef.current = true;
                  setFocusedNodeId(node.id);
                  if (hasSource) {
                    onSourceJump?.({
                      sourceId: node.sourceId,
                      chunkId: node.chunkId,
                      sourceCitation: node.sourceCitation
                    });
                  }
                }}
                style={{ marginInlineStart: `${node.depth * 20}px` }}
              >
                <span className="rn-tree-label">
                  <span
                    className="rn-tree-marker"
                    aria-hidden="true"
                    data-state={node.hasChildren ? (node.isCollapsed ? "closed" : "open") : "leaf"}
                  />
                  <strong>{node.label}</strong>
                  {node.sourceCitation && (
                    <small className="rn-tree-cite">({node.sourceCitation})</small>
                  )}
                </span>

                {node.hasChildren && (
                  // Mausziel; per Tastatur klappen Pfeil rechts/links. Nicht im Tab-Fluss,
                  // damit der Baum nur einen Tab-Stopp hat (Roving Tabindex).
                  <button
                    type="button"
                    className="rn-icon-btn"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(node.id);
                      moveFocusRef.current = true;
                      setFocusedNodeId(node.id);
                    }}
                  >
                    <span aria-hidden="true">{node.isCollapsed ? "+" : "−"}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
