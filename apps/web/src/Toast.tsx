import { type FocusEvent, useEffect, useRef } from "react";
import { Icon } from "./Icon.js";
import { TOAST_DURATION_MS, type ToastTimer, createToastTimer } from "./toast-timer.js";
import { useTheme } from "./useTheme.js";

export interface ToastMessage {
  /** Neue id je Hinweis: derselbe Text erscheint erneut und die Zeit beginnt von vorn. */
  readonly id: number;
  readonly message: string;
}

export interface ToastProps {
  readonly toast: ToastMessage | null;
  readonly onDismiss: () => void;
  readonly duration?: number | undefined;
}

/**
 * Hinweis-Leiste unten (Issue #329). Der Bereich (output, Rolle status) steht immer im DOM,
 * damit Screenreader neue Hinweise ansagen, ohne den Fokus zu bewegen. Nach rund 5 s
 * verschwindet die Leiste; Zeiger oder Fokus darauf halten die Zeit an (WCAG 2.2.1).
 */
export function Toast({ toast, onDismiss, duration = TOAST_DURATION_MS }: ToastProps) {
  const { t } = useTheme();
  const timerRef = useRef<ToastTimer | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const toastId = toast?.id;

  useEffect(() => {
    if (toastId === undefined) return;
    hovered.current = false;
    focused.current = false;
    const timer = createToastTimer(
      () => dismissRef.current(),
      {
        now: () => performance.now(),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number)
      },
      duration
    );
    timerRef.current = timer;
    return () => {
      timer.dispose();
      timerRef.current = null;
    };
  }, [toastId, duration]);

  const hold = (flag: { current: boolean }, value: boolean) => {
    if (flag.current === value) return;
    flag.current = value;
    if (value) timerRef.current?.pause();
    else timerRef.current?.resume();
  };

  const handleFocus = (event: FocusEvent<HTMLSpanElement>) => {
    if (!focused.current && event.relatedTarget instanceof HTMLElement) {
      returnFocusRef.current = event.relatedTarget;
    }
    hold(focused, true);
  };

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    hold(focused, false);
  };

  const close = () => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    onDismiss();
    // Der Knopf verschwindet: Fokus zurück dorthin, wo er vorher war
    if (focused.current && target?.isConnected) target.focus();
    focused.current = false;
  };

  return (
    <output className="rn-toast-region" data-testid="toast-region">
      {toast && (
        <span
          key={toast.id}
          className="rn-toast"
          data-testid="toast"
          onPointerEnter={() => hold(hovered, true)}
          onPointerLeave={() => hold(hovered, false)}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
          <span className="rn-toast-text" data-testid="toast-text">
            {toast.message}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label={t("toastClose")}
            data-testid="btn-close-toast"
            className="rn-toast-close"
          >
            <Icon name="close" size={18} />
          </button>
        </span>
      )}
    </output>
  );
}
