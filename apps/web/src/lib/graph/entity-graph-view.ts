/**
 * Anordnung und Demo-Daten des Beziehungsgraphen (Issue #238).
 *
 * Breite Fläche: je Art eine Spalte (Personen, Organisationen, Themen), Kanten zwischen den
 * Spalten als Kurven, Kanten innerhalb einer Spalte als Bögen rechts. Schmale Fläche: eine
 * Spalte, alle Kanten als Bögen. Das Modul ist rein (ohne DOM) und vollständig getestet.
 */

import {
  ENTITY_KINDS,
  type EntityEdge,
  type EntityGraph,
  type EntityKind,
  type EntityNode,
  type ReviewStatus
} from "@notebook-lm/shared";
import { type GraphLayoutMode, LINE_HEIGHT, wrapLabel } from "./knowledge-graph.js";

const CHAR_WIDTH = 8.6;
const PADDING_X = 16;
const PADDING_Y = 12;
const MIN_WIDTH = 160;
const COLUMN_GAP = 96;
const ROW_GAP = 20;
/** Platz rechts für Bögen zwischen Knoten derselben Spalte. */
export const ENTITY_ARC_SPACE = 88;

export interface PositionedEntity extends EntityNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

export interface PositionedEntityEdge extends EntityEdge {
  readonly d: string;
}

