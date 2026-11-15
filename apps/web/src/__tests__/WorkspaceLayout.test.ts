import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { WorkspaceLayout } from "../WorkspaceLayout.js";
import { preloadStudioViewers } from "../lazy-viewers.js";

// Studio-Viewer werden lazy geladen (#257); für Server-Render-Tests vorab laden.
beforeAll(() => preloadStudioViewers());

describe("WorkspaceLayout Component (Issue #31)", () => {
  it("renders 3-panel workspace layout with header, 3 panels and mobile navigation", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout));
    expect(html).toContain('data-testid="workspace-shell"');
    expect(html).toContain('data-testid="workspace-header"');
    expect(html).toContain("RelationNotes");
    expect(html).toContain(WORKSPACE_VERSION);
    expect(html).toContain('data-testid="top-nav"');
    expect(html).toContain('data-testid="btn-open-appearance"');
    expect(html).toContain('data-testid="btn-open-menu"');
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
    // Quellen: Name aus dem Inhalt, beginnt mit der sichtbaren Beschriftung (WCAG 2.5.3)
    expect(html).not.toContain('aria-label="Quellen (2)"');
    expect(html).toContain('<span class="rn-visually-hidden"> (2)</span>');
    expect(html).toContain('aria-label="Chat &amp; Zitate"');
    expect(html).toContain('aria-label="Studio (10 Werkzeuge)"');
    expect(html).toContain('<span class="rn-tab-count">2</span>');
    expect(html).toContain('<span class="rn-tab-label">Studio</span>');
    // Reiter oben gibt es nur 600 bis 899 px (ein Bereich sichtbar): ohne Fenster kein aria-current
    expect(html).toContain('data-testid="top-tab-chat" class="rn-topnav-item"');
    expect(html).not.toMatch(/aria-current="true" data-testid="top-tab-/);
    // Untere Leiste bleibt Reiterleiste mit aria-current
    expect(html).toMatch(
      /aria-current="true" aria-label="Chat &amp; Zitate" data-testid="tab-btn-chat"/
    );
    expect(html).not.toContain('aria-current="page"');
    // Einstellungen öffnen einen Dialog: nicht in der Navigation „Bereiche“ (Issue #319)
    const nav = html.slice(html.indexOf('data-testid="top-nav"'), html.indexOf("</nav>"));
    expect(nav).not.toContain("btn-open-settings");
    // Reiter liegen außerhalb der Anwendungsleiste (banner), zwischen Kopf und main
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf('data-testid="top-nav"'));
    expect(html).toContain('<span class="rn-settings-button-label">Einstellungen</span>');
    // Sprunglink als erstes Element, Kopfzeile (banner) vor und außerhalb von main
    expect(html).toMatch(/^<div[^>]*><a href="#workspace-main" class="rn-skip-link"/);
    expect(html).toContain("Zum Inhalt springen");
    expect(html).toMatch(
      /<\/nav><main id="workspace-main" tabindex="-1" aria-labelledby="notebook-title"/
    );
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html).toMatch(
      /aria-expanded="false" aria-controls="appearance-menu" aria-haspopup="dialog"/
    );
    expect(html).toMatch(/aria-expanded="false" aria-controls="nav-sheet" aria-haspopup="dialog"/);
    expect(html).toContain('aria-label="Menü öffnen"');
    // Menüs sind beim Start zu und liegen nicht im Markup
    expect(html).not.toContain('data-testid="appearance-menu"');
    expect(html).not.toContain('data-testid="nav-sheet"');
    // Panels sind Fokusziele der Reiter
    expect(html).toContain('data-panel="sources" tabindex="-1"');
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
