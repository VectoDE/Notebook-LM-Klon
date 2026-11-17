import { Icon } from "@/components/ui/index.js";
import { useTheme } from "@/hooks/index.js";
import { PANEL_TABS, type PanelTab } from "./workspace-config.js";

export interface TopNavProps {
  readonly isSinglePanel: boolean;
  readonly activeMobileTab: PanelTab;
  readonly sourceCount: number;
  readonly goToPanel: (tab: PanelTab) => void;
}

/** Reiter 600 bis 899 px: nur hier ist genau ein Bereich sichtbar. Ab 900 px sind die
   Spalten die Navigation, unter 600 px liegt die Leiste unten (Issue #325). */
export function TopNav({ isSinglePanel, activeMobileTab, sourceCount, goToPanel }: TopNavProps) {
  const { t } = useTheme();
  return (
      <nav aria-label={t("navAreas")} className="rn-topnav" data-testid="top-nav">
        {PANEL_TABS.map((tab) => {
          const isSources = tab.id === "sources";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => goToPanel(tab.id)}
              aria-current={isSinglePanel && activeMobileTab === tab.id ? "true" : undefined}
              data-testid={`top-tab-${tab.id}`}
              className="rn-topnav-item"
            >
              <Icon name={tab.icon} size={18} />
              <span className="rn-topnav-label">{t(tab.labelKey)}</span>
              {isSources && (
                <span className="rn-topnav-count">
                  <span className="rn-visually-hidden">, </span>
                  {sourceCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
  );
}
