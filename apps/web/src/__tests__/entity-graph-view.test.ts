import {
  type EntityGraph,
  EntityGraphSchema,
  type EntityNode,
  locateQuote
} from "@notebook-lm/shared";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntityGraphView } from "../EntityGraphView.js";
import { GraphViewer } from "../GraphViewer.js";
import { DEFAULT_MINDMAP, DEFAULT_SOURCES } from "../WorkspaceLayout.js";
import {
  DEMO_ENTITY_GRAPH,
  ENTITY_ARC_SPACE,
  announceKey,
  entityEdgePath,
  layoutEntityGraph,
  orderByKind
} from "../entity-graph-view.js";
import { buildKnowledgeGraph } from "../knowledge-graph.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

const node = (id: string, kind: EntityNode["kind"], name = id): EntityNode => ({
  id,
  kind,
  name,
  status: "suggested"
});

const SMALL: EntityGraph = {
  nodes: [
    node("t1", "topic", "Thema eins"),
    node("p1", "person", "Ada"),
    node("o1", "organization", "Archiv")
  ],
  edges: [
    {
      id: "e1",
      from: "p1",
      to: "o1",
      relation: "arbeitet bei",
      status: "confirmed",
      evidence: { sourceId: "s", quote: "q" }
    },
    {
      id: "e2",
      from: "t1",
      to: "p1",
      relation: "betrifft",
      status: "suggested",
      evidence: { sourceId: "s", quote: "q" }
    },
    {
      id: "e3",
      from: "p1",
      to: "missing",
      relation: "x",
      status: "suggested",
      evidence: { sourceId: "s", quote: "q" }
    }
  ]
};

describe("Beziehungsgraph: Anordnung (Issue #238)", () => {
  it("ordnet nach Art: Person, Organisation, Thema", () => {
    expect(orderByKind(SMALL.nodes).map((n) => n.id)).toEqual(["p1", "o1", "t1"]);
  });

  it("Spalten je Art, Kurven zwischen Spalten, Kanten ins Leere fallen weg", () => {
    const layout = layoutEntityGraph(SMALL, "columns");
    expect(layout.mode).toBe("columns");
    expect(layout.nodes.map((n) => [n.id, n.x, n.y])).toEqual([
      ["p1", 0, 0],
      ["o1", 256, 0],
      ["t1", 512, 0]
    ]);
    expect(layout.width).toBe(3 * 160 + 2 * 96 + ENTITY_ARC_SPACE);
    expect(layout.height).toBe(44);
    expect(layout.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(layout.edges[0]?.d).toBe("M 160 22 C 208 22, 208 22, 256 22");
    // Kante von rechts nach links: Kurve beginnt trotzdem am linken Knoten
    expect(layout.edges[1]?.d).toBe("M 160 22 C 336 22, 336 22, 512 22");
  });

  it("schmale Fläche: eine Spalte, Bögen rechts", () => {
    const layout = layoutEntityGraph(SMALL, "stack");
    expect(layout.nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [0, 64],
      [0, 128]
    ]);
    expect(layout.width).toBe(160 + ENTITY_ARC_SPACE);
    expect(layout.height).toBe(172);
    expect(layout.edges[0]?.d).toBe("M 160 22 C 188 22, 188 86, 160 86");
    const far = entityEdgePath(
      { ...node("a", "topic"), x: 0, y: 0, width: 160, height: 44, lines: ["a"] },
      { ...node("b", "topic"), x: 0, y: 2000, width: 160, height: 44, lines: ["b"] }
    );
    expect(far).toBe(
      `M 160 22 C ${160 + ENTITY_ARC_SPACE - 6} 22, ${160 + ENTITY_ARC_SPACE - 6} 2022, 160 2022`
    );
  });

  it("leerer Graph und lange Namen", () => {
    const empty = layoutEntityGraph({ nodes: [], edges: [] }, "columns");
    expect(empty).toMatchObject({ width: 0, height: 0, nodes: [], edges: [] });
    const long = layoutEntityGraph(
      { nodes: [node("x", "topic", "Ein sehr langer Name mit Umbruch über Zeilen")], edges: [] },
      "columns"
    );
    expect(long.nodes[0]?.lines.length).toBeGreaterThan(1);
    expect(long.nodes[0]?.width).toBeGreaterThan(160);
  });

  it("Ansage je Statuswechsel", () => {
    expect(announceKey("suggested", "confirmed")).toBe("egAnnounceConfirmed");
    expect(announceKey("confirmed", "rejected")).toBe("egAnnounceRejected");
    expect(announceKey("rejected", "suggested")).toBe("egAnnounceRestored");
    expect(announceKey("confirmed", "suggested")).toBe("egAnnounceSaved");
  });
});

