import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTITY_FILTER,
  type EntityExtractionResult,
  type EntityGraph,
  EntityGraphSchema,
  applyEntityCorrection,
  collapseWhitespace,
  countByKind,
  edgesOf,
  entityId,
  entityKey,
  filterEntityGraph,
  locateQuote,
  normalizeEntityExtraction,
  unescapeXml
} from "../entity-graph.js";

const SOURCES = [
  {
    id: "src_a",
    text: "Ada Lovelace arbeitete mit Charles Babbage\nan der Analytical Engine. Die Royal Society & das Archiv bewahren Briefe."
  },
  { id: "src_b", text: "Die Analytical Engine gilt als Vorläufer des Computers." }
];

const RAW: EntityExtractionResult = {
  entities: [
    { name: "Ada  Lovelace", kind: "person" },
    { name: "Charles Babbage", kind: "person" },
    { name: "Analytical Engine", kind: "topic" },
    { name: "analytical engine", kind: "organization" },
    { name: "Royal Society", kind: "organization" },
    { name: "Erfundene GmbH", kind: "organization" },
    { name: "   ", kind: "topic" },
    { name: "Computers", kind: "topic" }
  ],
  relations: [
    {
      from: "Ada Lovelace",
      to: "Charles Babbage",
      relation: "arbeitete mit",
      sourceId: "src_a",
      quote: "Ada Lovelace arbeitete mit Charles Babbage an der Analytical Engine"
    },
    {
      from: "ada lovelace",
      to: "Charles Babbage",
      relation: "arbeitete  mit",
      sourceId: "src_a",
      quote: "Ada Lovelace arbeitete mit"
    },
    {
      from: "Royal Society",
      to: "Ada Lovelace",
      relation: "bewahrt Briefe",
      sourceId: "src_a",
      quote: "Die Royal Society &amp; das Archiv bewahren Briefe."
    },
    { from: "Ada Lovelace", to: "Niemand", relation: "kennt", sourceId: "src_a", quote: "Ada" },
    { from: "Ada Lovelace", to: "Ada Lovelace", relation: "ist", sourceId: "src_a", quote: "Ada" },
    {
      from: "Ada Lovelace",
      to: "Charles Babbage",
      relation: "  ",
      sourceId: "src_a",
      quote: "Ada"
    },
    {
      from: "Analytical Engine",
      to: "Computers",
      relation: "Vorläufer von",
      sourceId: "src_x",
      quote: "Vorläufer"
    },
    {
      from: "Analytical Engine",
      to: "Computers",
      relation: "Vorläufer von",
      sourceId: "src_b",
      quote: "gilt als Nachfolger"
    },
    {
      from: "Analytical Engine",
      to: "Computers",
      relation: "Vorläufer von",
      sourceId: "src_b",
      quote: "gilt als Vorläufer des Computers"
    }
  ]
};

describe("Beziehungsgraph: Datenmodell und Prüfung gegen die Quellen (Issue #238)", () => {
  it("Hilfsfunktionen: Leerraum, XML, Schlüssel und ids", () => {
    expect(collapseWhitespace("  a \n b\t")).toBe("a b");
    expect(unescapeXml("A &amp; B &lt;x&gt; &quot;q&quot; &#39;s&apos;")).toBe(
      "A & B <x> \"q\" 's'"
    );
    expect(entityKey(" Ada  LOVELACE ")).toBe("ada lovelace");
    expect(entityId("person", "Émile Zola")).toBe("person:emile-zola");
    expect(entityId("topic", "!!!")).toBe("topic:x");
  });

  it("findet Zitate wörtlich, auch über Zeilenumbrüche, sonst nicht", () => {
    const text = SOURCES[0]?.text as string;
    const hit = locateQuote(text, "Charles Babbage an der");
    expect(hit?.quote).toBe("Charles Babbage\nan der");
    expect(text.slice(hit?.start, hit?.end)).toBe(hit?.quote);
    expect(locateQuote(text, "Royal (Society)")).toBeUndefined();
    expect(locateQuote(text, "   ")).toBeUndefined();
    expect(locateQuote(text, "Grace Hopper")).toBeUndefined();
  });

  it("baut den Graphen nur aus belegten Beziehungen und meldet Verworfenes", () => {
    const { graph, dropped } = normalizeEntityExtraction(RAW, SOURCES);
    expect(EntityGraphSchema.parse(graph)).toEqual(graph);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "person:ada-lovelace",
      "person:charles-babbage",
      "topic:analytical-engine",
      "organization:royal-society",
      "topic:computers"
    ]);
    expect(graph.nodes.every((n) => n.status === "suggested")).toBe(true);
    // „Erfundene GmbH“ steht in keiner Quelle und hat keine Kante: fällt weg
    expect(graph.nodes.some((n) => n.name === "Erfundene GmbH")).toBe(false);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]).toMatchObject({
      id: "edge:1",
      from: "person:ada-lovelace",
      to: "person:charles-babbage",
      relation: "arbeitete mit",
      status: "suggested",
      evidence: {
        sourceId: "src_a",
        quote: "Ada Lovelace arbeitete mit Charles Babbage\nan der Analytical Engine",
        startOffset: 0
      }
    });
    expect(graph.edges[1]?.evidence.quote).toBe("Die Royal Society & das Archiv bewahren Briefe.");
    expect(dropped.map((d) => d.reason)).toEqual([
      "duplicate",
      "unknownEntity",
      "selfLoop",
      "emptyRelation",
      "unknownSource",
      "quoteNotFound"
    ]);
  });

  it("verwirft zu lange Zitate und Knoten mit doppelter id", () => {
    const long = "Wort ".repeat(200).trim();
    const { graph, dropped } = normalizeEntityExtraction(
      {
        entities: [
          { name: "Wort", kind: "topic" },
          { name: "Satz", kind: "topic" },
          { name: "C++", kind: "topic" },
          { name: "C", kind: "topic" }
        ],
        relations: [{ from: "Wort", to: "Satz", relation: "r", sourceId: "s", quote: long }]
      },
      [{ id: "s", text: `${long} Satz C++ C` }]
    );
    expect(dropped).toEqual([{ from: "Wort", to: "Satz", reason: "quoteNotFound" }]);
    expect(graph.nodes.map((n) => n.name)).toEqual(["Wort", "Satz", "C++"]);
  });

  it("Schema lehnt doppelte ids und Kanten ins Leere ab", () => {
    const node = { id: "a", kind: "topic", name: "A", status: "suggested" } as const;
    const edge = {
      id: "e",
      from: "a",
      to: "b",
      relation: "r",
      status: "suggested",
      evidence: { sourceId: "s", quote: "q" }
    } as const;
    const result = EntityGraphSchema.safeParse({ nodes: [node, node], edges: [edge] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      "Doppelte Knoten-id: a",
      "Kante e verweist ins Leere"
    ]);
  });
});

