import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotebookTitle } from "../NotebookTitle.js";
import { PanelRail, PanelToggle, RailButton } from "../PanelRail.js";
import { SHARE_ROLES, ShareDialog } from "../ShareDialog.js";
import { AccountStatus, DEFAULT_NOTEBOOK_TITLE, WorkspaceLayout } from "../WorkspaceLayout.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

const renderEn = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
  );

describe("Anwendungsleiste (Issue #325)", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceLayout));

  it("zeigt Logo, Titel, Teilen, Einstellungen, Darstellung und Konto in dieser Reihenfolge", () => {
    const order = [
      'data-testid="brand-logo"',
      'data-testid="notebook-title-button"',
      'data-testid="btn-open-share"',
      'data-testid="btn-open-settings"',
      'data-testid="btn-open-appearance"',
      'data-testid="btn-open-account"',
      'data-testid="btn-open-menu"'
    ].map((needle) => html.indexOf(needle));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain(DEFAULT_NOTEBOOK_TITLE);
    expect(header).toContain('<span class="rn-share-button-label">Teilen</span>');
    // Konto: Menü mit Gast-Zustand, Name als Kurzinfo im Knopf
    expect(header).toMatch(
      /aria-expanded="false" aria-controls="account-menu" aria-haspopup="dialog" data-testid="btn-open-account"/
    );
    expect(header).toContain('<span class="rn-tip-label">Konto</span>');
    // Teilen öffnet einen Dialog; der Dialog liegt beim Start nicht im Markup
    expect(header).toMatch(/data-testid="btn-open-share" aria-haspopup="dialog"/);
    expect(html).not.toContain('data-testid="share-dialog"');
    expect(html).not.toContain('data-testid="account-menu"');
  });

  it("main trägt den Titel als Namen, die Titel-Überschrift ist ein Knopf mit Hinweis", () => {
    expect(html).toContain('aria-labelledby="notebook-title"');
    expect(html).toMatch(
      /<h1 id="notebook-title" class="rn-nb-title"><button type="button" aria-describedby="[^"]+" data-testid="notebook-title-button"/
    );
    expect(html).toContain("Zum Umbenennen auswählen");
  });

  it("Sprunglinks: zuerst zum Inhalt, dann zu jeder Spalte", () => {
    expect(html).toMatch(
      /<a href="#workspace-main" class="rn-skip-link" data-testid="skip-link">Zum Inhalt springen<\/a><a href="#sources-column" class="rn-skip-link" data-testid="skip-link-sources">Zu den Quellen<\/a><a href="#chat-column" class="rn-skip-link" data-testid="skip-link-chat">Zum Chat<\/a><a href="#studio-column" class="rn-skip-link" data-testid="skip-link-studio">Zum Studio<\/a>/
    );
    expect(html).toContain('id="chat-column"');
  });

  it("Spalten starten ausgeklappt, Umschalter am Rand mit aria-expanded, aria-controls und Kürzel", () => {
    expect(html).not.toContain('data-testid="rail-sources"');
    expect(html).not.toContain('data-testid="rail-studio"');
    expect(html).not.toContain("data-collapsed");
    expect(html).toContain('<div id="sources-column" class="rn-panel-slot">');
    expect(html).toContain('<div id="studio-column" class="rn-panel-slot">');
    expect(html).toMatch(
      /aria-expanded="true" aria-controls="sources-column" aria-keyshortcuts="Alt\+Shift\+1" data-testid="btn-collapse-sources"/
    );
    expect(html).toMatch(
      /aria-expanded="true" aria-controls="studio-column" aria-keyshortcuts="Alt\+Shift\+3" data-testid="btn-collapse-studio"/
    );
    expect(html).toContain('<span class="rn-tip-label">Quellen einklappen</span>');
    expect(html).toContain('<span class="rn-tip-kbd" aria-hidden="true">Alt+Umschalt+1</span>');
    // Meldungen für Screenreader, anfangs leer
    expect(html).toMatch(
      /<output aria-live="polite" class="rn-visually-hidden" data-testid="layout-status"><\/output>/
    );
  });

  it("übersetzt Leiste, Umschalter und Sprunglinks ins Englische", () => {
    const en = renderEn(createElement(WorkspaceLayout));
    for (const text of [
      '<span class="rn-share-button-label">Share</span>',
      '<span class="rn-tip-label">Account</span>',
      '<span class="rn-tip-label">Collapse sources</span>',
      '<span class="rn-tip-label">Collapse Studio</span>',
      '<span class="rn-tip-kbd" aria-hidden="true">Alt+Shift+3</span>',
      ">Skip to sources</a>",
      "Select to rename"
    ]) {
      expect(en, text).toContain(text);
    }
    expect(en).not.toContain("Teilen");
    expect(en).not.toContain("einklappen");
  });
});

