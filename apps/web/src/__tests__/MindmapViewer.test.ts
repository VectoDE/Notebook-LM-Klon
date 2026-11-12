import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MindmapNode } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MindmapViewer,
  NODE_FONT_SIZE,
  TOGGLE_RADIUS,
  computeMindmapLayout,
  flattenLayoutNodes,
  nodeWidthFor
} from "../MindmapViewer.js";

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

  it("schneidet die Wurzel-Beschriftung nicht ab (Knoten wächst mit dem Text)", () => {
    const longRoot: MindmapNode = {
      id: "r",
      label: "Cloudflare Edge Stack mit Durable Objects und D1",
      children: [{ id: "c", label: "Kind" }]
    };
    const layout = computeMindmapLayout(longRoot, new Set());
    const root = layout.layoutNode;
    // 14 px Inter: höchstens ~8,6 px je Zeichen; Rand links/rechts plus Platz für den Knopf
    const needed = longRoot.label.length * 8.6 + 32 + 40;
    expect(root.width).toBeGreaterThanOrEqual(needed);
    // Kinder beginnen rechts vom breiteren Wurzelknoten, die Kante startet an dessen Rand
    const child = root.children[0];
    expect(child?.x).toBeGreaterThan(root.x + root.width);
    expect(layout.connections[0]?.fromX).toBe(root.x + root.width);
    // Kurze Beschriftungen behalten die Mindestbreite
    expect(nodeWidthFor("Kind", false)).toBe(180);
    expect(nodeWidthFor("x".repeat(30), true)).toBeGreaterThan(nodeWidthFor("x".repeat(30), false));
  });

  it("hat ausreichend große Bedienziele (24 px Knoten-Knopf, 44 px Hauptaktionen)", () => {
    expect(TOGGLE_RADIUS * 2).toBeGreaterThanOrEqual(24);
    expect(NODE_FONT_SIZE).toBeGreaterThanOrEqual(14);
    const html = renderToStaticMarkup(createElement(MindmapViewer, { rootNode: sampleTree }));
    expect(html).toContain('data-testid="mindmap-toolbar"');
    expect(html).toMatch(/data-testid="mindmap-toolbar" class="rn-mindmap-toolbar"/);
    // Reiter, Zoom und Zurücksetzen: Klassen mit mindestens 44 px Höhe in workspace.css
    const css = readFileSync(resolve(import.meta.dirname, "../workspace.css"), "utf8");
    const minHeight = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      return Number(/min-height:\s*(\d+)px/.exec(block)?.[1] ?? 0);
    };
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons) {
      const cls = /class="([^"]+)"/.exec(b)?.[1] ?? "";
      const selector = cls.includes("rn-seg-tab")
        ? ".rn-seg-tab"
        : cls.includes("rn-icon-btn")
          ? ".rn-icon-btn"
          : ".rn-zoom .rn-btn";
      expect(minHeight(selector), b).toBeGreaterThanOrEqual(44);
    }
    expect(html).toContain(`r="${TOGGLE_RADIUS}"`);
  });
});
