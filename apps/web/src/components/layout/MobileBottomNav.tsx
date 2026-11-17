import { Icon } from "@/components/ui/index.js";
import { useTheme } from "@/hooks/index.js";
import { PANEL_TABS, type PanelTab } from "./workspace-config.js";

export interface MobileBottomNavProps {
  readonly activeMobileTab: PanelTab;
  readonly sourceCount: number;
  readonly goToPanel: (tab: PanelTab) => void;
}

/** Untere Reiterleiste (unter 600 px): im Daumenbereich, Symbol und Kurzname. */
export function MobileBottomNav({ activeMobileTab, sourceCount, goToPanel }: MobileBottomNavProps) {
  const { t } = useTheme();
  return (
      <nav aria-label={t("navAreas")} data-testid="mobile-bottom-nav" className="mobile-bottom-nav">
        {PANEL_TABS.map((tab) => {
          const isActive = activeMobileTab === tab.id;
          const isSources = tab.id === "sources";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => goToPanel(tab.id)}
              aria-current={isActive ? "true" : undefined}
              aria-label={isSources ? undefined : t(tab.ariaKey)}
              data-testid={`tab-btn-${tab.id}`}
              className="rn-tab"
            >
              <span className="rn-tab-indicator" aria-hidden="true">
                <Icon name={tab.icon} size={22} />
                {isSources && <span className="rn-tab-count">{sourceCount}</span>}
              </span>
              <span className="rn-tab-label">{t(tab.labelKey)}</span>
              {isSources && <span className="rn-visually-hidden"> ({sourceCount})</span>}
            </button>
          );
        })}
      </nav>
  );
}
