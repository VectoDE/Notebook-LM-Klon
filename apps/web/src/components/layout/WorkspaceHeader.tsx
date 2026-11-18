import { WORKSPACE_VERSION } from "@notebook-lm/shared";
import type { Dispatch, SetStateAction } from "react";
import { AppearanceControls, BrandLogo, Icon } from "@/components/ui/index.js";
import { type HeaderMenus, type NotebookSyncHandle, useTheme } from "@/hooks/index.js";
import { describeSyncStatus } from "@/services/sync/index.js";
import { AccountStatus } from "./AccountStatus.js";
import { NotebookTitle } from "./NotebookTitle.js";
import type { AppearanceProps } from "./workspace-config.js";

export interface WorkspaceHeaderProps {
  readonly isNarrowHeader: boolean;
  readonly notebookTitle: string;
  readonly renameNotebook: (title: string) => void;
  readonly notebookSync: NotebookSyncHandle;
  readonly menus: HeaderMenus;
  readonly appearanceProps: AppearanceProps;
  readonly setIsShareOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSignInOpen: Dispatch<SetStateAction<boolean>>;
  readonly signOut: () => Promise<void>;
}

/** Anwendungsleiste: Logo, Notebook-Titel, Teilen, Einstellungen, Darstellung, Konto. */
export function WorkspaceHeader({
  isNarrowHeader,
  notebookTitle,
  renameNotebook,
  notebookSync,
  menus,
  appearanceProps,
  setIsShareOpen,
  setIsSettingsOpen,
  setIsSignInOpen,
  signOut
}: WorkspaceHeaderProps) {
  const { t, tf } = useTheme();
  const {
    tipHandlers,
    openPopover,
    isMenuOpen,
    setIsMenuOpen,
    appearanceAnchorRef,
    accountAnchorRef,
    appearanceButtonRef,
    accountButtonRef,
    popoverPanelRef,
    menuButtonRef,
    settingsButtonRef,
    shareButtonRef,
    settingsFromAccountRef,
    togglePopover,
    closePopover,
    handlePopoverKeyDown
  } = menus;
  return (
    <header data-testid="workspace-header" className="workspace-header">
      <div className="workspace-brand">
        <span className="workspace-logo">
          <BrandLogo height={isNarrowHeader ? 26 : 32} />
        </span>
        <span className="workspace-version">v{WORKSPACE_VERSION}</span>
        <NotebookTitle id="notebook-title" title={notebookTitle} onRename={renameNotebook} />
        <output
          data-testid="sync-status"
          data-state={notebookSync.status?.state}
          className="rn-sync-status"
          title={notebookSync.status ? describeSyncStatus(notebookSync.status, tf) : undefined}
          hidden={!notebookSync.status}
        >
          {notebookSync.status && (
            <>
              <span className="rn-sync-dot" aria-hidden="true" />
              <span className="rn-sync-text">{describeSyncStatus(notebookSync.status, tf)}</span>
              {notebookSync.status.pending > 0 && (
                <span className="rn-sync-count" aria-hidden="true">
                  {notebookSync.status.pending}
                </span>
              )}
            </>
          )}
        </output>
      </div>

      <div className="rn-header-end">
        <button
          ref={shareButtonRef}
          type="button"
          onClick={() => setIsShareOpen(true)}
          data-testid="btn-open-share"
          aria-haspopup="dialog"
          className="rn-control rn-control--button rn-share-button rn-tip-host"
          {...tipHandlers}
        >
          <Icon name="share" size={18} />
          <span className="rn-share-button-label">{t("shareButton")}</span>
        </button>
        <button
          ref={settingsButtonRef}
          type="button"
          onClick={() => {
            settingsFromAccountRef.current = false;
            setIsSettingsOpen(true);
          }}
          data-testid="btn-open-settings"
          aria-haspopup="dialog"
          className="rn-control rn-control--button rn-settings-button rn-tip-host"
          {...tipHandlers}
        >
          <Icon name="settings" size={18} />
          <span className="rn-settings-button-label">{t("navSettings")}</span>
        </button>
        <div className="rn-popover-anchor" ref={appearanceAnchorRef}>
          <button
            ref={appearanceButtonRef}
            type="button"
            // detail 0: per Enter oder Leertaste ausgelöst
            onClick={(event) => togglePopover("appearance", event.detail === 0)}
            aria-expanded={openPopover === "appearance"}
            aria-controls="appearance-menu"
            aria-haspopup="dialog"
            data-testid="btn-open-appearance"
            className="rn-control rn-control--button rn-appearance-button rn-tip-host"
            {...tipHandlers}
          >
            <Icon name="palette" size={18} />
            <span className="rn-appearance-button-label">{t("appearanceTitle")}</span>
            <Icon name="chevron" size={16} className="rn-icon rn-appearance-chevron" />
          </button>
          {openPopover === "appearance" && !isNarrowHeader && (
            <dialog
              id="appearance-menu"
              ref={popoverPanelRef}
              open
              tabIndex={-1}
              aria-label={t("appearanceTitle")}
              data-testid="appearance-menu"
              className="rn-popover"
              onKeyDown={handlePopoverKeyDown}
            >
              <AppearanceControls idPrefix="appearance" {...appearanceProps} />
            </dialog>
          )}
        </div>
        <div className="rn-popover-anchor" ref={accountAnchorRef}>
          <button
            ref={accountButtonRef}
            type="button"
            onClick={(event) => togglePopover("account", event.detail === 0)}
            aria-expanded={openPopover === "account"}
            aria-controls="account-menu"
            aria-haspopup="dialog"
            data-testid="btn-open-account"
            className="rn-control rn-control--button rn-account-button rn-tip-host"
            {...tipHandlers}
          >
            <Icon name="account" size={22} />
            <span className="rn-tip rn-tip--below">
              <span className="rn-tip-label">{t("accountButton")}</span>
            </span>
          </button>
          {openPopover === "account" && !isNarrowHeader && (
            <dialog
              id="account-menu"
              ref={popoverPanelRef}
              open
              tabIndex={-1}
              aria-label={t("accountButton")}
              data-testid="account-menu"
              className="rn-popover rn-account"
              onKeyDown={handlePopoverKeyDown}
            >
              <AccountStatus />
              <button
                type="button"
                onClick={() => {
                  // Fokus zuerst auf den Konto-Knopf: der Dialog merkt ihn als Rückkehrziel
                  closePopover(true);
                  setIsSignInOpen(true);
                }}
                aria-haspopup="dialog"
                data-testid="account-open-sign-in"
                className="rn-btn rn-btn--primary rn-btn--block"
              >
                <Icon name="account" size={18} />
                {t("signInOpen")}
              </button>
              <button
                type="button"
                onClick={() => {
                  // Fokus zuerst auf den Konto-Knopf: der Dialog merkt ihn als Rückkehrziel
                  closePopover(true);
                  settingsFromAccountRef.current = true;
                  setIsSettingsOpen(true);
                }}
                aria-haspopup="dialog"
                data-testid="account-open-settings"
                className="rn-btn rn-btn--secondary rn-btn--block"
              >
                <Icon name="settings" size={18} />
                {t("accountOpenSettings")}
              </button>
              <button
                type="button"
                onClick={() => {
                  closePopover(true);
                  void signOut();
                }}
                data-testid="account-sign-out"
                className="rn-btn rn-btn--secondary rn-btn--block"
              >
                {t("signOutWipe")}
              </button>
            </dialog>
          )}
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMenuOpen(true)}
          aria-expanded={isMenuOpen}
          aria-controls="nav-sheet"
          aria-haspopup="dialog"
          aria-label={t("menuOpen")}
          data-testid="btn-open-menu"
          className="rn-control rn-control--button rn-menu-button"
        >
          <Icon name="menu" size={22} />
        </button>
      </div>
    </header>
  );
}
