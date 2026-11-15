import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { CommentThread, renderCommentBody } from "../CommentThread.js";
import { SourcesPanel } from "../SourcesPanel.js";
import { commentErrorKey } from "../comments-client.js";
import { LazyCommentThread } from "../lazy-viewers.js";
import { COMMENTS_DE, COMMENTS_EN, commentTexts } from "../translations-comments.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

function inTheme(language: "de" | "en", child: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: language } as ThemeProviderProps, child)
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

  // Im Inspektor wird die Komponente nachgeladen (lazy-viewers); vorab laden, damit sie rendert.
  beforeAll(async () => {
    await LazyCommentThread.preload();
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

  it("has every comment text in German and English, chosen by UI language", () => {
    expect(Object.keys(COMMENTS_EN)).toEqual(Object.keys(COMMENTS_DE));
    for (const [key, text] of Object.entries(COMMENTS_DE)) {
      expect(text, key).not.toBe("");
      expect(COMMENTS_EN[key], key).not.toBe("");
    }
    for (const kind of [
      "unauthorized",
      "forbidden",
      "not-found",
      "invalid",
      "rate-limited",
      "network",
      "server"
    ] as const) {
      expect(COMMENTS_DE[commentErrorKey(kind)]).toBeDefined();
    }
    expect(commentTexts("en")).toBe(COMMENTS_EN);
    expect(commentTexts("en-GB")).toBe(COMMENTS_EN);
    expect(commentTexts("de")).toBe(COMMENTS_DE);
    expect(commentTexts("fr")).toBe(COMMENTS_DE);
  });
});
