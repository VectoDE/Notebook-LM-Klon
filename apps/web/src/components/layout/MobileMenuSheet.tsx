import type { Dispatch, SetStateAction } from "react";
import { LegalFooter } from "@/components/panels/index.js";
import { AppearanceControls, Icon } from "@/components/ui/index.js";
import { type HeaderMenus, useTheme } from "@/hooks/index.js";
import { AccountStatus } from "./AccountStatus.js";
import type { AppearanceProps } from "./workspace-config.js";

export interface MobileMenuSheetProps {
  readonly menus: HeaderMenus;
  readonly appearanceProps: AppearanceProps;
  readonly setIsShareOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setIsSignInOpen: Dispatch<SetStateAction<boolean>>;
  readonly signOut: () => Promise<void>;
}

/** Mobiles Menü (unter 600 px): Vollbild-Sheet mit Teilen, Einstellungen, Konto, Darstellung. */
export function MobileMenuSheet({
  menus,
  appearanceProps,
  setIsShareOpen,
  setIsSettingsOpen,
  setIsSignInOpen,
  signOut
}: MobileMenuSheetProps) {
  const { t } = useTheme();
  const { sheetRef, closeMenu, handleSheetKeyDown } = menus;
  return (
        <dialog
          id="nav-sheet"
          ref={sheetRef}
          aria-labelledby="nav-sheet-title"
          data-testid="nav-sheet"
          className="rn-sheet"
          onCancel={(e) => {
            e.preventDefault();
            closeMenu();
          }}
          onKeyDown={handleSheetKeyDown}
        >
          <div className="rn-sheet-head">
            <h2 id="nav-sheet-title" className="rn-sheet-title">
              {t("menuTitle")}
            </h2>
            <button
              type="button"
              onClick={() => closeMenu()}
              aria-label={t("menuClose")}
              data-testid="btn-close-menu"
              className="rn-icon-btn rn-dialog-close"
            >
              <Icon name="close" size={22} />
            </button>
          </div>

          <div className="rn-sheet-body">
            {/* Die Bereiche (Quellen, Chat, Studio) stehen in der unteren Leiste, hier nur der Rest */}
            <ul className="rn-sheet-nav">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu(false);
                    setIsShareOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="sheet-open-share"
                  className="rn-sheet-item"
                >
                  <Icon name="share" size={22} />
                  <span className="rn-sheet-item-text">
                    <span className="rn-sheet-item-title">{t("shareButton")}</span>
                    <span className="rn-sheet-item-hint">{t("shareMenuHint")}</span>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu(false);
                    setIsSettingsOpen(true);
                  }}
                  aria-haspopup="dialog"
                  data-testid="sheet-open-settings"
                  className="rn-sheet-item"
                >
                  <Icon name="settings" size={22} />
                  <span className="rn-sheet-item-text">
                    <span className="rn-sheet-item-title">{t("navSettings")}</span>
                    <span className="rn-sheet-item-hint">{t("navSettingsHint")}</span>
                  </span>
                </button>
              </li>
            </ul>

            <section aria-labelledby="nav-sheet-account" data-testid="sheet-account">
              <h3 id="nav-sheet-account" className="rn-sheet-section">
                {t("accountButton")}
              </h3>
              <AccountStatus />
              <button
                type="button"
                onClick={() => {
                  closeMenu(false);
                  setIsSignInOpen(true);
                }}
                aria-haspopup="dialog"
                data-testid="sheet-open-sign-in"
                className="rn-btn rn-btn--primary rn-btn--block"
              >
                {t("signInOpen")}
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMenu(false);
                  void signOut();
                }}
                data-testid="sheet-sign-out"
                className="rn-btn rn-btn--secondary rn-btn--block"
              >
                {t("signOutWipe")}
              </button>
            </section>

            <section aria-labelledby="nav-sheet-appearance">
              <h3 id="nav-sheet-appearance" className="rn-sheet-section">
                {t("appearanceTitle")}
              </h3>
              <AppearanceControls idPrefix="sheet" {...appearanceProps} />
            </section>

            {/* Datenschutz und Cookie-Einstellungen; unter 600 px nur hier (Issue #261) */}
            <LegalFooter placement="sheet" onOpen={() => closeMenu(false)} />
          </div>
        </dialog>
  );
}
