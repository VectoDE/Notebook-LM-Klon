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

  it("renders 3-panel workspace layout when mode='workspace'", () => {
    const html = renderToStaticMarkup(createElement(App, { mode: "workspace" }));
    expect(html).toContain('data-testid="workspace-shell"');
    expect(html).toContain('data-testid="workspace-3panel-container"');
  });

  it("hält im Arbeitsbereich genau ein main, die Kopfzeile davor und den Sprunglink zuerst", () => {
    const html = renderToStaticMarkup(createElement(App, { mode: "workspace" }));
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    expect(html.indexOf("<header")).toBeGreaterThan(-1);
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf('href="#workspace-main"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('<main id="workspace-main" tabindex="-1"');
  });
});
