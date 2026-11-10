import type { MindmapNode } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MindmapViewer, computeMindmapLayout, flattenLayoutNodes } from "../MindmapViewer.js";

const sampleTree: MindmapNode = {
  id: "root",
  label: "Cloudflare Edge",
  children: [
    {
      id: "compute",
      label: "Compute",
      sourceId: "src_compute",
      chunkId: "chk_compute_1",
      sourceCitation: "Doc 1.2",
      children: [
        { id: "worker", label: "Single Worker" },
        { id: "do", label: "Durable Objects" }
      ]
    },
    {
      id: "storage",
      label: "Storage",
      children: [{ id: "d1", label: "D1 SQLite" }]
    }
  ]
};

describe("MindmapViewer Layout Engine & Component (Sub-Issue #122)", () => {
  it("computes deterministic 2D hierarchical layout positions and connections", () => {
    const layout = computeMindmapLayout(sampleTree, new Set());
    expect(layout.layoutNode.id).toBe("root");
    expect(layout.layoutNode.children).toHaveLength(2);
    expect(layout.connections.length).toBeGreaterThan(0);

    const flat = flattenLayoutNodes(layout.layoutNode);
    expect(flat).toHaveLength(6);
    expect(flat.map((n) => n.id)).toEqual(["root", "compute", "worker", "do", "storage", "d1"]);
  });

  it("handles collapsed branches in layout computation", () => {
    const collapsed = new Set(["compute"]);
    const layout = computeMindmapLayout(sampleTree, collapsed);
    expect(layout.layoutNode.children[0]?.isCollapsed).toBe(true);
    expect(layout.layoutNode.children[0]?.children).toHaveLength(0);

    const flat = flattenLayoutNodes(layout.layoutNode);
    // worker and do should not be in the visible layout
    expect(flat.map((n) => n.id)).toEqual(["root", "compute", "storage", "d1"]);
  });

  it("renders MindmapViewer with visual SVG panel and WAI-ARIA role='tree' panel", () => {
    const onSourceJump = vi.fn();
    const html = renderToStaticMarkup(
      createElement(MindmapViewer, {
        rootNode: sampleTree,
        title: "Test Edge Mindmap",
        onSourceJump,
        initialZoom: 1.2
      })
    );

    expect(html).toContain('aria-label="Mindmap: Test Edge Mindmap"');
    expect(html).toContain("Test Edge Mindmap");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Grafik (SVG)");
    expect(html).toContain("Baumliste (WAI-ARIA)");
    expect(html).toContain('data-testid="mindmap-svg"');
    expect(html).toContain('role="tree"');
    expect(html).toContain('role="treeitem"');
    expect(html).toContain("Cloudflare Edge");
    expect(html).toContain("Single Worker");
    expect(html).toContain("(Doc 1.2)");
  });

  it("handles leaf node with no children correctly in computeMindmapLayout", () => {
    const leaf: MindmapNode = { id: "leaf", label: "Einzelknoten" };
    const layout = computeMindmapLayout(leaf, new Set());
    expect(layout.layoutNode.hasChildren).toBe(false);
    expect(layout.layoutNode.children).toHaveLength(0);
    expect(layout.connections).toHaveLength(0);
    expect(layout.totalHeight).toBe(44);
  });
});
