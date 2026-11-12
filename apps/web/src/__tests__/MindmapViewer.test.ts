import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MindmapNode } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FIT_PADDING,
  MindmapViewer,
  NODE_FONT_SIZE,
  TOGGLE_RADIUS,
  buildParentMap,
  buildTreeMeta,
  computeMindmapLayout,
  fitMindmap,
  flattenLayoutNodes,
  nodeWidthFor,
  resolveActiveId,
  tabKeyTarget,
  treeKeyAction
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
    expect(html).toMatch(/role="tab"[^>]*>Grafik<\/button>/);
    expect(html).toMatch(/role="tab"[^>]*>Baumliste<\/button>/);
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

  describe("Tastatur und Hilfstechnik (#296)", () => {
    const layout = computeMindmapLayout(sampleTree, new Set());
    const flat = flattenLayoutNodes(layout.layoutNode);
    const meta = buildTreeMeta(layout.layoutNode);
    const key = (id: string, k: string) => treeKeyAction(flat, meta, id, k);

    it("liefert Ebene, Geschwisterzahl und Position je Knoten", () => {
      expect(meta.get("root")).toEqual({ parentId: undefined, setSize: 1, posInSet: 1 });
      expect(meta.get("compute")).toEqual({ parentId: "root", setSize: 2, posInSet: 1 });
      expect(meta.get("storage")).toEqual({ parentId: "root", setSize: 2, posInSet: 2 });
      expect(meta.get("do")).toEqual({ parentId: "compute", setSize: 2, posInSet: 2 });
      expect(meta.get("d1")).toEqual({ parentId: "storage", setSize: 1, posInSet: 1 });
    });

    it("Pfeil hoch/runter bewegt den Fokus, an den Enden bleibt er stehen", () => {
      expect(key("root", "ArrowDown")).toEqual({ focus: "compute" });
      expect(key("worker", "ArrowUp")).toEqual({ focus: "compute" });
      expect(key("d1", "ArrowDown")).toEqual({});
      expect(key("root", "ArrowUp")).toEqual({});
    });

    it("Pfeil rechts klappt auf oder geht zum ersten Kind, Blatt bleibt", () => {
      expect(key("compute", "ArrowRight")).toEqual({ focus: "worker" });
      expect(key("worker", "ArrowRight")).toEqual({});
      const collapsed = computeMindmapLayout(sampleTree, new Set(["compute"]));
      const cFlat = flattenLayoutNodes(collapsed.layoutNode);
      const cMeta = buildTreeMeta(collapsed.layoutNode);
      expect(treeKeyAction(cFlat, cMeta, "compute", "ArrowRight")).toEqual({ toggle: "compute" });
      // Eingeklappt: Pfeil links springt zum Elternknoten
      expect(treeKeyAction(cFlat, cMeta, "compute", "ArrowLeft")).toEqual({ focus: "root" });
    });

    it("Pfeil links klappt zu, sonst Elternknoten; an der Wurzel ohne Kinder nichts", () => {
      expect(key("compute", "ArrowLeft")).toEqual({ toggle: "compute" });
      expect(key("do", "ArrowLeft")).toEqual({ focus: "compute" });
      expect(key("d1", "ArrowLeft")).toEqual({ focus: "storage" });
      const single = computeMindmapLayout({ id: "solo", label: "Solo" }, new Set());
      const sFlat = flattenLayoutNodes(single.layoutNode);
      expect(treeKeyAction(sFlat, buildTreeMeta(single.layoutNode), "solo", "ArrowLeft")).toEqual(
        {}
      );
    });

    it("Pos1/Ende springen zum ersten/letzten sichtbaren Knoten, Eingabe aktiviert", () => {
      expect(key("do", "Home")).toEqual({ focus: "root" });
      expect(key("compute", "End")).toEqual({ focus: "d1" });
      expect(key("compute", "Enter")).toEqual({ activate: true });
      expect(key("compute", " ")).toEqual({ activate: true });
      expect(key("compute", "a")).toBeUndefined();
      expect(key("unbekannt", "ArrowDown")).toBeUndefined();
    });

    it("weicht bei verborgenem aktiven Knoten auf den sichtbaren Vorfahren aus", () => {
      const parents = buildParentMap(sampleTree);
      expect(parents.get("do")).toBe("compute");
      expect(parents.get("root")).toBeUndefined();
      const visible = new Set(["root", "compute", "storage", "d1"]);
      expect(resolveActiveId("do", visible, parents, "root")).toBe("compute");
      expect(resolveActiveId("storage", visible, parents, "root")).toBe("storage");
      expect(resolveActiveId("fremd", visible, parents, "root")).toBe("root");
    });

    it("Reiter: Pfeil links/rechts mit Umlauf, Pos1/Ende, andere Tasten nicht", () => {
      expect(tabKeyTarget("visual", "ArrowRight")).toBe("tree");
      expect(tabKeyTarget("tree", "ArrowRight")).toBe("visual");
      expect(tabKeyTarget("visual", "ArrowLeft")).toBe("tree");
      expect(tabKeyTarget("tree", "ArrowLeft")).toBe("visual");
      expect(tabKeyTarget("tree", "Home")).toBe("visual");
      expect(tabKeyTarget("visual", "End")).toBe("tree");
      expect(tabKeyTarget("visual", "Enter")).toBeUndefined();
    });

    it("rendert Roving Tabindex, ARIA-Lage, ausgeblendete Grafik und klare Namen", () => {
      const html = renderToStaticMarkup(createElement(MindmapViewer, { rootNode: sampleTree }));
      const items = html.match(/<li[^>]*role="treeitem"[^>]*>/g) ?? [];
      expect(items).toHaveLength(6);
      expect(items.filter((i) => i.includes('tabindex="0"'))).toHaveLength(1);
      expect(items[0]).toContain('tabindex="0"');
      expect(items[0]).toContain('aria-level="1"');
      expect(items[1]).toMatch(/aria-level="2"[^>]*aria-setsize="2"[^>]*aria-posinset="1"/);
      expect(items[1]).toContain('aria-expanded="true"');
      expect(items[2]).not.toContain("aria-expanded");
      expect(items.some((i) => i.includes("aria-selected"))).toBe(false);
      // Grafik: für Hilfstechnik ausgeblendet, nichts darin fokussierbar, Hinweis auf die Liste
      const svg = /<svg[^>]*>/.exec(html)?.[0] ?? "";
      expect(svg).toContain('aria-hidden="true"');
      const svgBody = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
      expect(svgBody).not.toMatch(/tabindex|aria-label/);
      expect(html).toMatch(/class="rn-visually-hidden">[^<]*Reiter Baumliste/);
      // Reiter: nur der gewählte im Tab-Fluss
      const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
      expect(tabs[0]).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
      expect(tabs[1]).toMatch(/aria-selected="false"[^>]*tabindex="-1"/);
      // Sichtbarer Text ist der Name (WCAG 2.5.3), kein Fachjargon
      expect(html).toMatch(/<button type="button" class="rn-btn[^"]*">Einpassen<\/button>/);
      expect(html).toContain('aria-label="Vergrößern"');
      expect(html).toContain('aria-label="Verkleinern"');
      expect(html).not.toMatch(/Zoom In|Zoom Out|WAI-ARIA\)|\(SVG\)/);
      // Ein-/Ausklapp-Knöpfe der Liste liegen nicht im Tab-Fluss
      const treeBody = html.slice(html.indexOf('role="tree"'));
      for (const b of treeBody.match(/<button[^>]*>/g) ?? []) {
        expect(b).toContain('tabindex="-1"');
        expect(b).toContain('aria-hidden="true"');
      }
    });

    it("Reiterbeschriftung bricht nicht um", () => {
      const css = readFileSync(resolve(import.meta.dirname, "../workspace.css"), "utf8");
      const start = css.indexOf("\n.rn-seg-tab {");
      expect(css.slice(start, css.indexOf("}", start))).toContain("white-space: nowrap");
    });
  });

  describe("fitMindmap", () => {
    const nodes = [
      { x: 0, y: 0, width: 200, height: 44 },
      { x: 290, y: -60, width: 180, height: 44 },
      { x: 290, y: 60, width: 180, height: 44 }
    ];
    it("zentriert kleine Karten bei 100 %", () => {
      const fit = fitMindmap(nodes, { width: 1000, height: 600 });
      expect(fit.zoom).toBe(1);
      expect(fit.pan.x).toBe(Math.round((1000 - 470) / 2));
      expect(fit.pan.y).toBe(Math.round((600 - 164) / 2 + 60));
    });
    it("verkleinert bis höchstens 80 %, bis die Karte passt", () => {
      const fit = fitMindmap(nodes, { width: 440, height: 360 });
      expect(fit.zoom).toBeCloseTo((440 - 2 * FIT_PADDING) / 470, 2);
      expect(fit.pan.x).toBeGreaterThanOrEqual(FIT_PADDING - 1);
    });
    it("hält bei sehr breiten Karten die Wurzel links sichtbar", () => {
      const wide = [...nodes, { x: 2000, y: 0, width: 180, height: 44 }];
      const fit = fitMindmap(wide, { width: 340, height: 360 });
      expect(fit.zoom).toBe(0.8);
      expect(fit.pan.x).toBe(FIT_PADDING);
    });
    it("fällt ohne Knoten oder Fläche auf Standardwerte zurück", () => {
      expect(fitMindmap([], { width: 300, height: 300 })).toEqual({
        zoom: 1,
        pan: { x: FIT_PADDING, y: FIT_PADDING }
      });
      expect(fitMindmap(nodes, { width: 0, height: 0 }).zoom).toBe(1);
    });
  });
});
