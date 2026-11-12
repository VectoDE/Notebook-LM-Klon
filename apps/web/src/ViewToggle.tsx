import { useId } from "react";
import { Icon, type IconName } from "./Icon.js";

export interface ViewOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: IconName;
}

export interface ViewToggleProps<T extends string> {
  /** Name der Gruppe für Screenreader, z. B. „Ansicht der Quellen“. */
  readonly label: string;
  readonly value: T;
  readonly options: readonly ViewOption<T>[];
  readonly onChange: (value: T) => void;
  readonly testId: string;
}

/**
 * Umschalter zwischen zwei Ansichten (Issue #329): native Optionsfelder in einer
 * beschrifteten Gruppe, Pfeiltasten wechseln, jede Option hat Symbol und sichtbaren Text.
 */
export function ViewToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  testId
}: ViewToggleProps<T>) {
  const name = useId();
  return (
    <fieldset className="rn-view-toggle" data-testid={testId}>
      <legend className="rn-visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="rn-view-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            data-testid={`${testId}-${option.value}`}
            className="rn-view-input"
          />
          <Icon name={option.icon} size={18} />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
