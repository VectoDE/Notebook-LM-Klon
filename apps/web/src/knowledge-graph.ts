/**
 * Wissensgraph der Quellen und ihrer Begriffe (Issue #327).
 *
 * Knoten sind Quellen und Kernbegriffe, Kanten sind „kommt vor in“ (Begriff → Quelle) und
 * „hängt zusammen mit“ (Oberbegriff → Unterbegriff). Alles wird aus vorhandenen Daten
 * abgeleitet, nichts wird erfunden:
 * - Begriffe sind die Einträge der Mindmap unterhalb der Wurzel (die Gliederung des Notebooks).
 * - „hängt zusammen mit“ folgt der Gliederung der Mindmap.
 * - „kommt vor in“ entsteht, wenn ein tragendes Wort des Begriffs im Titel oder Text einer
 *   Quelle steht, oder wenn der Mindmap-Eintrag selbst auf die Quelle verweist (sourceId).
 *
 * Die Mindmap zeigt die Gliederung, der Graph die Beziehungen über Quellen hinweg.
 * Das Modul ist rein (ohne DOM), damit Ableitung, Anordnung und Tastatur testbar sind.
 */

import type { MindmapNode } from "@notebook-lm/shared";

export type GraphNodeKind = "concept" | "source";
export type GraphEdgeKind = "occursIn" | "relatedTo";

export interface GraphSourceInput {
  readonly id: string;
  readonly title: string;
  readonly rawText?: string | undefined;
}

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** Spalte von links: Oberbegriffe 0, Unterbegriffe 1 …, Quellen ganz rechts. */
  readonly level: number;
  /** Nur bei Quellen: id der Quelle für den Sprung in die Quellenspalte. */
  readonly sourceId?: string | undefined;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
}

export interface KnowledgeGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** Füllwörter, die allein keinen Bezug zwischen Begriff und Quelle tragen. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "with",
  "from",
  "into",
  "that",
  "this",
  "over",
  "und",
  "oder",
  "über",
  "eine",
  "einer",
  "eines",
  "mit",
  "für",
  "der",
  "die",
  "das"
]);

/** Wörter eines Textes, klein geschrieben; Bindestrich-Wörter bleiben ganz. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []).map((word) =>
    word.normalize("NFC")
  );
}

/** Tragende Wörter eines Begriffs: mindestens 4 Zeichen oder mit Ziffer (z. B. „d1“, „int8“). */
export function significantTerms(label: string): string[] {
  return tokenize(label).filter(
    (word) => (word.length >= 4 || /\d/.test(word)) && !STOP_WORDS.has(word)
  );
}

/** Kommt einer der tragenden Begriffe als ganzes Wort in den Wörtern der Quelle vor? */
export function mentions(terms: readonly string[], sourceWords: ReadonlySet<string>): boolean {
  return terms.some((term) => sourceWords.has(term));
}

export const conceptNodeId = (mindmapId: string) => `concept:${mindmapId}`;
export const sourceNodeId = (sourceId: string) => `source:${sourceId}`;

/**
 * Leitet den Graphen aus Quellen und Mindmap ab. Reihenfolge: Begriffe in der Reihenfolge
 * der Mindmap (Oberbegriff, dann seine Unterbegriffe), danach die Quellen.
 */
export function buildKnowledgeGraph(
  sources: readonly GraphSourceInput[],
  mindmap: MindmapNode | undefined
): KnowledgeGraph {
  const concepts: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const conceptSources = new Map<string, string | undefined>();

  const walk = (node: MindmapNode, level: number, parentId: string | undefined) => {
    const id = conceptNodeId(node.id);
    concepts.push({ id, kind: "concept", label: node.label, level });
    conceptSources.set(id, node.sourceId);
    if (parentId) edges.push({ from: parentId, to: id, kind: "relatedTo" });
    for (const child of node.children ?? []) walk(child, level + 1, id);
  };
  for (const top of mindmap?.children ?? []) walk(top, 0, undefined);

  const sourceLevel = concepts.reduce((max, c) => Math.max(max, c.level + 1), 0);
  const sourceNodes: GraphNode[] = sources.map((s) => ({
    id: sourceNodeId(s.id),
    kind: "source",
    label: s.title,
    level: sourceLevel,
    sourceId: s.id
  }));

  const sourceWords = sources.map(
    (s) => new Set(tokenize(`${s.title} ${s.rawText ?? ""}`)) as ReadonlySet<string>
  );
  for (const concept of concepts) {
    const terms = significantTerms(concept.label);
    const linked = conceptSources.get(concept.id);
    sources.forEach((source, index) => {
      const words = sourceWords[index] as ReadonlySet<string>;
      if (linked === source.id || mentions(terms, words)) {
        edges.push({ from: concept.id, to: sourceNodeId(source.id), kind: "occursIn" });
      }
    });
  }

  return { nodes: [...concepts, ...sourceNodes], edges };
}

