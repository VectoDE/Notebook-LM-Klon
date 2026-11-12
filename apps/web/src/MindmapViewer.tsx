/**
 * Mindmap SVG Layout Engine and View Component.
 *
 * Implements Sub-Issue #122 (Decision #62, #70):
 * - Interactive SVG Mindmap with Zoom & Pan, Collapsible Branches, and Source Click Jump
 * - Accessible Screenreader Alternative with WAI-ARIA role="tree" / role="treeitem"
 * - Full Keyboard Navigation: ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Enter
 */

import type { MindmapNode } from "@notebook-lm/shared";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
  useMemo,
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
  const [activeTab, setActiveTab] = useState<"visual" | "tree">("visual");

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

  // Keyboard navigation for WAI-ARIA role="tree"
  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent, currentId: string) => {
      const currentIndex = flatVisibleNodes.findIndex((n) => n.id === currentId);
      if (currentIndex === -1) return;

      const currentNode = flatVisibleNodes[currentIndex];

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = Math.min(flatVisibleNodes.length - 1, currentIndex + 1);
          const nextNode = flatVisibleNodes[nextIndex];
          if (nextNode) {
            setFocusedNodeId(nextNode.id);
          }
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = Math.max(0, currentIndex - 1);
          const prevNode = flatVisibleNodes[prevIndex];
          if (prevNode) {
            setFocusedNodeId(prevNode.id);
          }
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          if (currentNode?.hasChildren) {
            if (currentNode.isCollapsed) {
              toggleCollapse(currentNode.id);
            } else if (currentNode.children.length > 0) {
              const firstChild = currentNode.children[0];
              if (firstChild) {
                setFocusedNodeId(firstChild.id);
              }
            }
          }
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (currentNode?.hasChildren && !currentNode.isCollapsed) {
            toggleCollapse(currentNode.id);
          }
          break;
        }
        case "Home": {
          event.preventDefault();
          const first = flatVisibleNodes[0];
          if (first) {
            setFocusedNodeId(first.id);
          }
          break;
        }
        case "End": {
          event.preventDefault();
          const last = flatVisibleNodes[flatVisibleNodes.length - 1];
          if (last) {
            setFocusedNodeId(last.id);
          }
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          if (currentNode) {
            if (currentNode.sourceId || currentNode.chunkId || currentNode.sourceCitation) {
              onSourceJump?.({
                sourceId: currentNode.sourceId,
                chunkId: currentNode.chunkId,
                sourceCitation: currentNode.sourceCitation
              });
            } else if (currentNode.hasChildren) {
              toggleCollapse(currentNode.id);
            }
          }
          break;
        }
      }
    },
    [flatVisibleNodes, onSourceJump, toggleCollapse]
  );

  const containerId = useId();

  return (
    <section aria-label={`Mindmap: ${title}`} className="rn-tool-view rn-mindmap">
      <header className="rn-mindmap-head">
        <div className="rn-tool-view-head">
          <p className="rn-eyebrow">Mindmap</p>
          <h2 className="rn-tool-view-title">{title}</h2>
        </div>

        <div data-testid="mindmap-toolbar" className="rn-mindmap-toolbar">
          <div role="tablist" aria-label="Ansichtsmodus" className="rn-seg-tabs">
            <button
              type="button"
              role="tab"
              className="rn-seg-tab"
              aria-selected={activeTab === "visual"}
              aria-controls={`${containerId}-visual-panel`}
              id={`${containerId}-visual-tab`}
              onClick={() => setActiveTab("visual")}
            >
              Grafik (SVG)
            </button>
            <button
              type="button"
              role="tab"
              className="rn-seg-tab"
              aria-selected={activeTab === "tree"}
              aria-controls={`${containerId}-tree-panel`}
              id={`${containerId}-tree-tab`}
              onClick={() => setActiveTab("tree")}
            >
              Baumliste (WAI-ARIA)
            </button>
          </div>

          <fieldset className="rn-zoom" aria-label="Zoom">
            <button
              type="button"
              className="rn-icon-btn"
              aria-label="Verkleinern (Zoom Out)"
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
              aria-label="Vergrößern (Zoom In)"
              onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(1))))}
            >
              <span aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              className="rn-btn rn-btn--ghost rn-btn--compact"
              aria-label="Ansicht zurücksetzen"
              onClick={() => {
                setZoom(1.0);
                setPan({ x: 20, y: 20 });
              }}
            >
              Reset
            </button>
          </fieldset>
        </div>
      </header>

      <div
        id={`${containerId}-visual-panel`}
        role="tabpanel"
        aria-labelledby={`${containerId}-visual-tab`}
        hidden={activeTab !== "visual"}
        className="rn-mindmap-canvas"
      >
        <svg
          data-testid="mindmap-svg"
          aria-label={`Interaktive Mindmap-Grafik: ${title}`}
          role="img"
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
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="rn-mm-node"
                  data-kind={kind}
                  aria-label={`${node.label}${node.hasChildren ? (node.isCollapsed ? " (eingeklappt)" : " (ausgeklappt)") : ""}`}
                  onClick={handleNodeAction}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNodeAction();
                    }
                  }}
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
                    <g
                      transform={`translate(${node.width - TOGGLE_RADIUS - 8}, ${node.height / 2})`}
                      className="rn-mm-toggle"
                      aria-label={`${node.isCollapsed ? "Erweitern" : "Einklappen"}: ${node.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          toggleCollapse(node.id);
                        }
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
        <p className="rn-mindmap-hint">
          Tastaturnavigation: Pfeiltasten Hoch/Runter navigieren, Pfeil Rechts öffnet Zweig, Pfeil
          Links schließt Zweig, Enter/Leertaste springt zur Quelle.
        </p>

        <ul role="tree" aria-label={`Baumstruktur der Mindmap ${title}`} className="rn-tree">
          {flatVisibleNodes.map((node) => {
            const isFocused = node.id === focusedNodeId;
            const hasSource = Boolean(node.sourceId || node.chunkId || node.sourceCitation);

            return (
              <li
                key={node.id}
                role="treeitem"
                className="rn-tree-item"
                aria-level={node.depth + 1}
                aria-expanded={node.hasChildren ? !node.isCollapsed : undefined}
                aria-selected={isFocused}
                tabIndex={isFocused ? 0 : -1}
                id={`treeitem-${node.id}`}
                onKeyDown={(e) => handleTreeKeyDown(e, node.id)}
                onClick={() => {
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
                  <button
                    type="button"
                    className="rn-icon-btn"
                    aria-label={`${node.isCollapsed ? "Erweitern" : "Einklappen"}: ${node.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(node.id);
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
