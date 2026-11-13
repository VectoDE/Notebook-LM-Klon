import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommentThread, renderCommentBody } from "../CommentThread.js";
import { SourcesPanel } from "../SourcesPanel.js";
import { ThemeProvider } from "../useTheme.js";

function inTheme(language: "de" | "en", child: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: language, children: child })
  );
}

const source = {
  id: "src_1",
  title: "Architektur",
  originalName: "a.md",
  mimeType: "text/markdown",
  byteSize: 1024,
  chunksCount: 1,
  isSelected: true,
  rawText: "Inhalt"
};

describe("CommentThread (Issue #353)", () => {
  it("renders a collapsed disclosure button that controls the comment region", () => {
    const html = inTheme(
      "de",
      createElement(CommentThread, {
        notebookId: "nb",
        targetType: "source",
        targetId: "src_1",
        targetTitle: "Architektur"
      })
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Kommentare anzeigen");
    expect(html).toMatch(/aria-controls="[^"]+-region"/);
    expect(html).toContain('aria-label="Kommentare zu Architektur"');
    expect(html).toContain("hidden");
  });

  it("speaks English when the interface language is English", () => {
    const html = inTheme(
      "en",
      createElement(CommentThread, {
        notebookId: "nb",
        targetType: "note",
        targetId: "n1",
        targetTitle: "Plan",
        defaultOpen: true
      })
    );
    expect(html).toContain("Hide comments");
    expect(html).toContain('aria-label="Comments on Plan"');
    expect(html).toContain('data-testid="comments-note-n1"');
  });

  it("is shown in the source inspector only when a notebook id is known", () => {
    const withId = inTheme(
      "de",
      createElement(SourcesPanel, {
        sources: [source],
        notebookId: "nb_active",
        activeCitation: { sourceId: "src_1", quote: "Inhalt" }
      })
    );
    expect(withId).toContain('data-testid="comments-source-src_1"');

    const withoutId = inTheme(
      "de",
      createElement(SourcesPanel, {
        sources: [source],
        activeCitation: { sourceId: "src_1", quote: "Inhalt" }
      })
    );
    expect(withoutId).not.toContain("comments-source-src_1");
  });

  it("highlights mentions as text without interpreting markup", () => {
    const parts = renderCommentBody("Hi @Bob Berg und @Bo, <b>x</b> @Bob Berg", [
      { id: "b", displayName: "Bob Berg" },
      { id: "o", displayName: "Bo" },
      { id: "x", displayName: "" }
    ]);
    const texts = parts.map((p) =>
      isValidElement(p) ? `[${(p.props as { children: string }).children}]` : p
    );
    expect(texts).toEqual(["Hi ", "[@Bob Berg]", " und ", "[@Bo]", ", <b>x</b> ", "[@Bob Berg]"]);
    expect(renderCommentBody("ohne", [])).toEqual(["ohne"]);
    expect(renderCommentBody("ende @Bo", [{ id: "o", displayName: "Bo" }]).length).toBe(2);
  });
});