/** Beziehungen eines Knotens für Details und Textalternative. */
export interface NodeRelations {
  /** Begriff: Quellen, in denen er vorkommt. */
  readonly occursIn: readonly GraphNode[];
  /** Quelle: Begriffe, die in ihr vorkommen. */
  readonly contains: readonly GraphNode[];
  /** Begriff: Ober- und Unterbegriffe. */
  readonly related: readonly GraphNode[];
}

export function nodeRelations(graph: KnowledgeGraph, id: string): NodeRelations {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const pick = (ids: readonly string[]) =>
    ids.map((nodeId) => byId.get(nodeId)).filter((n): n is GraphNode => n !== undefined);
  const occursIn: string[] = [];
  const contains: string[] = [];
  const related: string[] = [];
  for (const edge of graph.edges) {
    if (edge.kind === "occursIn") {
      if (edge.from === id) occursIn.push(edge.to);
      if (edge.to === id) contains.push(edge.from);
    } else if (edge.from === id) {
      related.push(edge.to);
    } else if (edge.to === id) {
      related.push(edge.from);
    }
  }
  return { occursIn: pick(occursIn), contains: pick(contains), related: pick(related) };
}

/** Anzahl der Verbindungen eines Knotens. */
export function degree(graph: KnowledgeGraph, id: string): number {
  return graph.edges.filter((e) => e.from === id || e.to === id).length;
}

/* --------------------------------------------------------------------------
   Anordnung
   -------------------------------------------------------------------------- */

/** Schriftgröße der Beschriftung in px (Minimum 14 px). */
export const GRAPH_FONT_SIZE = 14;
/** Zeichen je Zeile, bevor die Beschriftung umbricht. */
export const WRAP_CHARS = 20;
/** Konservative Breite je Zeichen bei 14 px Inter (600), damit nichts abgeschnitten wird. */
const CHAR_WIDTH = 8.6;
const LABEL_PADDING_X = 16;
const LABEL_PADDING_Y = 12;
export const LINE_HEIGHT = 20;
/** Mindestbreite eines Knotens. */
const MIN_NODE_WIDTH = 160;
/** Abstand zwischen den Spalten, Abstand zwischen Knoten einer Spalte, Rand. */
const COLUMN_GAP = 72;
const ROW_GAP = 20;
const STACK_GAP = 16;
/** Platz für die Bögen links (Gliederung, kurze Wege) und rechts (Vorkommen, lange Wege). */
export const ARC_LEFT = 48;
export const ARC_RIGHT = 88;

/** Bricht eine Beschriftung an Wortgrenzen um; zu lange Einzelwörter bleiben ganz. */
export function wrapLabel(label: string, maxChars = WRAP_CHARS): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

export interface PositionedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

export interface PositionedEdge extends GraphEdge {
  /** SVG-Pfad der Kante. */
  readonly d: string;
}

export type GraphLayoutMode = "columns" | "stack";

export interface GraphLayout {
  readonly mode: GraphLayoutMode;
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly width: number;
  readonly height: number;
}

/** Breite Fläche: Spalten nebeneinander. Schmale Fläche (Telefon): eine Spalte mit Bögen. */
export const COLUMNS_MIN_WIDTH = 760;

