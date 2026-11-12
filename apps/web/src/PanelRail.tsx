import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon.js";
import { type CollapsiblePanel, PANEL_SHORTCUTS } from "./layout-preferences.js";
import { useTheme } from "./useTheme.js";

/**
 * Seite, zu der die Kurzinfo aufgeht: in der Quellen-Leiste nach rechts, im Studio nach
 * links, im Kopf darunter (rechtsbündig oder mit below-start linksbündig).
 */
export type TipSide = "right" | "left" | "below" | "below-start";

export interface RailButtonProps {
  readonly icon: IconName;
  /** Sichtbar als Kurzinfo und zugleich der Name des Knopfs. */
  readonly label: string;
  readonly onClick: () => void;
  readonly tipSide: TipSide;
  readonly testId: string;
  /** Anzeige des Tastenkürzels in der Kurzinfo (nicht Teil des Namens). */
  readonly shortcutLabel?: string | undefined;
  readonly keyShortcuts?: string | undefined;
  readonly expanded?: boolean | undefined;
  readonly controls?: string | undefined;
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
  readonly className?: string | undefined;
}

/**
 * Symbolknopf mit Kurzinfo (WCAG 1.4.13): der Name steht als Text im Knopf und erscheint
 * bei Zeiger und Tastaturfokus neben dem Symbol; Escape blendet ihn aus (data-tips-hidden).
 */
export function RailButton({
  icon,
  label,
  onClick,
  tipSide,
  testId,
  shortcutLabel,
  keyShortcuts,
  expanded,
  controls,
  buttonRef,
  className = ""
}: RailButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-keyshortcuts={keyShortcuts}
      data-testid={testId}
      className={`rn-icon-btn rn-rail-button rn-tip-host ${className}`.trim()}
    >
      <Icon name={icon} size={20} />
      <span className={`rn-tip rn-tip--${tipSide}`}>
        <span className="rn-tip-label">{label}</span>
        {shortcutLabel && (
          <span className="rn-tip-kbd" aria-hidden="true">
            {shortcutLabel}
          </span>
        )}
      </span>
    </button>
  );
}

export interface PanelToggleProps {
  readonly panel: CollapsiblePanel;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly controls: string;
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
}

/** Umschalter am Spaltenrand: klappt Quellen oder Studio ein und aus. */
export function PanelToggle({ panel, collapsed, onToggle, controls, buttonRef }: PanelToggleProps) {
  const { t } = useTheme();
  const isSources = panel === "sources";
  const label = isSources
    ? t(collapsed ? "panelExpandSources" : "panelCollapseSources")
    : t(collapsed ? "panelExpandStudio" : "panelCollapseStudio");
  return (
    <RailButton
      icon={isSources ? "panelLeft" : "panelRight"}
      label={label}
      onClick={onToggle}
      // Leiste: zur Mitte hin; im Spaltenkopf darunter, bündig mit dem Spaltenrand
      tipSide={collapsed ? (isSources ? "right" : "left") : isSources ? "below" : "below-start"}
      testId={`btn-${collapsed ? "expand" : "collapse"}-${panel}`}
      shortcutLabel={t(isSources ? "shortcutSources" : "shortcutStudio")}
      keyShortcuts={PANEL_SHORTCUTS[panel]}
      expanded={!collapsed}
      controls={controls}
      buttonRef={buttonRef}
      className="rn-panel-toggle"
    />
  );
}

export interface PanelRailProps {
  readonly panel: CollapsiblePanel;
  readonly toggle: ReactNode;
  readonly children?: ReactNode;
}

/** Schmale Symbolleiste einer eingeklappten Spalte. */
export function PanelRail({ panel, toggle, children }: PanelRailProps) {
  const { t } = useTheme();
  return (
    <section
      aria-label={t(panel === "sources" ? "railSourcesLabel" : "railStudioLabel")}
      data-testid={`rail-${panel}`}
      className={`rn-rail rn-rail--${panel}`}
    >
      {toggle}
      <div className="rn-rail-items">{children}</div>
    </section>
  );
}
