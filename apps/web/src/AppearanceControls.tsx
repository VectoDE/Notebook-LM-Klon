import { Icon } from "./Icon.js";
import type { DesignTheme } from "./design-tokens.js";
import type { ColorModePreference } from "./theme-preferences.js";
import { useTheme } from "./useTheme.js";

export type UserRole = "owner" | "editor" | "viewer";

/**
 * Darstellung: Design, Farbschema, Bewegung und (am Ende) Rolle. Eine Komponente mit gleichem
 * Inhalt im Kopfmenü (Desktop) und im Menü-Sheet (Telefon), Issue #319.
 */
export interface AppearanceControlsProps {
  /** Ohne Rolle entfällt das Auswahlfeld. */
  readonly role?: UserRole | undefined;
  readonly onRoleChange?: ((role: UserRole) => void) | undefined;
  readonly theme: DesignTheme;
  readonly onThemeChange: (theme: DesignTheme) => void;
  readonly colorMode: ColorModePreference;
  readonly onColorModeChange: (mode: ColorModePreference) => void;
  /** Eindeutiger Präfix für ids und name-Attribute. */
  readonly idPrefix: string;
}

export const ROLE_OPTIONS: readonly { readonly id: UserRole; readonly labelKey: string }[] = [
  { id: "owner", labelKey: "roleOwner" },
  { id: "editor", labelKey: "roleEditor" },
  { id: "viewer", labelKey: "roleViewer" }
];

/**
 * Designs und Farbmodi mit Schlüsseln im Sprachkatalog (TRANSLATIONS in useTheme):
 * eine Quelle für die Namen in Kopfmenü, Menü-Sheet und Einstellungen.
 */
export const THEME_OPTIONS: readonly {
  readonly id: DesignTheme;
  readonly labelKey: string;
  readonly hintKey: string;
}[] = [
  { id: "pure", labelKey: "themePure", hintKey: "themePureHint" },
  { id: "editorial-calm", labelKey: "themeEditorial", hintKey: "themeEditorialHint" },
  { id: "immersive-cinema", labelKey: "themeCinema", hintKey: "themeCinemaHint" },
  { id: "fusion", labelKey: "themeFusion", hintKey: "themeFusionHint" }
];

export const MODE_OPTIONS: readonly {
  readonly id: ColorModePreference;
  readonly labelKey: string;
}[] = [
  { id: "system", labelKey: "modeSystem" },
  { id: "light", labelKey: "modeLight" },
  { id: "dark", labelKey: "modeDark" },
  { id: "aaa-contrast", labelKey: "modeAAA" }
];

export function AppearanceControls({
  role,
  onRoleChange,
  theme,
  onThemeChange,
  colorMode,
  onColorModeChange,
  idPrefix
}: AppearanceControlsProps) {
  const { t, reduceMotion, setReduceMotion } = useTheme();
  return (
    <div className="rn-appearance">
      <fieldset className="rn-appearance-group">
        <legend className="rn-appearance-label">{t("themeLabel")}</legend>
        <div className="rn-choices">
          {THEME_OPTIONS.map((o) => (
            <label key={o.id} className="rn-choice" data-option={o.id}>
              <input
                type="radio"
                name={`${idPrefix}-theme`}
                value={o.id}
                checked={theme === o.id}
                onChange={() => onThemeChange(o.id)}
                data-testid={`theme-option-${o.id}`}
                className="rn-choice-input"
              />
              <span className="rn-choice-swatch" aria-hidden="true" />
              <span className="rn-choice-text">
                <span className="rn-choice-title">{t(o.labelKey)}</span>
                <span className="rn-choice-hint">{t(o.hintKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rn-appearance-group">
        <legend className="rn-appearance-label">{t("colorModeLabel")}</legend>
        {/* Liste wie bei „Design“: jede Option eine Zeile, alle gleich hoch (Issue #315) */}
        <div className="rn-choices rn-choices--compact">
          {MODE_OPTIONS.map((o) => (
            <label key={o.id} className="rn-choice" data-option={o.id}>
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                value={o.id}
                checked={colorMode === o.id}
                onChange={() => onColorModeChange(o.id)}
                data-testid={`mode-option-${o.id}`}
                className="rn-choice-input"
              />
              <span className="rn-choice-swatch" aria-hidden="true" />
              <span className="rn-choice-title">{t(o.labelKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rn-appearance-group rn-motion-setting">
        <legend className="rn-appearance-label">{t("motionLabel")}</legend>
        <label className="rn-check-row" htmlFor={`${idPrefix}-reduce-motion`}>
          <input
            id={`${idPrefix}-reduce-motion`}
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
            aria-describedby={`${idPrefix}-reduce-motion-hint`}
            data-testid="reduce-motion-toggle"
            className="rn-checkbox"
          />
          <span>{t("motionToggle")}</span>
        </label>
        <p id={`${idPrefix}-reduce-motion-hint`} className="rn-setting-hint">
          {t("motionHint")}
        </p>
      </fieldset>

      {/* Rolle am Ende: beim Öffnen landet der Fokus auf „Design“ (Issue #319, Entscheidung #302) */}
      {role !== undefined && (
        <div className="rn-appearance-group">
          <label htmlFor={`${idPrefix}-role`} className="rn-appearance-label">
            {t("roleLabel")}
          </label>
          <div className="rn-control rn-control--block">
            <select
              id={`${idPrefix}-role`}
              value={role}
              onChange={(e) => onRoleChange?.(e.target.value as UserRole)}
              data-testid="role-switcher-select"
              className="rn-control-input"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={16} className="rn-control-chevron" />
          </div>
        </div>
      )}

      <p className="rn-setting-hint">{t("appearanceStored")}</p>
    </div>
  );
}
