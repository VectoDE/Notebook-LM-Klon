import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Popover } from "@/components/layout/workspace-config.js";
import { FOCUSABLE_SELECTOR, trapTabKey } from "@/lib/a11y/index.js";

/**
 * Menüs im Kopf: Popover für Darstellung und Konto, Menü-Sheet unter 600 px, Kurzinfos der
 * Symbolknöpfe (Escape blendet sie aus) und die Refs, über die der Fokus zurückkehrt.
 */
export function useHeaderMenus(isNarrowHeader: boolean) {
  // Kurzinfos der Symbolknöpfe: Escape blendet sie aus, bis Zeiger oder Fokus den Knopf verlassen
  const [tipsHidden, setTipsHidden] = useState(false);
  const [openPopover, setOpenPopover] = useState<Popover | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const appearanceAnchorRef = useRef<HTMLDivElement>(null);
  const accountAnchorRef = useRef<HTMLDivElement>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const popoverPanelRef = useRef<HTMLDialogElement>(null);
  const popoverOpenedByKeyboard = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const settingsFromAccountRef = useRef(false);
  const sheetRef = useRef<HTMLDialogElement>(null);

  // WCAG 1.4.13: Kurzinfo per Escape schließen, ohne Zeiger oder Fokus zu bewegen
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setTipsHidden(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const showTips = () => setTipsHidden(false);
  const tipHandlers = { onPointerLeave: showTips, onBlur: showTips };

  // Beim Wechsel zwischen Telefon- und Desktop-Kopf sind offene Menüs ungültig
  const [menuLayoutNarrow, setMenuLayoutNarrow] = useState(isNarrowHeader);
  if (menuLayoutNarrow !== isNarrowHeader) {
    setMenuLayoutNarrow(isNarrowHeader);
    setOpenPopover(null);
    setIsMenuOpen(false);
  }

  // Menüs im Kopf (Darstellung, Konto): Fokus hinein, Klick außerhalb schließt
  useEffect(() => {
    if (!openPopover) return;
    // Tastatur: Fokus auf das erste Feld (bei Radiogruppen das gewählte); Maus: auf das Menü
    const panel = popoverPanelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (popoverOpenedByKeyboard.current ? first : panel)?.focus();
    const anchor = (openPopover === "appearance" ? appearanceAnchorRef : accountAnchorRef).current;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor?.contains(event.target as Node)) setOpenPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openPopover]);

  const togglePopover = (popover: Popover, byKeyboard: boolean) => {
    popoverOpenedByKeyboard.current = byKeyboard;
    setOpenPopover((open) => (open === popover ? null : popover));
  };

  const closePopover = (restoreFocus: boolean) => {
    const open = openPopover;
    setOpenPopover(null);
    if (!restoreFocus || !open) return;
    (open === "appearance" ? appearanceButtonRef : accountButtonRef).current?.focus();
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover(true);
      return;
    }
    trapTabKey(event, event.currentTarget, document.activeElement);
  };

  // Mobiles Sheet als modaler Dialog: Seite dahinter ist inert, Escape schließt
  useEffect(() => {
    const dialog = sheetRef.current;
    if (!dialog) return;
    if (isMenuOpen && !dialog.open) dialog.showModal();
    if (!isMenuOpen && dialog.open) dialog.close();
  }, [isMenuOpen]);

  const closeMenu = (restoreFocus = true) => {
    setIsMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const handleSheetKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    trapTabKey(event, event.currentTarget, document.activeElement);
  };

  return {
    tipsHidden,
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
    sheetRef,
    togglePopover,
    closePopover,
    handlePopoverKeyDown,
    closeMenu,
    handleSheetKeyDown
  };
}

export type HeaderMenus = ReturnType<typeof useHeaderMenus>;