describe("Beziehungsgraph: Demo-Notebook (Issue #238)", () => {
  it("ist gültig, und jedes Zitat steht wörtlich in seiner Demo-Quelle", () => {
    expect(EntityGraphSchema.parse(DEMO_ENTITY_GRAPH)).toEqual(DEMO_ENTITY_GRAPH);
    for (const edge of DEMO_ENTITY_GRAPH.edges) {
      const source = DEFAULT_SOURCES.find((s) => s.id === edge.evidence.sourceId);
      expect(source, edge.id).toBeDefined();
      expect(locateQuote(source?.rawText ?? "", edge.evidence.quote), edge.id).toBeDefined();
    }
    // Jeder Name steht in einer Quelle (Groß-/Kleinschreibung der Quelle kann abweichen)
    const all = DEFAULT_SOURCES.map((s) => s.rawText ?? "")
      .join(" ")
      .toLowerCase();
    for (const n of DEMO_ENTITY_GRAPH.nodes) {
      expect(all, n.name).toContain(n.name.toLowerCase());
    }
    expect(DEMO_ENTITY_GRAPH.nodes.some((n) => n.status === "suggested")).toBe(true);
    expect(DEMO_ENTITY_GRAPH.nodes.some((n) => n.status === "confirmed")).toBe(true);
  });
});

function renderEn(child: ReactNode): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, child)
  );
}