export function layoutModeFor(canvasWidth: number): GraphLayoutMode {
  return canvasWidth >= COLUMNS_MIN_WIDTH ? "columns" : "stack";
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Ordnet die Knoten an. „columns“: Oberbegriffe, Unterbegriffe und Quellen als Spalten von
 * links nach rechts, Kanten als Kurven. „stack“: alle Knoten untereinander in Graph-Reihenfolge;
 * Gliederung als Bögen links, Vorkommen als Bögen rechts. Alle Knoten sind gleich breit.
 */
export function layoutGraph(graph: KnowledgeGraph, mode: GraphLayoutMode): GraphLayout {
  const wrapped = graph.nodes.map((n) => ({ node: n, lines: wrapLabel(n.label) }));
  const longest = wrapped.reduce(
    (max, w) => Math.max(max, ...w.lines.map((line) => line.length)),
    0
  );
  const width = Math.max(MIN_NODE_WIDTH, Math.ceil(longest * CHAR_WIDTH) + 2 * LABEL_PADDING_X);
  const heightOf = (lines: readonly string[]) => 2 * LABEL_PADDING_Y + lines.length * LINE_HEIGHT;

  const positioned: PositionedNode[] = [];
  let contentW: number;
  let contentH: number;

  if (mode === "columns") {
    const levels = graph.nodes.reduce((max, n) => Math.max(max, n.level), -1) + 1;
    const columns: (typeof wrapped)[] = Array.from({ length: levels }, () => []);
    for (const w of wrapped) (columns[w.node.level] as typeof wrapped).push(w);
    const heights = new Map(wrapped.map((w) => [w.node.id, heightOf(w.lines)]));
    const height = (id: string) => heights.get(id) as number;
    const children = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.kind !== "relatedTo") continue;
      children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
    }
    // Begriffe von der tiefsten Ebene her: Oberbegriffe stehen mittig vor ihren Unterbegriffen
    const ys = new Map<string, number>();
    let conceptBottom = 0;
    for (let level = levels - 1; level >= 0; level--) {
      let bottom = -ROW_GAP;
      for (const w of columns[level] as typeof wrapped) {
        if (w.node.kind !== "concept") continue;
        const id = w.node.id;
        const kids = (children.get(id) ?? []).filter((kid) => ys.has(kid));
        const desired =
          kids.length > 0
            ? kids.reduce((sum, kid) => sum + (ys.get(kid) as number) + height(kid) / 2, 0) /
                kids.length -
              height(id) / 2
            : bottom + ROW_GAP;
        const y = Math.max(desired, bottom + ROW_GAP);
        ys.set(id, y);
        bottom = y + height(id);
        conceptBottom = Math.max(conceptBottom, bottom);
      }
    }
    // Quellen: eigene Spalte, mittig zur Höhe der Begriffe
    const sourceRows = wrapped.filter((w) => w.node.kind === "source");
    const sourceHeight =
      sourceRows.reduce((sum, w) => sum + height(w.node.id), 0) +
      Math.max(0, sourceRows.length - 1) * ROW_GAP;
    let sourceY = Math.max(0, (conceptBottom - sourceHeight) / 2);
    for (const w of sourceRows) {
      ys.set(w.node.id, sourceY);
      sourceY += height(w.node.id) + ROW_GAP;
    }
    contentH = Math.max(conceptBottom, sourceHeight);
    for (const w of wrapped) {
      positioned.push({
        ...w.node,
        x: w.node.level * (width + COLUMN_GAP),
        y: round(ys.get(w.node.id) as number),
        width,
        height: height(w.node.id),
        lines: w.lines
      });
    }
    contentW = levels > 0 ? levels * width + (levels - 1) * COLUMN_GAP : 0;
  } else {
    let y = 0;
    for (const w of wrapped) {
      const height = heightOf(w.lines);
      positioned.push({ ...w.node, x: ARC_LEFT, y, width, height, lines: w.lines });
      y += height + STACK_GAP;
    }
    contentW = graph.nodes.length > 0 ? ARC_LEFT + width + ARC_RIGHT : 0;
    contentH = Math.max(0, y - STACK_GAP);
  }

  const byId = new Map(positioned.map((n) => [n.id, n]));
  const edges: PositionedEdge[] = [];
  for (const edge of graph.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    edges.push({ ...edge, d: edgePath(a, b, edge.kind, mode) });
  }

  return { mode, nodes: positioned, edges, width: contentW, height: contentH };
}

function edgePath(
  a: PositionedNode,
  b: PositionedNode,
  kind: GraphEdgeKind,
  mode: GraphLayoutMode
): string {
  const ay = a.y + a.height / 2;
  const by = b.y + b.height / 2;
  if (mode === "columns") {
    const ax = a.x + a.width;
    const bx = b.x;
    const dx = (bx - ax) / 2;
    return `M ${ax} ${round(ay)} C ${round(ax + dx)} ${round(ay)}, ${round(bx - dx)} ${round(by)}, ${bx} ${round(by)}`;
  }
  // Bögen: Gliederung links, Vorkommen rechts; weiter auseinander = weiter ausholen
  const left = kind === "relatedTo";
  const x = left ? a.x : a.x + a.width;
  // Bögen fächern nach Länge auf, damit sie sich nicht decken
  const reach = Math.min((left ? ARC_LEFT : ARC_RIGHT) - 6, 12 + Math.abs(by - ay) / 4);
  const cx = left ? x - reach : x + reach;
  return `M ${x} ${round(ay)} C ${round(cx)} ${round(ay)}, ${round(cx)} ${round(by)}, ${x} ${round(by)}`;
}

