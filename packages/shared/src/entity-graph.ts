/**
 * Beziehungsgraph aus Quellen (Issue #238): Personen, Organisationen und Themen als Knoten,
 * Beziehungen als Kanten. Jede Kante trägt einen Beleg: Quelle und wörtliches Zitat.
 *
 * Grundsätze:
 * - Nichts wird erfunden. Eine Kante ohne wörtlich auffindbares Zitat in ihrer Quelle wird
 *   verworfen (siehe normalizeEntityExtraction).
 * - Die KI schlägt vor, der Mensch entscheidet: Alles beginnt als „suggested“ und wird über
 *   applyEntityCorrection bestätigt, abgelehnt oder berichtigt.
 * - Das Modul ist rein (ohne DOM, ohne Netz), damit Modell, Prüfung und Korrektur testbar sind.
 */

import { z } from "zod";

export const ENTITY_KINDS = ["person", "organization", "topic"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const REVIEW_STATUSES = ["suggested", "confirmed", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Längen für Namen, Beziehungen und Zitate: kurz genug für Anzeige und Prompt-Budget. */
export const ENTITY_NAME_MAX = 120;
export const RELATION_MAX = 120;
export const QUOTE_MAX = 600;

export const EntityEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  quote: z.string().min(1).max(QUOTE_MAX),
  chunkId: z.string().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional()
});
export type EntityEvidence = z.infer<typeof EntityEvidenceSchema>;

export const EntityNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1).max(ENTITY_NAME_MAX),
  status: z.enum(REVIEW_STATUSES)
});
export type EntityNode = z.infer<typeof EntityNodeSchema>;

export const EntityEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1).max(RELATION_MAX),
  evidence: EntityEvidenceSchema,
  status: z.enum(REVIEW_STATUSES)
});
export type EntityEdge = z.infer<typeof EntityEdgeSchema>;

export const EntityGraphSchema = z
  .object({
    nodes: z.array(EntityNodeSchema),
    edges: z.array(EntityEdgeSchema)
  })
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: "custom", message: `Doppelte Knoten-id: ${node.id}` });
      }
      ids.add(node.id);
    }
    for (const edge of graph.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        ctx.addIssue({ code: "custom", message: `Kante ${edge.id} verweist ins Leere` });
      }
    }
  });
export type EntityGraph = z.infer<typeof EntityGraphSchema>;

/* --------------------------------------------------------------------------
   Rohantwort der KI und Prüfung gegen die Quellen
   -------------------------------------------------------------------------- */

/** Was das Sprachmodell liefern soll: Namen statt ids, je Beziehung Quelle und Zitat. */
export const EntityExtractionResultSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(ENTITY_KINDS)
    })
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      relation: z.string(),
      sourceId: z.string(),
      quote: z.string()
    })
  )
});
export type EntityExtractionResult = z.infer<typeof EntityExtractionResultSchema>;

export interface EntitySourceText {
  readonly id: string;
  readonly text: string;
}

/** Gründe, aus denen eine vorgeschlagene Beziehung verworfen wurde. */
export type DroppedRelationReason =
  | "unknownEntity"
  | "selfLoop"
  | "unknownSource"
  | "quoteNotFound"
  | "emptyRelation"
  | "duplicate";

export interface DroppedRelation {
  readonly from: string;
  readonly to: string;
  readonly reason: DroppedRelationReason;
}

export interface NormalizedExtraction {
  readonly graph: EntityGraph;
  readonly dropped: readonly DroppedRelation[];
}

/** Leerraum zusammenfassen und kürzen: für Namen, Beziehungen und den Zitatvergleich. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'"
};

/** Macht XML-Maskierung rückgängig, die der Prompt-Schutz in Quelltexte einfügt. */
export function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => XML_ENTITIES[m] as string);
}

/** Schlüssel für die Zusammenführung gleicher Namen (Groß-/Kleinschreibung, Leerraum). */
export function entityKey(name: string): string {
  return collapseWhitespace(name).normalize("NFC").toLocaleLowerCase("de");
}

