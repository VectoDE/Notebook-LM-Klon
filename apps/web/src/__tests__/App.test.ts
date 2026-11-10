import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";

describe("RelationNotes Web Shell (App.tsx)", () => {
  it("renders accessible main landmark with RelationNotes title and workspace version", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('aria-labelledby="app-title"');
    expect(html).toContain("RelationNotes");
    expect(html).toContain("NotebookLM &amp; RelationFlow Knowledge Studio");
    expect(html).toContain(WORKSPACE_VERSION);
    expect(html).toContain('aria-label="Studio Werkzeuge"');
    expect(html).toContain("Übersicht");
    expect(html).toContain("Mindmap");
    expect(html).toContain("Lernkarten");
    expect(html).toContain("Quiz");
  });

  it("renders Studio Mindmap view when active", () => {
    const html = renderToStaticMarkup(createElement(App, { initialTool: "mindmap" }));
    expect(html).toContain("Studio: Wissens-Mindmap");
    expect(html).toContain('aria-current="page"');
  });

  it("renders Studio Flashcards view when active", () => {
    const html = renderToStaticMarkup(createElement(App, { initialTool: "flashcards" }));
    expect(html).toContain("Studio: Spaced-Repetition Lernkarten");
  });

  it("renders Studio Quiz view when active", () => {
    const html = renderToStaticMarkup(createElement(App, { initialTool: "quiz" }));
    expect(html).toContain("Studio: Interaktives Quiz");
  });
});
