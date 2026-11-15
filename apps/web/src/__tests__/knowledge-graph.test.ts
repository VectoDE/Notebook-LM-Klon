import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MINDMAP, DEFAULT_SOURCES } from "../WorkspaceLayout.js";
import {
  ARC_LEFT,
  ARC_RIGHT,
  COLUMNS_MIN_WIDTH,
  GRAPH_PADDING,
  type KnowledgeGraph,
  MAX_ZOOM,
  MIN_FIT_ZOOM,
  MIN_ZOOM,
  buildKnowledgeGraph,
  conceptNodeId,
  degree,
  fitZoom,
  graphOffset,
  graphTabTarget,
  layoutGraph,
  layoutModeFor,
  mentions,
  nodeInDirection,
  nodeRelations,
  significantTerms,
  sourceNodeId,
  stepZoom,
  tokenize,
  wrapLabel
} from "../knowledge-graph.js";
import { preloadStudioViewers } from "../lazy-viewers.js";

// Studio-Viewer werden lazy geladen (#257); für Server-Render-Tests vorab laden.
beforeAll(() => preloadStudioViewers());

const demo = () => buildKnowledgeGraph(DEFAULT_SOURCES, DEFAULT_MINDMAP);

describe("Wissensgraph: Ableitung aus Quellen und Mindmap", () => {
  it("Begriffe kommen aus der Mindmap (ohne Wurzel), Quellen aus der Quellenliste", () => {
    const graph = demo();
    const concepts = graph.nodes.filter((n) => n.kind === "concept").map((n) => n.label);
    expect(concepts).toEqual([
      "Compute",
      "Single Worker (Hono)",
      "NotebookDO (In-Memory Vectors)",
      "Storage & RAG",
      "D1 SQLite Relational",
      "int8 Quantized Vectors"
    ]);
    const sources = graph.nodes.filter((n) => n.kind === "source");
    expect(sources.map((n) => n.label)).toEqual(DEFAULT_SOURCES.map((s) => s.title));
    expect(sources.map((n) => n.sourceId)).toEqual(["src_1", "src_2"]);
    // Oberbegriffe Spalte 0, Unterbegriffe 1, Quellen 2
    expect(graph.nodes.map((n) => n.level)).toEqual([0, 1, 1, 0, 1, 1, 2, 2]);
  });

  it("„hängt zusammen mit“ folgt der Gliederung, „kommt vor in“ dem Quelltext", () => {
    const graph = demo();
    const related = graph.edges.filter((e) => e.kind === "relatedTo");
    expect(related).toEqual([
      { from: "concept:cf_compute", to: "concept:cf_c1", kind: "relatedTo" },
      { from: "concept:cf_compute", to: "concept:cf_c2", kind: "relatedTo" },
      { from: "concept:cf_storage", to: "concept:cf_s1", kind: "relatedTo" },
      { from: "concept:cf_storage", to: "concept:cf_s2", kind: "relatedTo" }
    ]);
    const occurs = graph.edges
      .filter((e) => e.kind === "occursIn")
      .map((e) => `${e.from} -> ${e.to}`);
    expect(occurs).toEqual([
      "concept:cf_c1 -> source:src_1",
      "concept:cf_c2 -> source:src_1",
      "concept:cf_s1 -> source:src_2",
      // int8-Vektoren stehen im Architekturtext: Beziehung über die Gliederung hinweg
      "concept:cf_s2 -> source:src_1"
    ]);
  });

  it("verweist ein Mindmap-Eintrag selbst auf eine Quelle, entsteht die Kante auch ohne Wort", () => {
    const graph = buildKnowledgeGraph([{ id: "a", title: "Alpha" }], {
      id: "r",
      label: "Root",
      children: [{ id: "x", label: "Zeta", sourceId: "a" }]
    });
    expect(graph.edges).toEqual([{ from: "concept:x", to: "source:a", kind: "occursIn" }]);
  });

  it("ohne Mindmap nur Quellen, ohne Treffer keine Kante", () => {
    const graph = buildKnowledgeGraph([{ id: "a", title: "Alpha", rawText: "Beta" }], undefined);
    expect(graph.nodes).toEqual([
      { id: "source:a", kind: "source", label: "Alpha", level: 0, sourceId: "a" }
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("Wörter: klein, mit Bindestrich, Ziffern zählen", () => {
    expect(tokenize("In-Memory Vectors, D1 & FTS5")).toEqual([
      "in-memory",
      "vectors",
      "d1",
      "fts5"
    ]);
    expect(tokenize("   ")).toEqual([]);
    expect(significantTerms("D1 SQLite with RAG")).toEqual(["d1", "sqlite"]);
    expect(mentions(["d1"], new Set(["d1"]))).toBe(true);
    expect(mentions(["d1"], new Set(["d2"]))).toBe(false);
    expect(conceptNodeId("x")).toBe("concept:x");
    expect(sourceNodeId("y")).toBe("source:y");
  });

  it("Beziehungen und Grad eines Knotens", () => {
    const graph = demo();
    const src1 = nodeRelations(graph, "source:src_1");
    expect(src1.contains.map((n) => n.label)).toEqual([
      "Single Worker (Hono)",
      "NotebookDO (In-Memory Vectors)",
      "int8 Quantized Vectors"
    ]);
    expect(src1.occursIn).toEqual([]);
    const int8 = nodeRelations(graph, "concept:cf_s2");
    expect(int8.occursIn.map((n) => n.label)).toEqual([DEFAULT_SOURCES[0]?.title]);
    expect(int8.related.map((n) => n.label)).toEqual(["Storage & RAG"]);
    const storage = nodeRelations(graph, "concept:cf_storage");
    expect(storage.related.map((n) => n.label)).toEqual([
      "D1 SQLite Relational",
      "int8 Quantized Vectors"
    ]);
    expect(degree(graph, "source:src_1")).toBe(3);
    expect(degree(graph, "concept:cf_compute")).toBe(2);
  });

  it("Kanten zu unbekannten Knoten werden in Beziehungen und Anordnung übergangen", () => {
    const graph: KnowledgeGraph = {
      nodes: [{ id: "a", kind: "concept", label: "A", level: 0 }],
      edges: [
        { from: "a", to: "missing", kind: "occursIn" },
        { from: "missing", to: "a", kind: "relatedTo" }
      ]
    };
    expect(nodeRelations(graph, "a")).toEqual({ occursIn: [], contains: [], related: [] });
    expect(layoutGraph(graph, "columns").edges).toEqual([]);
  });
});

describe("Wissensgraph: Anordnung", () => {
  it("bricht Beschriftungen an Wortgrenzen um", () => {
    expect(wrapLabel("D1 SQLite Relational & FTS5 Hybrid Search")).toEqual([
      "D1 SQLite Relational",
      "& FTS5 Hybrid Search"
    ]);
    expect(wrapLabel("Compute")).toEqual(["Compute"]);
    expect(wrapLabel("Supercalifragilisticexpialidocious x", 10)).toEqual([
      "Supercalifragilisticexpialidocious",
      "x"
    ]);
    expect(wrapLabel("")).toEqual([""]);
  });

  it("Spalten: gleich breite Knoten, Spalten nebeneinander, mittig gestapelt", () => {
    const layout = layoutGraph(demo(), "columns");
    expect(layout.mode).toBe("columns");
    const widths = new Set(layout.nodes.map((n) => n.width));
    expect(widths.size).toBe(1);
    const width = layout.nodes[0]?.width ?? 0;
    expect(width).toBeGreaterThanOrEqual(160);
    expect(layout.width).toBe(3 * width + 2 * 72);
    const xs = [...new Set(layout.nodes.map((n) => n.x))];
    expect(xs).toEqual([0, width + 72, 2 * (width + 72)]);
    // Keine Überlappung in einer Spalte
    for (const x of xs) {
      const col = layout.nodes.filter((n) => n.x === x).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) {
        const prev = col[i - 1];
        const cur = col[i];
        if (prev && cur) expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.height);
      }
    }
    // Oberbegriff steht mittig vor seinen Unterbegriffen
    const center = (label: string) => {
      const n = layout.nodes.find((node) => node.label === label);
      return (n?.y ?? 0) + (n?.height ?? 0) / 2;
    };
    expect(center("Compute")).toBeCloseTo(
      (center("Single Worker (Hono)") + center("NotebookDO (In-Memory Vectors)")) / 2,
      0
    );
    expect(layout.height).toBe(
      Math.max(...layout.nodes.map((n) => n.y + n.height)) -
        Math.min(...layout.nodes.map((n) => n.y))
    );
    expect(layout.edges).toHaveLength(8);
    expect(layout.edges[0]?.d).toMatch(/^M [\d.]+ [\d.]+ C /);
    // Höhe: 1 Zeile 44 px, 2 Zeilen 64 px
    expect(layout.nodes.find((n) => n.label === "Compute")?.height).toBe(44);
    expect(layout.nodes.find((n) => n.label.startsWith("D1 SQLite Relational &"))?.height).toBe(64);
  });

  it("Stapel (Telefon): eine Spalte, Gliederung links, Vorkommen rechts", () => {
    const layout = layoutGraph(demo(), "stack");
    const width = layout.nodes[0]?.width ?? 0;
    expect(new Set(layout.nodes.map((n) => n.x))).toEqual(new Set([ARC_LEFT]));
    expect(layout.width).toBe(ARC_LEFT + width + ARC_RIGHT);
    const last = layout.nodes[layout.nodes.length - 1];
    expect(layout.height).toBe((last?.y ?? 0) + (last?.height ?? 0));
    const related = layout.edges.find((e) => e.kind === "relatedTo");
    const occurs = layout.edges.find((e) => e.kind === "occursIn");
    // Bogen links beginnt am linken Rand, rechts am rechten Rand
    expect(related?.d).toMatch(new RegExp(`^M ${ARC_LEFT} `));
    expect(occurs?.d).toMatch(new RegExp(`^M ${ARC_LEFT + width} `));
  });

  it("leerer Graph hat keine Fläche", () => {
    const empty = { nodes: [], edges: [] };
    expect(layoutGraph(empty, "columns")).toMatchObject({ width: 0, height: 0 });
    expect(layoutGraph(empty, "stack")).toMatchObject({ width: 0, height: 0 });
    // Nur Quellen: eine Spalte ab oben
    const only = layoutGraph(buildKnowledgeGraph(DEFAULT_SOURCES, undefined), "columns");
    expect(only.nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [0, 84]
    ]);
    expect(only.height).toBe(84 + 64);
  });

  it("Anordnung nach Breite der Fläche", () => {
    expect(layoutModeFor(COLUMNS_MIN_WIDTH)).toBe("columns");
    expect(layoutModeFor(COLUMNS_MIN_WIDTH - 1)).toBe("stack");
  });
});

describe("Wissensgraph: Einpassen und Zoom", () => {
  it("passt ein, höchstens 100 %, mindestens 75 %", () => {
    expect(fitZoom({ width: 200, height: 100 }, { width: 1000, height: 800 })).toBe(1);
    expect(fitZoom({ width: 760, height: 400 }, { width: 660, height: 800 })).toBe(0.82);
    expect(fitZoom({ width: 2000, height: 400 }, { width: 400, height: 800 })).toBe(MIN_FIT_ZOOM);
    expect(fitZoom({ width: 0, height: 0 }, { width: 400, height: 800 })).toBe(1);
    expect(fitZoom({ width: 10, height: 10 }, { width: 0, height: 0 })).toBe(1);
  });

  it("Zoomstufen bleiben in den Grenzen", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(0.82, -1)).toBe(0.57);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("Versatz: mittig, wenn schmaler, sonst Rand", () => {
    expect(graphOffset(400, 1, 1000)).toEqual({ x: 300, y: GRAPH_PADDING });
    expect(graphOffset(400, 1, 300)).toEqual({ x: GRAPH_PADDING, y: GRAPH_PADDING });
  });
});

describe("Wissensgraph: Tastatur", () => {
  const layout = layoutGraph(demo(), "columns");
  const label = (id: string | undefined) => layout.nodes.find((n) => n.id === id)?.label;

  it("Pfeiltasten wandern räumlich, Pos1/Ende an die Enden", () => {
    expect(label(nodeInDirection(layout.nodes, "concept:cf_compute", "ArrowRight"))).toBe(
      "Single Worker (Hono)"
    );
    expect(label(nodeInDirection(layout.nodes, "concept:cf_compute", "ArrowDown"))).toBe(
      "Storage & RAG"
    );
    expect(label(nodeInDirection(layout.nodes, "concept:cf_storage", "ArrowUp"))).toBe("Compute");
    expect(label(nodeInDirection(layout.nodes, "source:src_1", "ArrowLeft"))).toMatch(
      /NotebookDO|D1/
    );
    expect(nodeInDirection(layout.nodes, "concept:cf_c1", "Home")).toBe("concept:cf_compute");
    expect(nodeInDirection(layout.nodes, "concept:cf_c1", "End")).toBe("source:src_2");
  });

  it("am Rand bleibt der Fokus, fremde Tasten und unbekannte Knoten liefern nichts", () => {
    expect(nodeInDirection(layout.nodes, "concept:cf_compute", "ArrowLeft")).toBe(
      "concept:cf_compute"
    );
    expect(nodeInDirection(layout.nodes, "concept:cf_compute", "a")).toBeUndefined();
    expect(nodeInDirection(layout.nodes, "nope", "ArrowDown")).toBeUndefined();
  });

  it("Reiter Grafik/Liste nach APG", () => {
    expect(graphTabTarget("visual", "ArrowRight")).toBe("list");
    expect(graphTabTarget("list", "ArrowLeft")).toBe("visual");
    expect(graphTabTarget("list", "Home")).toBe("visual");
    expect(graphTabTarget("visual", "End")).toBe("list");
    expect(graphTabTarget("visual", "Enter")).toBeUndefined();
  });
});
