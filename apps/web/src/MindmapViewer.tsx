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
  const childX = startX + NODE_WIDTH + HORIZONTAL_SPACING;

  if (hasChildren && !isCollapsed) {
    for (const child of rawChildren) {
      const childResult = computeMindmapLayout(child, collapsedIds, depth + 1, childX, currentY);
      childLayouts.push(childResult.layoutNode);
      connections.push(...childResult.connections);
      connections.push({
        fromX: startX + NODE_WIDTH,
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
    if (conn.fromX === startX + NODE_WIDTH && conn.fromY === 0) {
      (conn as { fromY: number }).fromY = nodeY + NODE_HEIGHT / 2;
    }
  }

  const layoutNode: RenderLayoutNode = {
    id: node.id,
    label: node.label,
    x: startX,
    y: nodeY,
    width: NODE_WIDTH,
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
    <section
      aria-label={`Mindmap: ${title}`}
      className="relationnotes-mindmap-viewer"
      style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid #e2e8f0"
        }}
      >
        <h2 style={{ fontSize: "1.1rem", margin: 0 }}>{title}</h2>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* View Mode Toggle for Screenreader / Accessibility */}
          <div role="tablist" aria-label="Ansichtsmodus">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "visual"}
              aria-controls={`${containerId}-visual-panel`}
              id={`${containerId}-visual-tab`}
              onClick={() => setActiveTab("visual")}
              style={{
                padding: "6px 12px",
                fontWeight: activeTab === "visual" ? "bold" : "normal",
                cursor: "pointer"
              }}
            >
              Grafik (SVG)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "tree"}
              aria-controls={`${containerId}-tree-panel`}
              id={`${containerId}-tree-tab`}
              onClick={() => setActiveTab("tree")}
              style={{
                padding: "6px 12px",
                fontWeight: activeTab === "tree" ? "bold" : "normal",
                cursor: "pointer"
              }}
            >
              Baumliste (WAI-ARIA)
            </button>
          </div>

          {/* Zoom & Pan Controls */}
          <button
            type="button"
            aria-label="Vergrößern (Zoom In)"
            onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(1))))}
            style={{ minWidth: "44px", minHeight: "44px", cursor: "pointer" }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Verkleinern (Zoom Out)"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
            style={{ minWidth: "44px", minHeight: "44px", cursor: "pointer" }}
          >
            -
          </button>
          <button
            type="button"
            aria-label="Ansicht zurücksetzen"
            onClick={() => {
              setZoom(1.0);
              setPan({ x: 20, y: 20 });
            }}
            style={{ minHeight: "44px", padding: "0 10px", cursor: "pointer" }}
          >
            Reset
          </button>
        </div>
      </header>

      {/* Visual SVG Panel */}
      <div
        id={`${containerId}-visual-panel`}
        role="tabpanel"
        aria-labelledby={`${containerId}-visual-tab`}
        hidden={activeTab !== "visual"}
        style={{
          flex: 1,
          overflow: "auto",
          background: "#f8fafc",
          position: "relative",
          minHeight: "400px"
        }}
      >
        <svg
          data-testid="mindmap-svg"
          aria-label={`Interaktive Mindmap-Grafik: ${title}`}
          role="img"
          width="100%"
          height="100%"
          style={{ minWidth: "800px", minHeight: "600px", display: "block" }}
        >
          <title>{`Mindmap: ${title}`}</title>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Draw connecting lines (Bezier curves) */}
            {layout.connections.map((conn, idx) => {
              const dx = (conn.toX - conn.fromX) / 2;
              const pathD = `M ${conn.fromX} ${conn.fromY} C ${conn.fromX + dx} ${conn.fromY}, ${conn.toX - dx} ${conn.toY}, ${conn.toX} ${conn.toY}`;
              return (
                <path
                  key={`conn-${idx}-${conn.fromX}-${conn.fromY}-${conn.toX}-${conn.toY}`}
                  d={pathD}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                />
              );
            })}

            {/* Draw nodes */}
            {flatVisibleNodes.map((node) => {
              const isRoot = node.depth === 0;
              const hasSource = Boolean(node.sourceId || node.chunkId || node.sourceCitation);

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
                  style={{ cursor: "pointer" }}
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
                    rx="8"
                    ry="8"
                    fill={isRoot ? "#1e293b" : hasSource ? "#f0fdf4" : "#ffffff"}
                    stroke={isRoot ? "#0f172a" : hasSource ? "#16a34a" : "#cbd5e1"}
                    strokeWidth={isRoot ? "2" : "1.5"}
                  />
                  <text
                    x={node.width / 2}
                    y={node.height / 2 + 5}
                    textAnchor="middle"
                    fill={isRoot ? "#ffffff" : "#0f172a"}
                    fontSize="13"
                    fontFamily="system-ui, sans-serif"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {node.label}
                  </text>

                  {/* Collapse / Expand toggle button if node has children */}
                  {node.hasChildren && (
                    <g
                      transform={`translate(${node.width - 12}, ${node.height / 2})`}
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
                      <circle r="9" fill="#3b82f6" />
                      <text
                        textAnchor="middle"
                        y="3.5"
                        fill="#ffffff"
                        fontSize="11"
                        fontWeight="bold"
                        style={{ pointerEvents: "none" }}
                      >
                        {node.isCollapsed ? "+" : "-"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* WAI-ARIA Treeview Panel */}
      <div
        id={`${containerId}-tree-panel`}
        role="tabpanel"
        aria-labelledby={`${containerId}-tree-tab`}
        hidden={activeTab !== "tree"}
        style={{ flex: 1, padding: "16px", overflow: "auto", background: "#ffffff" }}
      >
        <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: "12px" }}>
          Tastaturnavigation: Pfeiltasten Hoch/Runter navigieren, Pfeil Rechts öffnet Zweig, Pfeil
          Links schließt Zweig, Enter/Leertaste springt zur Quelle.
        </p>

        <ul
          role="tree"
          aria-label={`Baumstruktur der Mindmap ${title}`}
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
          {flatVisibleNodes.map((node) => {
            const isFocused = node.id === focusedNodeId;
            const hasSource = Boolean(node.sourceId || node.chunkId || node.sourceCitation);

            return (
              <li
                key={node.id}
                role="treeitem"
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
                style={{
                  padding: "8px 12px",
                  marginLeft: `${node.depth * 20}px`,
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: isFocused ? "#e0f2fe" : "transparent",
                  outline: isFocused ? "2px solid #0284c7" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <span>
                  {node.hasChildren ? (node.isCollapsed ? "[+] " : "[-] ") : "• "}
                  <strong>{node.label}</strong>
                  {node.sourceCitation && (
                    <small style={{ marginLeft: "8px", color: "#16a34a" }}>
                      ({node.sourceCitation})
                    </small>
                  )}
                </span>

                {node.hasChildren && (
                  <button
                    type="button"
                    aria-label={`${node.isCollapsed ? "Erweitern" : "Einklappen"}: ${node.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(node.id);
                      setFocusedNodeId(node.id);
                    }}
                    style={{ minWidth: "32px", minHeight: "32px", cursor: "pointer" }}
                  >
                    {node.isCollapsed ? "+" : "-"}
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