/** Stabile, lesbare id aus Art und Name, z. B. „organization:cloudflare“. */
export function entityId(kind: EntityKind, name: string): string {
  const slug = entityKey(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${kind}:${slug || "x"}`;
}

/**
 * Findet ein Zitat wörtlich in der Quelle. Leerraum darf abweichen (Zeilenumbrüche in PDFs),
 * sonst muss jedes Zeichen stimmen. Liefert Start und Ende im Originaltext.
 */
export function locateQuote(
  text: string,
  quote: string
): { readonly start: number; readonly end: number; readonly quote: string } | undefined {
  const wanted = collapseWhitespace(unescapeXml(quote));
  if (!wanted) return undefined;
  const escaped = wanted
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(escaped, "u").exec(text);
  if (!match) return undefined;
  return { start: match.index, end: match.index + match[0].length, quote: match[0] };
}

/**
 * Prüft die Rohantwort der KI gegen die Quellen und baut daraus den Graphen:
 * - Namen werden zusammengeführt (gleicher Schlüssel = ein Knoten, erste Art gewinnt).
 * - Beziehungen brauchen bekannte Personen/Organisationen/Themen, eine bekannte Quelle und
 *   ein Zitat, das wörtlich in dieser Quelle steht. Sonst werden sie verworfen und gemeldet.
 * - Knoten ohne belegte Beziehung bleiben erhalten, wenn ihr Name wörtlich in einer Quelle
 *   steht; erfundene Namen ohne Beleg fallen weg.
 * - Alles startet als „suggested“: Der Mensch prüft.
 */
export function normalizeEntityExtraction(
  raw: EntityExtractionResult,
  sources: readonly EntitySourceText[]
): NormalizedExtraction {
  const nodes = new Map<string, EntityNode>();
  for (const entity of raw.entities) {
    const name = collapseWhitespace(entity.name).slice(0, ENTITY_NAME_MAX);
    const key = entityKey(name);
    if (!key || nodes.has(key)) continue;
    nodes.set(key, {
      id: entityId(entity.kind, name),
      kind: entity.kind,
      name,
      status: "suggested"
    });
  }

  const textById = new Map(sources.map((s) => [s.id, s.text]));
  const edges: EntityEdge[] = [];
  const dropped: DroppedRelation[] = [];
  const seen = new Set<string>();
  const used = new Set<string>();

  for (const rel of raw.relations) {
    const drop = (reason: DroppedRelationReason) =>
      dropped.push({ from: rel.from, to: rel.to, reason });
    const from = nodes.get(entityKey(rel.from));
    const to = nodes.get(entityKey(rel.to));
    if (!from || !to) {
      drop("unknownEntity");
      continue;
    }
    if (from.id === to.id) {
      drop("selfLoop");
      continue;
    }
    const relation = collapseWhitespace(rel.relation).slice(0, RELATION_MAX);
    if (!relation) {
      drop("emptyRelation");
      continue;
    }
    const text = textById.get(rel.sourceId);
    if (text === undefined) {
      drop("unknownSource");
      continue;
    }
    const found = locateQuote(text, rel.quote);
    if (!found || found.quote.length > QUOTE_MAX) {
      drop("quoteNotFound");
      continue;
    }
    const signature = `${from.id}|${to.id}|${entityKey(relation)}|${rel.sourceId}`;
    if (seen.has(signature)) {
      drop("duplicate");
      continue;
    }
    seen.add(signature);
    used.add(from.id);
    used.add(to.id);
    edges.push({
      id: `edge:${edges.length + 1}`,
      from: from.id,
      to: to.id,
      relation,
      evidence: {
        sourceId: rel.sourceId,
        quote: found.quote,
        startOffset: found.start,
        endOffset: found.end
      },
      status: "suggested"
    });
  }

  const allText = sources.map((s) => s.text).join("\n");
  const keptNodes = [...nodes.values()].filter(
    (node) => used.has(node.id) || locateQuote(allText, node.name) !== undefined
  );
  // Gleiche ids aus verschiedenen Namen (z. B. „C++“ und „C“) wären doppelt: erste gewinnt
  const unique = new Map<string, EntityNode>();
  for (const node of keptNodes) if (!unique.has(node.id)) unique.set(node.id, node);
  const ids = new Set(unique.keys());
  return {
    graph: {
      nodes: [...unique.values()],
      edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    },
    dropped
  };
}

/* --------------------------------------------------------------------------
   Prüfen und Korrigieren durch den Menschen
   -------------------------------------------------------------------------- */

export type EntityCorrection =
  | { readonly type: "setNodeStatus"; readonly id: string; readonly status: ReviewStatus }
  | { readonly type: "renameNode"; readonly id: string; readonly name: string }
  | { readonly type: "setNodeKind"; readonly id: string; readonly kind: EntityKind }
  | { readonly type: "setEdgeStatus"; readonly id: string; readonly status: ReviewStatus }
  | { readonly type: "editEdgeRelation"; readonly id: string; readonly relation: string };

/**
 * Wendet eine Korrektur an und liefert einen neuen Graphen (unveränderlich).
 * Umbenennen und Bearbeiten gelten als Prüfung: Der Eintrag wird „confirmed“.
 * Leere Namen oder Beziehungen werden ignoriert, damit kein Eintrag unlesbar wird.
 */
export function applyEntityCorrection(
  graph: EntityGraph,
  correction: EntityCorrection
): EntityGraph {
  switch (correction.type) {
    case "setNodeStatus":
      return mapNode(graph, correction.id, (n) => ({ ...n, status: correction.status }));
    case "renameNode": {
      const name = collapseWhitespace(correction.name).slice(0, ENTITY_NAME_MAX);
      if (!name) return graph;
      return mapNode(graph, correction.id, (n) => ({ ...n, name, status: "confirmed" }));
    }
    case "setNodeKind":
      return mapNode(graph, correction.id, (n) => ({
        ...n,
        kind: correction.kind,
        status: "confirmed"
      }));
    case "setEdgeStatus":
      return mapEdge(graph, correction.id, (e) => ({ ...e, status: correction.status }));
    case "editEdgeRelation": {
      const relation = collapseWhitespace(correction.relation).slice(0, RELATION_MAX);
      if (!relation) return graph;
      return mapEdge(graph, correction.id, (e) => ({ ...e, relation, status: "confirmed" }));
    }
  }
}

function mapNode(graph: EntityGraph, id: string, fn: (n: EntityNode) => EntityNode): EntityGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? fn(n) : n)) };
}

function mapEdge(graph: EntityGraph, id: string, fn: (e: EntityEdge) => EntityEdge): EntityGraph {
  return { ...graph, edges: graph.edges.map((e) => (e.id === id ? fn(e) : e)) };
}

/* --------------------------------------------------------------------------
   Filter für Ansicht und Liste
   -------------------------------------------------------------------------- */

/** „open“: alles außer Abgelehntem (Standard). Sonst genau dieser Prüfstatus. */
export type EntityStatusFilter = "open" | ReviewStatus;
export const ENTITY_STATUS_FILTERS: readonly EntityStatusFilter[] = [
  "open",
  "suggested",
  "confirmed",
  "rejected"
];

export interface EntityGraphFilter {
  readonly kinds: readonly EntityKind[];
  readonly status: EntityStatusFilter;
}

export const DEFAULT_ENTITY_FILTER: EntityGraphFilter = {
  kinds: ENTITY_KINDS,
  status: "open"
};

const matchesStatus = (status: ReviewStatus, filter: EntityStatusFilter) =>
  filter === "open" ? status !== "rejected" : status === filter;

/**
 * Sichtbarer Ausschnitt: Kanten passen zum Statusfilter und verbinden zwei Knoten der
 * gewählten Arten, die nicht abgelehnt sind (außer der Filter zeigt Abgelehntes).
 * Knoten passen zum Filter oder hängen an einer sichtbaren Kante.
 */
export function filterEntityGraph(graph: EntityGraph, filter: EntityGraphFilter): EntityGraph {
  const kinds = new Set(filter.kinds);
  const showRejected = filter.status === "rejected";
  const usable = new Map(
    graph.nodes
      .filter((n) => kinds.has(n.kind) && (showRejected || n.status !== "rejected"))
      .map((n) => [n.id, n])
  );
  const edges = graph.edges.filter(
    (e) => usable.has(e.from) && usable.has(e.to) && matchesStatus(e.status, filter.status)
  );
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = [...usable.values()].filter(
    (n) => linked.has(n.id) || matchesStatus(n.status, filter.status)
  );
  return { nodes, edges };
}

/** Kanten eines Knotens (ein- und ausgehend), in Graph-Reihenfolge. */
export function edgesOf(graph: EntityGraph, nodeId: string): EntityEdge[] {
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/** Zählt Knoten je Art, für die Filterbeschriftung. */
export function countByKind(graph: EntityGraph): Record<EntityKind, number> {
  const counts: Record<EntityKind, number> = { person: 0, organization: 0, topic: 0 };
  for (const node of graph.nodes) counts[node.kind] += 1;
  return counts;
}