export interface EntityLayout {
  readonly mode: GraphLayoutMode;
  readonly nodes: readonly PositionedEntity[];
  readonly edges: readonly PositionedEntityEdge[];
  readonly width: number;
  readonly height: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Knoten in fester Reihenfolge: nach Art (Person, Organisation, Thema), sonst wie im Graphen. */
export function orderByKind(nodes: readonly EntityNode[]): EntityNode[] {
  return ENTITY_KINDS.flatMap((kind) => nodes.filter((n) => n.kind === kind));
}

export function layoutEntityGraph(graph: EntityGraph, mode: GraphLayoutMode): EntityLayout {
  const ordered = orderByKind(graph.nodes).map((node) => ({
    node,
    lines: wrapLabel(node.name)
  }));
  const longest = ordered.reduce((max, o) => Math.max(max, ...o.lines.map((l) => l.length)), 0);
  const width = Math.max(MIN_WIDTH, Math.ceil(longest * CHAR_WIDTH) + 2 * PADDING_X);
  const heightOf = (lines: readonly string[]) => 2 * PADDING_Y + lines.length * LINE_HEIGHT;

  const kinds: EntityKind[] =
    mode === "columns"
      ? ENTITY_KINDS.filter((kind) => ordered.some((o) => o.node.kind === kind))
      : [];
  const column = (kind: EntityKind) => (mode === "columns" ? kinds.indexOf(kind) : 0);
  const bottoms = new Map<number, number>();
  const nodes: PositionedEntity[] = ordered.map(({ node, lines }) => {
    const col = column(node.kind);
    const y = bottoms.get(col) ?? 0;
    const height = heightOf(lines);
    bottoms.set(col, y + height + ROW_GAP);
    return { ...node, x: col * (width + COLUMN_GAP), y, width, height, lines };
  });

  const columns = Math.max(1, kinds.length);
  const contentWidth =
    nodes.length > 0 ? columns * width + (columns - 1) * COLUMN_GAP + ENTITY_ARC_SPACE : 0;
  const contentHeight = Math.max(0, ...[...bottoms.values()].map((b) => b - ROW_GAP));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: PositionedEntityEdge[] = [];
  for (const edge of graph.edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    edges.push({ ...edge, d: entityEdgePath(a, b) });
  }
  return { mode, nodes, edges, width: contentWidth, height: contentHeight };
}

/** Kurve zwischen Spalten, Bogen rechts innerhalb einer Spalte. */
export function entityEdgePath(a: PositionedEntity, b: PositionedEntity): string {
  const ay = round(a.y + a.height / 2);
  const by = round(b.y + b.height / 2);
  if (a.x !== b.x) {
    const [left, right, ly, ry] = a.x < b.x ? [a, b, ay, by] : [b, a, by, ay];
    const x1 = left.x + left.width;
    const x2 = right.x;
    const dx = round((x2 - x1) / 2);
    return `M ${x1} ${ly} C ${x1 + dx} ${ly}, ${x2 - dx} ${ry}, ${x2} ${ry}`;
  }
  const x = a.x + a.width;
  const reach = round(Math.min(ENTITY_ARC_SPACE - 6, 12 + Math.abs(by - ay) / 4));
  return `M ${x} ${ay} C ${x + reach} ${ay}, ${x + reach} ${by}, ${x} ${by}`;
}

/** Schlüssel der Ansage je Statuswechsel: bestätigt, abgelehnt oder wiederhergestellt. */
export function announceKey(previous: ReviewStatus, next: ReviewStatus): string {
  if (next === "confirmed") return "egAnnounceConfirmed";
  if (next === "rejected") return "egAnnounceRejected";
  return previous === "rejected" ? "egAnnounceRestored" : "egAnnounceSaved";
}

/**
 * Demo-Notebook (Issue #238): Beziehungsgraph zu den beiden Demo-Quellen. Jedes Zitat steht
 * wörtlich im Volltext der Quelle (geprüft im Test). Die Quellen nennen keine Personen,
 * daher enthält auch der Graph keine; nichts ist erfunden. Ein Teil ist bestätigt, der Rest
 * wartet auf Prüfung, damit der Prüfablauf sichtbar ist.
 */
export const DEMO_ENTITY_GRAPH: EntityGraph = {
  nodes: [
    {
      id: "organization:cloudflare",
      kind: "organization",
      name: "Cloudflare",
      status: "confirmed"
    },
    {
      id: "topic:cloudflare-worker",
      kind: "topic",
      name: "Cloudflare Worker",
      status: "confirmed"
    },
    { id: "topic:notebookdo", kind: "topic", name: "NotebookDO", status: "confirmed" },
    {
      id: "topic:in-memory-vectors",
      kind: "topic",
      name: "In-Memory vectors",
      status: "suggested"
    },
    {
      id: "topic:int8-quantization",
      kind: "topic",
      name: "int8 quantization",
      status: "suggested"
    },
    { id: "topic:d1", kind: "topic", name: "D1", status: "confirmed" },
    { id: "topic:fts5", kind: "topic", name: "FTS5", status: "suggested" },
    { id: "topic:bm25-ranking", kind: "topic", name: "BM25 ranking", status: "suggested" },
    {
      id: "topic:hybrid-lexical-and-vector-search",
      kind: "topic",
      name: "Hybrid lexical and vector search",
      status: "suggested"
    }
  ],
  edges: [
    {
      id: "edge:1",
      from: "organization:cloudflare",
      to: "topic:cloudflare-worker",
      relation: "provides",
      status: "confirmed",
      evidence: {
        sourceId: "src_1",
        quote: "Cloudflare Worker serves as the single unified entry point."
      }
    },
    {
      id: "edge:2",
      from: "topic:notebookdo",
      to: "topic:in-memory-vectors",
      relation: "manages",
      status: "confirmed",
      evidence: { sourceId: "src_1", quote: "In-Memory vectors are managed inside NotebookDO" }
    },
    {
      id: "edge:3",
      from: "topic:in-memory-vectors",
      to: "topic:int8-quantization",
      relation: "use",
      status: "suggested",
      evidence: {
        sourceId: "src_1",
        quote: "In-Memory vectors are managed inside NotebookDO with int8 quantization."
      }
    },
    {
      id: "edge:4",
      from: "topic:d1",
      to: "topic:fts5",
      relation: "introduces",
      status: "suggested",
      evidence: { sourceId: "src_2", quote: "D1 Migration 0002 introduces FTS5 tables" }
    },
    {
      id: "edge:5",
      from: "topic:fts5",
      to: "topic:bm25-ranking",
      relation: "ranks with",
      status: "suggested",
      evidence: { sourceId: "src_2", quote: "FTS5 tables with BM25 ranking" }
    },
    {
      id: "edge:6",
      from: "topic:fts5",
      to: "topic:hybrid-lexical-and-vector-search",
      relation: "enables",
      status: "suggested",
      evidence: {
        sourceId: "src_2",
        quote: "FTS5 tables with BM25 ranking for hybrid lexical and vector search."
      }
    }
  ]
};