/* --------------------------------------------------------------------------
   Einpassen und Zoom
   -------------------------------------------------------------------------- */

/** Rand um den eingepassten Graphen in px. */
export const GRAPH_PADDING = 20;
/** Kleinster Zoom beim Einpassen: Beschriftung bleibt bei 14 px mal 0,75 noch lesbar. */
export const MIN_FIT_ZOOM = 0.75;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.25;

/**
 * Zoom zum Einpassen: so groß wie möglich bis 100 %, damit der ganze Graph in die Fläche
 * passt; nie kleiner als 75 % (Lesbarkeit). Passt er dann nicht, scrollt die Fläche.
 */
export function fitZoom(
  content: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number }
): number {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }
  const zoom = Math.min(
    1,
    (viewport.width - 2 * GRAPH_PADDING) / content.width,
    (viewport.height - 2 * GRAPH_PADDING) / content.height
  );
  return Number(Math.max(MIN_FIT_ZOOM, zoom).toFixed(2));
}

/** Nächste Zoomstufe für „+“ (1) oder „−“ (-1) innerhalb der Grenzen. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = Math.round((zoom + direction * ZOOM_STEP) * 100) / 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/** Versatz des Graphen: waagerecht mittig, wenn er schmaler als die Fläche ist. */
export function graphOffset(
  contentWidth: number,
  zoom: number,
  viewportWidth: number
): { readonly x: number; readonly y: number } {
  const free = viewportWidth - contentWidth * zoom;
  return { x: Math.round(Math.max(GRAPH_PADDING, free / 2)), y: GRAPH_PADDING };
}

/* --------------------------------------------------------------------------
   Tastatur
   -------------------------------------------------------------------------- */

/**
 * Pfeiltasten wandern zum nächsten Knoten in Pfeilrichtung (räumlich), Pos1/Ende zum ersten
 * bzw. letzten Knoten. Liefert die id des Ziels, die aktuelle id, wenn es in der Richtung
 * keinen Knoten gibt, oder undefined für andere Tasten.
 */
export function nodeInDirection(
  nodes: readonly PositionedNode[],
  currentId: string,
  key: string
): string | undefined {
  const current = nodes.find((n) => n.id === currentId);
  if (!current) return undefined;
  if (key === "Home") return (nodes[0] as PositionedNode).id;
  if (key === "End") return (nodes[nodes.length - 1] as PositionedNode).id;
  const axis: Readonly<Record<string, { dx: number; dy: number }>> = {
    ArrowRight: { dx: 1, dy: 0 },
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowDown: { dx: 0, dy: 1 },
    ArrowUp: { dx: 0, dy: -1 }
  };
  const dir = axis[key];
  if (!dir) return undefined;
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  let best: { id: string; score: number } | undefined;
  for (const node of nodes) {
    if (node.id === currentId) continue;
    const dx = node.x + node.width / 2 - cx;
    const dy = node.y + node.height / 2 - cy;
    // Abstand in Pfeilrichtung muss positiv sein; seitliche Abweichung zählt doppelt
    const along = dx * dir.dx + dy * dir.dy;
    if (along <= 1) continue;
    const across = Math.abs(dir.dx !== 0 ? dy : dx);
    const score = along + 2 * across;
    if (!best || score < best.score) best = { id: node.id, score };
  }
  return best?.id ?? currentId;
}

export type GraphTab = "visual" | "list";
export const GRAPH_TABS: readonly GraphTab[] = ["visual", "list"];

/** Reiter nach APG „Tabs“: Pfeil links/rechts mit Umlauf, Pos1/Ende. */
export function graphTabTarget(current: GraphTab, key: string): GraphTab | undefined {
  const other: GraphTab = current === "visual" ? "list" : "visual";
  switch (key) {
    case "ArrowRight":
    case "ArrowLeft":
      return other;
    case "Home":
      return "visual";
    case "End":
      return "list";
    default:
      return undefined;
  }
}
