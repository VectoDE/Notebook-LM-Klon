import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceLayout } from "../WorkspaceLayout.js";

describe("WorkspaceLayout Component (Issue #31)", () => {
  it("renders 3-panel workspace layout with header, 3 panels and mobile navigation", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout));
    expect(html).toContain('data-testid="workspace-shell"');
    expect(html).toContain('data-testid="workspace-header"');
    expect(html).toContain("RelationNotes");
    expect(html).toContain(WORKSPACE_VERSION);
    expect(html).toContain('data-testid="role-switcher-select"');
    expect(html).toContain('data-testid="theme-selector-header"');
    expect(html).toContain('data-testid="btn-open-settings"');

    // 3 panels
    expect(html).toContain('data-testid="workspace-3panel-container"');
    expect(html).toContain('data-testid="panel-left-wrapper"');
    expect(html).toContain('data-testid="panel-center-wrapper"');
    expect(html).toContain('data-testid="panel-right-wrapper"');

    // Child panels
    expect(html).toContain('data-testid="sources-panel"');
    expect(html).toContain('data-testid="chat-panel"');
    expect(html).toContain('data-testid="studio-panel"');

    // Mobile nav
    expect(html).toContain('data-testid="mobile-bottom-nav"');
    expect(html).toContain('data-testid="tab-btn-sources"');
    expect(html).toContain('data-testid="tab-btn-chat"');
    expect(html).toContain('data-testid="tab-btn-studio"');
    // Reiter: kurze sichtbare Namen, volle Namen für Screenreader, Zähler an Quellen
    expect(html).toContain('aria-label="Quellen (2)"');
    expect(html).toContain('aria-label="Chat &amp; Zitate"');
    expect(html).toContain('aria-label="Studio (6 Werkzeuge)"');
    expect(html).toContain('<span class="rn-tab-count">2</span>');
    expect(html).toContain('<span class="rn-tab-label">Studio</span>');
    // Kopf: ein Bedienelement-System, Rolle mit sichtbarer Beschriftung im Feld
    expect(html.match(/class="rn-control-chevron"/g)?.length).toBe(3);
    expect(html.match(/class="rn-control-input"/g)?.length).toBe(3);
    expect(html).toContain(
      '<label for="role-select" class="rn-control-lead workspace-role-label">Rolle</label>'
    );
    expect(html).toContain('class="rn-control rn-control--button workspace-settings-button"');
  });

  it("renders Studio Mindmap view when activeTool is mindmap", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout, { initialTool: "mindmap" }));
    expect(html).toContain("Cloudflare Edge Stack");
    expect(html).toContain("Compute");
    expect(html).toContain("Storage &amp; RAG");
  });

  it("renders Studio Flashcards view when activeTool is flashcards", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceLayout, { initialTool: "flashcards" })
    );
    expect(html).toContain("Was bewirkt die WebSocket Hibernation API in Durable Objects?");
  });

  it("renders Studio Quiz view when activeTool is quiz", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout, { initialTool: "quiz" }));
    expect(html).toContain(
      "Welcher SQLite-Mechanismus wird in D1 für die Volltextsuche verwendet?"
    );
  });

  it("activates sources tab when requested in mobile view", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceLayout, { initialPanelTab: "sources" })
    );
    expect(html).toContain('class="workspace-panel panel-left panel-active"');
  });

  it("activates studio tab when requested in mobile view", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceLayout, { initialPanelTab: "studio" })
    );
    expect(html).toContain('class="workspace-panel panel-right panel-active"');
  });
});
