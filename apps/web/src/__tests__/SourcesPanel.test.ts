import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourcesPanel } from "../SourcesPanel.js";
import type { WorkspaceSource } from "../workspace-types.js";

const TEST_SOURCES: WorkspaceSource[] = [
  {
    id: "src_1",
    title: "Architecture Specification",
    originalName: "arch.md",
    mimeType: "text/markdown",
    byteSize: 10240,
    chunksCount: 4,
    isSelected: true,
    rawText: "The system is built on Cloudflare Workers and Durable Objects."
  },
  {
    id: "src_2",
    title: "D1 Database Migration",
    originalName: "migration.sql",
    mimeType: "text/plain",
    byteSize: 5120,
    chunksCount: 2,
    isSelected: false,
    rawText: "CREATE VIRTUAL TABLE fts_chunks USING fts5;"
  }
];

describe("SourcesPanel Component (Sub-Issue #131)", () => {
  it("renders sources panel landmark, upload buttons and list of sources", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: TEST_SOURCES
      })
    );

    expect(html).toContain('aria-label="Quellen-Panel"');
    expect(html).toContain("Architecture Specification");
    expect(html).toContain("D1 Database Migration");
    expect(html).toContain("btn-upload-file");
    expect(html).toContain("btn-open-url-dialog");
    expect(html).toContain("dropzone-area");
    expect(html).toContain("2 Quellen");
  });

  it("renders single source badge correctly", () => {
    const singleSource = TEST_SOURCES[0];
    if (!singleSource) throw new Error("Missing test source");
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: [singleSource]
      })
    );
    expect(html).toContain("1 Quelle");
  });

  it("renders empty state message when no sources exist", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: []
      })
    );
    expect(html).toContain("Noch keine Quellen");
    expect(html).toContain('data-art="sources"');
  });

  it("renders highlighted citation mark when active citation matches inspected source quote", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: TEST_SOURCES,
        activeCitation: {
          sourceId: "src_1",
          page: 2,
          quote: "Cloudflare Workers"
        }
      })
    );

    expect(html).toContain("source-inspector-drawer");
    expect(html).toContain("highlighted-citation-passage");
    expect(html).toContain("Cloudflare Workers");
    expect(html).toContain("Fokussiertes Zitat");
    expect(html).toContain("(Seite 2)");
  });

  it("renders source inspector without quote highlight fallback when quote is missing or not in raw text", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: TEST_SOURCES,
        activeCitation: {
          sourceId: "src_1",
          page: null,
          quote: "Non-existent phrase"
        }
      })
    );

    expect(html).toContain("source-inspector-drawer");
    expect(html).toContain("The system is built on Cloudflare Workers");
    expect(html).not.toContain("highlighted-citation-passage");
  });
});
