import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { NOTEBOOK_TITLE_MAX_LENGTH, normalizeNotebookTitle } from "./layout-preferences.js";
import { useTheme } from "./useTheme.js";

export interface NotebookTitleProps {
  /** id der Überschrift: main verweist mit aria-labelledby darauf. */
  readonly id: string;
  readonly title: string;
  readonly onRename: (title: string) => void;
}

/**
 * Bearbeitbarer Notebook-Titel (Issue #325) als Hauptüberschrift der Seite.
 * Klick, Enter oder Leertaste öffnen das Feld; Enter und Verlassen speichern, Escape
 * verwirft. Danach liegt der Fokus wieder auf dem Titel.
 */
export function NotebookTitle({ id, title, onRename }: NotebookTitleProps) {
  const { t } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Nach Enter oder Escape nicht noch einmal beim Verlassen des Felds speichern
  const finishedRef = useRef(false);
  const hintId = useId();

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const startEditing = () => {
    finishedRef.current = false;
    setDraft(title);
    setIsEditing(true);
  };

  const finish = (save: boolean, restoreFocus: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (save) {
      const next = normalizeNotebookTitle(draft, title);
      if (next !== title) onRename(next);
    }
    setIsEditing(false);
    if (restoreFocus) requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false, true);
    }
  };

  return (
    <div className="rn-nb-title-wrap">
      <h1 id={id} className="rn-nb-title" hidden={isEditing}>
        <button
          ref={buttonRef}
          type="button"
          onClick={startEditing}
          aria-describedby={hintId}
          data-testid="notebook-title-button"
          className="rn-nb-title-button"
        >
          <span className="rn-nb-title-text">{title}</span>
          <Icon name="edit" size={16} className="rn-icon rn-nb-title-icon" />
        </button>
      </h1>
      <span id={hintId} className="rn-visually-hidden">
        {t("titleEditHint")}
      </span>
      {isEditing && (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          maxLength={NOTEBOOK_TITLE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => finish(true, false)}
          aria-label={t("titleInputLabel")}
          data-testid="notebook-title-input"
          className="rn-input rn-nb-title-input"
        />
      )}
    </div>
  );
}
