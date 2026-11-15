import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { GraphViewer } from "../GraphViewer.js";
import { StudioPanel } from "../StudioPanel.js";
import { DEFAULT_MINDMAP, DEFAULT_SOURCES, WorkspaceLayout } from "../WorkspaceLayout.js";
import { buildKnowledgeGraph } from "../knowledge-graph.js";
import { preloadStudioViewers } from "../lazy-viewers.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

// Studio-Viewer werden lazy geladen (#257); für Server-Render-Tests vorab laden.
beforeAll(() => preloadStudioViewers());

const graph = buildKnowledgeGraph(DEFAULT_SOURCES, DEFAULT_MINDMAP);

function renderEn(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
  );
}

describe("Wissensgraph-Ansicht (Issue #327)", () => {
  it("Grafik: ein Tab-Stopp, Knoten mit Namen, Art und Verbindungszahl", () => {
    const html = renderToStaticMarkup(createElement(GraphViewer, { graph, contentLang: "en" }));
    expect(html).toContain('data-testid="graph-panel"');
    expect(html).toContain("6 Begriffe, 2 Quellen, 8 Verbindungen");
    expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/role="button" tabindex="-1"/g)).toHaveLength(7);
    expect(html).toContain('aria-label="Compute, Begriff, 2 Verbindungen"');
    expect(html).toContain(
      'aria-label="Cloudflare Worker &amp; DO Architecture, Quelle, 3 Verbindungen"'
    );
    expect(html).toContain("<title>Wissensgraph als Grafik</title>");
    // Kanten: Gliederung durchgezogen, Vorkommen gestrichelt (Unterscheidung ohne Farbe)
    expect(html.match(/class="rn-graph-edge" data-kind="relatedTo"/g)).toHaveLength(4);
    expect(html.match(/class="rn-graph-edge" data-kind="occursIn"/g)).toHaveLength(5);
    // Inhalte englisch: lang an Beschriftung und Liste
    expect(html).toMatch(/<text class="rn-graph-label" font-size="14" lang="en">/);
    // Ohne onClose (Telefon) kein Rückweg-Knopf, Details leer
    expect(html).not.toContain("btn-close-graph");
    expect(html).toContain("Wählen Sie einen Knoten");
    // Reiter nach APG, Liste versteckt
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*data-testid="graph-tab-visual"/);
    expect(html).toMatch(
      /data-testid="graph-list"[^>]*hidden=""|hidden=""[^>]*data-testid="graph-list"/
    );
  });

  it("Liste als Textalternative mit Beziehungen und Sprung zur Quelle", () => {
    const html = renderToStaticMarkup(createElement(GraphViewer, { graph }));
    expect(html).toContain("Hängt zusammen mit");
    expect(html).toContain("Kommt vor in");
    expect(html).toContain("Enthält die Begriffe");
    expect(html).toContain(
      "Single Worker (Hono), NotebookDO (In-Memory Vectors), int8 Quantized Vectors"
    );
    expect(html).toContain('data-testid="graph-list-jump-source:src_1"');
    expect(html).toContain(
      'aria-label="Quelle anzeigen: D1 SQLite Relational &amp; FTS5 Hybrid Search"'
    );
  });

  it("Rückweg zum Chat und leerer Graph", () => {
    const html = renderToStaticMarkup(
      createElement(GraphViewer, { graph: { nodes: [], edges: [] }, onClose: () => {} })
    );
    expect(html).toContain('data-testid="btn-close-graph"');
    expect(html).toContain("Zurück zum Chat");
    expect(html).toContain("Noch keine Begriffe oder Quellen");
  });

  it("englische Oberfläche", () => {
    const html = renderEn(createElement(GraphViewer, { graph, onClose: () => {} }));
    for (const text of [
      "Knowledge graph",
      "6 concepts, 2 sources, 8 links",
      "Back to chat",
      "Graphic",
      "List",
      "Fit to view",
      "Solid: related to",
      "Dashed: appears in",
      "Compute, Concept, 2 links",
      "Select a node to see its links."
    ]) {
      expect(html, text).toContain(text);
    }
  });

  it("Studio führt den Graphen als Eintrag, wenn er geöffnet werden kann", () => {
    const without = renderToStaticMarkup(createElement(StudioPanel, {}));
    expect(without).not.toContain("tool-card-graph");
    expect(without).toContain("6 Werkzeuge aus Ihren Quellen");
    const html = renderToStaticMarkup(createElement(StudioPanel, { onOpenGraph: () => {} }));
    expect(html).toContain('data-testid="tool-card-graph"');
    expect(html).toContain('data-testid="btn-open-graph-tool"');
    expect(html).toContain("7 Werkzeuge aus Ihren Quellen");
    // Nach der Mindmap
    expect(html.indexOf("tool-card-mindmap")).toBeLessThan(html.indexOf("tool-card-graph"));
  });

  it("Arbeitsbereich: vier Reiter unten und oben, Graph ohne Sprunglink", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout));
    for (const tab of ["sources", "chat", "studio", "graph"]) {
      expect(html).toContain(`data-testid="tab-btn-${tab}"`);
      expect(html).toContain(`data-testid="top-tab-${tab}"`);
    }
    expect(html).toContain(
      'aria-label="Graph der Begriffe und Quellen" data-testid="tab-btn-graph"'
    );
    expect(html).toContain('<span class="rn-tab-label">Graph</span>');
    expect(html).not.toContain("skip-link-graph");
    expect(html).not.toContain('data-testid="graph-panel"');
  });

  it("Arbeitsbereich mit geöffnetem Graphen: Chat bleibt erhalten, aber verborgen", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout, { initialPanelTab: "graph" }));
    expect(html).toContain('data-testid="graph-panel"');
    expect(html).toContain('data-panel="graph"');
    expect(html).toMatch(
      /<div class="rn-panel-slot" hidden=""><section[^>]*data-testid="chat-panel"/
    );
    expect(html).toMatch(/aria-current="true" aria-label="Graph der Begriffe und Quellen"/);
    expect(html).toMatch(/class="workspace-panel panel-center panel-active"/);
  });
});