describe("Beziehungsgraph: Ansicht (Issue #238)", () => {
  const props = { graph: DEMO_ENTITY_GRAPH, sources: DEFAULT_SOURCES, contentLang: "en" };

  it("Grafik: ein Tab-Stopp, Name, Art, Prüfstatus und Zahl der Beziehungen", () => {
    const html = renderToStaticMarkup(createElement(EntityGraphView, props));
    expect(html).toContain("9 Einträge, 6 Beziehungen, 9 zu prüfen");
    expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/role="button" tabindex="-1"/g)).toHaveLength(8);
    expect(html).toContain('aria-label="Cloudflare, Organisation, Bestätigt, 1 Beziehungen"');
    expect(html).toContain('aria-label="FTS5, Thema, Zu prüfen, 3 Beziehungen"');
    expect(html).toContain("<title>Beziehungsgraph als Grafik</title>");
    expect(html.match(/class="rn-graph-edge" data-status="suggested"/g)).toHaveLength(5); // 4 Kanten + Legende;
    expect(html.match(/class="rn-graph-edge" data-status="confirmed"/g)).toHaveLength(2);
    expect(html).toMatch(/<text class="rn-graph-label" font-size="14" lang="en">/);
    expect(html).toContain("Wählen Sie einen Eintrag");
  });

  it("Filter: Arten mit Anzahl und Prüfstatus", () => {
    const html = renderToStaticMarkup(createElement(EntityGraphView, props));
    expect(html).toContain("Personen (0)");
    expect(html).toContain("Organisationen (1)");
    expect(html).toContain("Themen (8)");
    expect(html).toContain('<option value="open" selected="">Alle außer abgelehnten</option>');
    expect(html).toContain(">Zu prüfen</option>");
    expect(html.match(/<input type="checkbox"[^>]*checked=""/g)).toHaveLength(3);
  });

  it("Liste: Prüfung je Eintrag, Beziehungen mit Zitat und Sprung zur Stelle", () => {
    const html = renderToStaticMarkup(createElement(EntityGraphView, props));
    expect(html).toContain('data-testid="entity-item-topic:fts5-confirm"');
    expect(html).toContain('aria-label="FTS5 bestätigen"');
    expect(html).toContain('aria-label="FTS5 ablehnen"');
    expect(html).toContain('aria-label="FTS5 berichtigen"');
    // Bestätigte Einträge brauchen kein „Bestätigen“ mehr
    expect(html).not.toContain('data-testid="entity-item-organization:cloudflare-confirm"');
    expect(html).toContain("Beziehungen mit Beleg");
    expect(html).toContain(
      '<blockquote lang="en">D1 Migration 0002 introduces FTS5 tables</blockquote>'
    );
    expect(html).toContain("Beleg aus „D1 SQLite Relational &amp; FTS5 Hybrid Search“");
    expect(html).toContain('data-testid="entity-relation-jump-edge:4"');
    expect(html).toContain(
      'aria-label="Zitat in der Quelle D1 SQLite Relational &amp; FTS5 Hybrid Search zeigen: D1 – introduces → FTS5"'
    );
  });

  it("abgelehnte Einträge: Wiederherstellen statt Ablehnen; unbekannte Quelle benannt", () => {
    const graph: EntityGraph = {
      nodes: [{ ...node("a", "person", "A"), status: "rejected" }, node("b", "topic", "B")],
      edges: [
        {
          id: "e",
          from: "a",
          to: "b",
          relation: "kennt",
          status: "rejected",
          evidence: { sourceId: "weg", quote: "A kennt B" }
        }
      ]
    };
    const html = renderToStaticMarkup(createElement(EntityGraphView, { graph, sources: [] }));
    // Standardfilter blendet Abgelehntes aus
    expect(html).not.toContain('data-testid="entity-item-a"');
    expect(html).toContain('data-testid="entity-item-b"');
    const empty = renderToStaticMarkup(
      createElement(EntityGraphView, { graph: { nodes: [], edges: [] }, sources: [] })
    );
    expect(empty).toContain("Keine Einträge für diesen Filter");
  });

  it("englische Oberfläche", () => {
    const html = renderEn(createElement(EntityGraphView, props));
    for (const text of [
      "9 entries, 6 relations, 9 to review",
      "People (0)",
      "All except rejected",
      "Round: person",
      "Dashed: to review",
      "Relations with evidence",
      "Evidence from “Cloudflare Worker &amp; DO Architecture”",
      "Show in source",
      "Select an entry to see its relations and evidence."
    ]) {
      expect(html, text).toContain(text);
    }
  });

  it("im Wissensgraph umschaltbar: Begriffe oder Personen, Organisationen, Themen", () => {
    const graph = buildKnowledgeGraph(DEFAULT_SOURCES, DEFAULT_MINDMAP);
    const html = renderToStaticMarkup(
      createElement(GraphViewer, {
        graph,
        entityGraph: DEMO_ENTITY_GRAPH,
        entitySources: DEFAULT_SOURCES
      })
    );
    expect(html).toContain('<legend class="rn-visually-hidden">Art des Graphen</legend>');
    expect(html).toContain('aria-pressed="true" data-testid="graph-mode-concepts"');
    expect(html).toContain('aria-pressed="false" data-testid="graph-mode-entities"');
    expect(html).toContain("Personen, Organisationen, Themen");
    // Ohne Beziehungsgraph bleibt die Ansicht wie bisher
    const plain = renderToStaticMarkup(createElement(GraphViewer, { graph }));
    expect(plain).not.toContain("graph-mode-entities");
  });
});
