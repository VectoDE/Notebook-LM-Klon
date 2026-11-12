import { Icon } from "./Icon.js";
import type { ColorMode, DesignTheme } from "./design-tokens.js";

export type UserRole = "owner" | "editor" | "viewer";

/** Darstellung: Rolle, Design und Farbschema. Wird im Desktop-Menü und im mobilen Sheet genutzt. */
export interface AppearanceControlsProps {
  readonly role: UserRole;
  readonly onRoleChange: (role: UserRole) => void;
  readonly theme: DesignTheme;
  readonly onThemeChange: (theme: DesignTheme) => void;
  readonly colorMode: ColorMode;
  readonly onColorModeChange: (mode: ColorMode) => void;
  /** Eindeutiger Präfix für ids und name-Attribute. */
  readonly idPrefix: string;
}

export const ROLE_OPTIONS: readonly { readonly id: UserRole; readonly label: string }[] = [
  { id: "owner", label: "Inhaber" },
  { id: "editor", label: "Bearbeiter" },
  { id: "viewer", label: "Betrachter" }
];

export const THEME_OPTIONS: readonly {
  readonly id: DesignTheme;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: "pure", label: "Pure", hint: "Ruhige Klarheit" },
  { id: "editorial-calm", label: "Editorial", hint: "Lesen mit Serife" },
  { id: "immersive-cinema", label: "Cinema", hint: "Tiefe und Licht" },
  { id: "fusion", label: "Fusion", hint: "Energie und Farbe" }
];

export const MODE_OPTIONS: readonly { readonly id: ColorMode; readonly label: string }[] = [
  { id: "light", label: "Hell" },
  { id: "dark", label: "Dunkel" },
  { id: "aaa-contrast", label: "AAA" }
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
  return (
    <div className="rn-appearance">
      <div className="rn-appearance-group">
        <label htmlFor={`${idPrefix}-role`} className="rn-appearance-label">
          Rolle
        </label>
        <div className="rn-control rn-control--block">
          <select
            id={`${idPrefix}-role`}
            value={role}
            onChange={(e) => onRoleChange(e.target.value as UserRole)}
            data-testid="role-switcher-select"
            className="rn-control-input"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={16} className="rn-control-chevron" />
        </div>
      </div>

      <fieldset className="rn-appearance-group">
        <legend className="rn-appearance-label">Design</legend>
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
                <span className="rn-choice-title">{o.label}</span>
                <span className="rn-choice-hint">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rn-appearance-group">
        <legend className="rn-appearance-label">Farbschema</legend>
        <div className="rn-segmented">
          {MODE_OPTIONS.map((o) => (
            <label key={o.id} className="rn-segment">
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                value={o.id}
                checked={colorMode === o.id}
                onChange={() => onColorModeChange(o.id)}
                data-testid={`mode-option-${o.id}`}
                className="rn-segment-input"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