describe("Teilen-Dialog: nur Oberfläche", () => {
  const props = { isOpen: true, onClose: () => {}, notebookTitle: "Mein Notebook" };

  it("ist geschlossen nicht im Markup", () => {
    expect(renderToStaticMarkup(createElement(ShareDialog, { ...props, isOpen: false }))).toBe("");
  });

  it("sagt deutlich, dass die Freigabe fehlt, und bietet die drei Rollen", () => {
    const html = renderToStaticMarkup(createElement(ShareDialog, props));
    expect(html).toContain("„Mein Notebook“ teilen");
    expect(html).toContain("Freigabe noch nicht verfügbar");
    expect(html).toContain("Einladungen werden noch nicht verschickt");
    expect(SHARE_ROLES.map((role) => role.id)).toEqual(["owner", "editor", "viewer"]);
    for (const label of ["Eigentümer", "Bearbeiten", "Betrachten"]) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(html).toContain('<option value="viewer" selected="">Betrachten</option>');
    // Einzige Person mit Zugriff: der Gast als Eigentümer
    expect(html).toContain("Gast (Sie)");
    expect(html).toMatch(/Gast \(Sie\)<\/span><span class="rn-share-person-role">Eigentümer/);
    // Senden ist zurückgenommen und verweist auf den Hinweis
    expect(html).toMatch(/type="submit" aria-disabled="true" aria-describedby="[^"]+ [^"]+"/);
    expect(html).toContain('type="email"');
    expect(html).toContain('aria-label="Teilen schließen"');
    // Meldung erst nach dem Senden
    expect(html).toMatch(
      /<output id="[^"]+" aria-live="polite" data-testid="share-status" class="rn-visually-hidden"><\/output>/
    );
  });

  it("auf Englisch", () => {
    const html = renderEn(createElement(ShareDialog, props));
    expect(html).toContain("Share “Mein Notebook”");
    expect(html).toContain("Sharing not available yet");
    expect(html).toContain(">Can view</option>");
    expect(html).toContain("Guest (you)");
  });
});

describe("Konto und Spaltenleiste", () => {
  it("Konto zeigt den Gast-Zustand, ohne Anmeldefeld (Anmelden läuft über den Dialog)", () => {
    const html = renderToStaticMarkup(createElement(AccountStatus));
    expect(html).toContain(">Gast</p>");
    expect(html).toContain(">Nicht angemeldet</p>");
    expect(html).toContain("bleiben auf diesem Gerät gespeichert");
    expect(html).not.toMatch(/<input|password|Passwort/);
  });

  it("eingeklappter Umschalter und Leiste", () => {
    const html = renderToStaticMarkup(
      createElement(
        PanelRail,
        {
          panel: "studio",
          toggle: createElement(PanelToggle, {
            panel: "studio",
            collapsed: true,
            onToggle: () => {},
            controls: "studio-column"
          })
        },
        createElement(RailButton, {
          icon: "quiz",
          label: "Quiz",
          onClick: () => {},
          tipSide: "left",
          testId: "rail-tool-quiz"
        })
      )
    );
    expect(html).toMatch(/<section aria-label="Studio \(eingeklappt\)" data-testid="rail-studio"/);
    expect(html).toMatch(
      /aria-expanded="false" aria-controls="studio-column" aria-keyshortcuts="Alt\+Shift\+3" data-testid="btn-expand-studio"/
    );
    expect(html).toContain(
      '<span class="rn-tip rn-tip--left"><span class="rn-tip-label">Studio ausklappen'
    );
    // Werkzeugknopf ohne Kürzel und ohne aria-expanded
    expect(html).toMatch(
      /data-testid="rail-tool-quiz" class="rn-icon-btn rn-rail-button rn-tip-host">.*<span class="rn-tip rn-tip--left"><span class="rn-tip-label">Quiz<\/span><\/span>/
    );
    const sources = renderToStaticMarkup(
      createElement(PanelToggle, {
        panel: "sources",
        collapsed: true,
        onToggle: () => {},
        controls: "sources-column"
      })
    );
    expect(sources).toContain('data-testid="btn-expand-sources"');
    expect(sources).toContain("rn-tip--right");
    expect(sources).toContain("Quellen ausklappen");
  });

  it("Titel ist ein Knopf mit dem Titeltext", () => {
    const html = renderToStaticMarkup(
      createElement(NotebookTitle, { id: "t", title: "Projekt", onRename: () => {} })
    );
    expect(html).toMatch(/<h1 id="t" class="rn-nb-title"><button/);
    expect(html).toContain('<span class="rn-nb-title-text">Projekt</span>');
    expect(html).not.toContain("<input");
  });
});
