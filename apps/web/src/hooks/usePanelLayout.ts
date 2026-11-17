import { useEffect, useRef, useState } from "react";
import type { PanelTab } from "@/components/layout/workspace-config.js";
import { isModalOpen } from "@/lib/a11y/index.js";
import {
  matchPanelShortcut,
  readCollapsedPanels,
  storeCollapsedPanels
} from "@/preferences/index.js";
import type { CollapsedPanels, CollapsiblePanel } from "@/preferences/layout-preferences.js";
import { browserStorage } from "@/theme/index.js";
import type { PanelFocusAttributes } from "@/types/workspace-types.js";
import { useTheme } from "./useTheme.js";

/**
 * Spalten des Arbeitsbereichs: aktiver Bereich, Wissensgraph statt Chat, Einklappen mit
 * Meldung für Screenreader, Kürzel Alt+Umschalt+1 / +3 und Fokus auf das Ziel-Panel.
 */
export function usePanelLayout(initialPanelTab: PanelTab, isSinglePanel: boolean) {
  const { t } = useTheme();
  const [activeMobileTab, setActiveMobileTab] = useState<PanelTab>(initialPanelTab);
  // Wissensgraph statt Chat in der mittleren Spalte (Issue #327); der Chat bleibt erhalten
  const [isGraphOpen, setIsGraphOpen] = useState(initialPanelTab === "graph");
  // Eingeklappte Spalten bleiben auf dem Gerät gespeichert (Issue #325); ohne
  // gespeicherte Wahl startet das Studio auf schmalem Desktop eingeklappt (Issue #335)
  const [collapsed, setCollapsed] = useState<CollapsedPanels>(() =>
    readCollapsedPanels(
      browserStorage(),
      typeof window === "undefined" ? undefined : window.innerWidth
    )
  );
  // Kurze Meldung für Screenreader (Spalte ein- oder ausgeklappt, Titel gespeichert)
  const [announcement, setAnnouncement] = useState("");

  // Einklappen gilt nur, wenn alle Spalten nebeneinander stehen (ab 900 px)
  const isCollapsed = (panel: CollapsiblePanel) => !isSinglePanel && collapsed[panel];

  const setPanelCollapsed = (panel: CollapsiblePanel, value: boolean) => {
    setCollapsed((prev) => {
      const next = { ...prev, [panel]: value };
      storeCollapsedPanels(browserStorage(), next);
      return next;
    });
    const key =
      panel === "sources"
        ? value
          ? "panelSourcesCollapsed"
          : "panelSourcesExpanded"
        : value
          ? "panelStudioCollapsed"
          : "panelStudioExpanded";
    setAnnouncement(t(key));
  };

  /**
   * Spalte ein- oder ausklappen. Ging der Fokus dabei verloren (er lag in der eingeklappten
   * Spalte oder auf dem verschwundenen Knopf der Leiste), landet er auf dem Umschalter.
   */
  const togglePanel = (panel: CollapsiblePanel) => {
    const willCollapse = !collapsed[panel];
    setPanelCollapsed(panel, willCollapse);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const lost = !active || active === document.body || active.closest("[hidden]") !== null;
      if (!lost) return;
      document
        .querySelector<HTMLElement>(
          `[data-testid="btn-${willCollapse ? "expand" : "collapse"}-${panel}"]`
        )
        ?.focus();
    });
  };

  // Kürzel Alt+Umschalt+1 / +3 (nur ab 900 px und ohne offenen modalen Dialog)
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;
  useEffect(() => {
    if (isSinglePanel) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = matchPanelShortcut(event);
      if (!panel || event.defaultPrevented || isModalOpen()) return;
      event.preventDefault();
      togglePanelRef.current(panel);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSinglePanel]);

  /**
   * Bereich wählen; der Fokus springt in das Panel (Tastatur landet direkt im Inhalt).
   * Unter 900 px schaltet das den sichtbaren Bereich um; ab 900 px wird eine eingeklappte
   * Spalte dabei ausgeklappt.
   */
  const goToPanel = (tab: PanelTab) => {
    setActiveMobileTab(tab);
    if (tab === "graph") setIsGraphOpen(true);
    if (tab === "chat") setIsGraphOpen(false);
    if ((tab === "sources" || tab === "studio") && isCollapsed(tab)) {
      setPanelCollapsed(tab, false);
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-panel="${tab}"]`)?.focus({ preventScroll: true });
    });
  };

  // Fokusziel ist die benannte Region im Bereich, nicht der Layout-Wrapper (Issue #323)
  const panelAttributes = (tab: PanelTab): PanelFocusAttributes => ({
    "data-panel": tab,
    tabIndex: -1
  });

  return {
    activeMobileTab,
    setActiveMobileTab,
    isGraphOpen,
    announcement,
    isCollapsed,
    setPanelCollapsed,
    togglePanel,
    goToPanel,
    panelAttributes
  };
}

export type PanelLayout = ReturnType<typeof usePanelLayout>;
