import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { trapTabKey } from "./focus-trap.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { useTheme } from "./useTheme.js";

export type ShareRole = "owner" | "editor" | "viewer";

export const SHARE_ROLES: readonly { readonly id: ShareRole; readonly labelKey: string }[] = [
  { id: "owner", labelKey: "shareRoleOwner" },
  { id: "editor", labelKey: "shareRoleEditor" },
  { id: "viewer", labelKey: "shareRoleViewer" }
];

export interface ShareDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly notebookTitle: string;
  /** Ziel für den Fokus, wenn der Auslöser nicht mehr erreichbar ist (z. B. im Menü-Sheet). */
  readonly returnFocusFallback?: (() => HTMLElement | null | undefined) | undefined;
}

/**
 * Teilen (Issue #325): nur Oberfläche. Es gibt noch keine Freigabe; der Dialog sagt das
 * oben deutlich, schickt nichts ab und macht keinen Netzwerkaufruf. Senden meldet ehrlich,
 * dass nichts verschickt wurde.
 */
export function ShareDialog({
  isOpen,
  onClose,
  notebookTitle,
  returnFocusFallback
}: ShareDialogProps) {
  const { t, tf } = useTheme();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [attempted, setAttempted] = useState(false);
  const titleId = useId();
  const noticeId = useId();
  const statusId = useId();

  // Vor showModal(): Auslöser merken, nach dem Schließen dorthin zurück
  useReturnFocus(isOpen, returnFocusFallback);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
      emailRef.current?.focus();
    }
    if (!isOpen) setAttempted(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={noticeId}
      data-testid="share-dialog"
      className="rn-dialog rn-share"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (dialogRef.current) trapTabKey(event, dialogRef.current, document.activeElement);
      }}
    >
      <div className="rn-dialog-card rn-share-card">
        <div className="rn-share-head">
          <h2 id={titleId} className="rn-share-title">
            {tf("shareTitle", { title: notebookTitle })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shareClose")}
            data-testid="btn-close-share"
            className="rn-icon-btn rn-dialog-close"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <div id={noticeId} className="rn-share-notice" data-testid="share-notice">
          <p className="rn-share-notice-title">{t("shareNoticeTitle")}</p>
          <p className="rn-share-notice-text">{t("shareNotice")}</p>
        </div>

        <form onSubmit={handleSubmit} className="rn-form" noValidate>
          <div className="rn-share-invite">
            <div className="rn-field">
              <label htmlFor="share-email-input">{t("shareEmailLabel")}</label>
              <input
                id="share-email-input"
                ref={emailRef}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("shareEmailPlaceholder")}
                data-testid="share-email-input"
                className="rn-input"
              />
            </div>
            <div className="rn-field">
              <label htmlFor="share-role-select">{t("shareRoleLabel")}</label>
              <div className="rn-control rn-control--block">
                <select
                  id="share-role-select"
                  value={role}
                  onChange={(event) => setRole(event.target.value as ShareRole)}
                  data-testid="share-role-select"
                  className="rn-control-input"
                >
                  {SHARE_ROLES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" size={16} className="rn-control-chevron" />
              </div>
            </div>
          </div>

          <output
            id={statusId}
            aria-live="polite"
            data-testid="share-status"
            className={attempted ? "rn-share-status" : "rn-visually-hidden"}
          >
            {attempted ? t("shareSendUnavailable") : ""}
          </output>

          <section aria-labelledby="share-people-title" className="rn-share-people">
            <h3 id="share-people-title" className="rn-share-people-title">
              {t("sharePeopleTitle")}
            </h3>
            <ul className="rn-share-list" data-testid="share-people">
              <li className="rn-share-person">
                <span className="rn-share-avatar" aria-hidden="true">
                  <Icon name="account" size={22} />
                </span>
                <span className="rn-share-person-name">{t("shareGuestYou")}</span>
                <span className="rn-share-person-role">{t("shareRoleOwner")}</span>
              </li>
            </ul>
          </section>

          <div className="rn-dialog-actions">
            <button
              type="button"
              onClick={onClose}
              data-testid="btn-share-done"
              className="rn-btn rn-btn--secondary"
            >
              {t("shareDone")}
            </button>
            <button
              type="submit"
              aria-disabled="true"
              aria-describedby={`${noticeId} ${statusId}`}
              data-testid="btn-share-send"
              className="rn-btn rn-btn--secondary rn-btn--unavailable"
            >
              {t("shareSend")}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