const base = (): EntityGraph => normalizeEntityExtraction(RAW, SOURCES).graph;

describe("Beziehungsgraph: Prüfen, Korrigieren und Filtern (Issue #238)", () => {
  it("bestätigt, lehnt ab, benennt um, ändert die Art und die Beziehung", () => {
    let g = base();
    g = applyEntityCorrection(g, {
      type: "setNodeStatus",
      id: "person:ada-lovelace",
      status: "confirmed"
    });
    expect(g.nodes[0]?.status).toBe("confirmed");
    g = applyEntityCorrection(g, {
      type: "renameNode",
      id: "topic:computers",
      name: "  Computer "
    });
    expect(g.nodes[4]).toMatchObject({ name: "Computer", status: "confirmed" });
    expect(applyEntityCorrection(g, { type: "renameNode", id: "topic:computers", name: " " })).toBe(
      g
    );
    g = applyEntityCorrection(g, {
      type: "setNodeKind",
      id: "topic:analytical-engine",
      kind: "organization"
    });
    expect(g.nodes[2]).toMatchObject({ kind: "organization", status: "confirmed" });
    g = applyEntityCorrection(g, { type: "setEdgeStatus", id: "edge:2", status: "rejected" });
    expect(g.edges[1]?.status).toBe("rejected");
    g = applyEntityCorrection(g, {
      type: "editEdgeRelation",
      id: "edge:1",
      relation: " forschte mit "
    });
    expect(g.edges[0]).toMatchObject({ relation: "forschte mit", status: "confirmed" });
    expect(applyEntityCorrection(g, { type: "editEdgeRelation", id: "edge:1", relation: "" })).toBe(
      g
    );
    // Unbekannte ids ändern nichts
    const same = applyEntityCorrection(g, {
      type: "setEdgeStatus",
      id: "edge:99",
      status: "confirmed"
    });
    expect(same.edges).toEqual(g.edges);
  });

  it("filtert nach Art und Prüfstatus", () => {
    let g = base();
    g = applyEntityCorrection(g, { type: "setEdgeStatus", id: "edge:2", status: "rejected" });
    g = applyEntityCorrection(g, {
      type: "setNodeStatus",
      id: "topic:computers",
      status: "rejected"
    });
    g = applyEntityCorrection(g, { type: "setEdgeStatus", id: "edge:1", status: "confirmed" });

    const open = filterEntityGraph(g, DEFAULT_ENTITY_FILTER);
    expect(open.edges.map((e) => e.id)).toEqual(["edge:1"]);
    expect(open.nodes.map((n) => n.id)).toEqual([
      "person:ada-lovelace",
      "person:charles-babbage",
      "topic:analytical-engine",
      "organization:royal-society"
    ]);

    const persons = filterEntityGraph(g, { kinds: ["person"], status: "open" });
    expect(persons.nodes.map((n) => n.kind)).toEqual(["person", "person"]);
    expect(persons.edges).toHaveLength(1);

    const confirmed = filterEntityGraph(g, {
      kinds: DEFAULT_ENTITY_FILTER.kinds,
      status: "confirmed"
    });
    expect(confirmed.edges.map((e) => e.id)).toEqual(["edge:1"]);
    expect(confirmed.nodes.map((n) => n.id)).toEqual([
      "person:ada-lovelace",
      "person:charles-babbage"
    ]);

    const rejected = filterEntityGraph(g, {
      kinds: DEFAULT_ENTITY_FILTER.kinds,
      status: "rejected"
    });
    expect(rejected.edges.map((e) => e.id)).toEqual(["edge:2"]);
    expect(rejected.nodes.map((n) => n.id)).toEqual([
      "person:ada-lovelace",
      "organization:royal-society",
      "topic:computers"
    ]);

    const suggested = filterEntityGraph(g, {
      kinds: DEFAULT_ENTITY_FILTER.kinds,
      status: "suggested"
    });
    expect(suggested.edges).toEqual([]);
    expect(suggested.nodes).toHaveLength(4);
  });

  it("Kanten eines Knotens und Zählung je Art", () => {
    const g = base();
    expect(edgesOf(g, "person:ada-lovelace").map((e) => e.id)).toEqual(["edge:1", "edge:2"]);
    expect(countByKind(g)).toEqual({ person: 2, organization: 1, topic: 2 });
  });
});
