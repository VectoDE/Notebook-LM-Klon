import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { trapTabKey } from "./focus-trap.js";
import { fill } from "./i18n.js";
import { LazyCommentThread } from "./lazy-viewers.js";
import {
  LOCAL_MODEL_DOWNLOAD_BYTES,
  LOCAL_MODEL_LABEL,
  LOCAL_MODEL_VRAM_MB,
  formatGigabytes
} from "./local-llm-config.js";
import {
  LocalModelController,
  type LocalModelEnv,
  type LocalModelState,
  type LocalRuntimeLoader
} from "./local-llm.js";
import {
  type ChatMode,
  type OfflineAnswerRequest,
  type OfflineAnswerResult,
  answerOffline,
  chatModeFor,
  localRouteFor,
  offlineErrorText
} from "./offline-chat.js";
import { browserStorage } from "./theme-preferences.js";
import { offlineChatTexts } from "./translations-offline-chat.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { LOCALES, useTheme } from "./useTheme.js";

/**
 * Nachgeladener Teil des Offline-Chats (Issue #346). Das Start-Bundle enthält nur einen
 * Knopf und den Merker; dieser Chunk kommt beim Einrichten oder, nach früherer Zustimmung,
 * gleich beim Start. Die WebLLM-Laufzeit selbst ist ein weiterer, eigener Chunk.
 */

/** Lädt die WebLLM-Anbindung erst bei Bedarf. */
export const loadWebLlmRuntime: LocalRuntimeLoader = () =>
  import("./local-llm-webllm.js").then((module) => module.default);

function browserEnv(): LocalModelEnv {
  const nav = navigator as Navigator & { gpu?: LocalModelEnv["gpu"] };
  return { gpu: nav.gpu, storage: nav.storage, localStorage: browserStorage() };
}

const MODE_KEYS: Record<ChatMode, string> = {
  online: "chatModeOnline",
  "offline-local": "chatModeOfflineLocal",
  "offline-no-model": "chatModeOfflineNoModel",
  "offline-unsupported": "chatModeOfflineUnsupported"
};

const ERROR_KEYS = {
  storage: "localModelErrorStorage",
  load: "localModelErrorLoad",
  runtime: "localModelErrorRuntime"
} as const;

function useOfflineText() {
  const { language } = useTheme();
  const texts = offlineChatTexts(language, LOCALES.texts(language));
  const t = (key: string): string => texts[key] ?? key;
  const tf = (key: string, vars: Readonly<Record<string, string | number>>) => fill(t(key), vars);
  return { t, tf, language };
}

function useModelState(controller: LocalModelController): LocalModelState {
  const [state, setState] = useState(() => controller.getState());
  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}

export interface OfflineChatControlProps {
  readonly online: boolean;
  readonly onNotify: (message: string) => void;
}

export interface OfflineChat {
  readonly controller: LocalModelController;
  /** Kann jetzt ohne Netz und ohne Download geantwortet werden? */
  readonly canAnswer: () => boolean;
  readonly answer: (request: OfflineAnswerRequest) => Promise<OfflineAnswerResult>;
  readonly text: (key: string, language: string) => string;
  readonly errorText: typeof offlineErrorText;
  readonly Control: (props: OfflineChatControlProps) => ReactNode;
}

export function createOfflineChat(loader: LocalRuntimeLoader = loadWebLlmRuntime): OfflineChat {
  const controller = new LocalModelController(browserEnv(), loader);
  void controller.init();

  /**
   * Modus-Anzeige und Steuerung unter dem Eingabefeld. Der Modus steht in einem <output>
   * (Rolle status, aria-live polite). Das Modell lädt erst nach Zustimmung im Dialog, der
   * Größe und Speicherbedarf vorher nennt.
   */
  function Control({ online, onNotify }: OfflineChatControlProps) {
    const { t, tf, language } = useOfflineText();
    const state = useModelState(controller);
    const [consentOpen, setConsentOpen] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const descId = useId();
    const size = formatGigabytes(LOCAL_MODEL_DOWNLOAD_BYTES, language);
    const vram = formatGigabytes(LOCAL_MODEL_VRAM_MB * 1_048_576, language);
    const mode = chatModeFor(online, state);

    // Offline-fähig: Teile, die erst beim Öffnen einer Quelle nachgeladen werden, jetzt holen,
    // sonst scheitert ohne Netz der Sprung aus einer Offline-Antwort in die Quelle
    const offlineCapable = localRouteFor(state) === "local";
    useEffect(() => {
      if (offlineCapable) void LazyCommentThread.preload().catch(() => undefined);
    }, [offlineCapable]);

    useReturnFocus(consentOpen);
    useEffect(() => {
      const dialog = dialogRef.current;
      if (consentOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
        confirmRef.current?.focus();
      }
    }, [consentOpen]);

    const percent = state.kind === "loading" ? Math.round(state.progress * 100) : 0;
    const remove = () =>
      void controller
        .remove()
        .then(() => onNotify(t("localModelRemoved")))
        .catch(() => onNotify(t("localModelRemoveFailed")));

    return (
      <div className="rn-offline-chat" data-testid="offline-chat-control">
        <output
          className="rn-chat-mode"
          data-testid="chat-mode"
          data-mode={mode}
          aria-label={t("chatModeLabel")}
        >
          <span className="rn-chat-mode-dot" aria-hidden="true" />
          {t(MODE_KEYS[mode])}
        </output>

        {state.kind === "unsupported" && (
          <p className="rn-offline-hint" data-testid="local-model-unsupported">
            {t("localModelUnsupported")}
          </p>
        )}

        {(state.kind === "absent" || state.kind === "error") && (
          <button
            type="button"
            className="rn-btn rn-btn--ghost rn-btn--compact"
            data-testid="btn-local-model-load"
            disabled={!online}
            onClick={() => setConsentOpen(true)}
          >
            {tf("localModelLoad", { size })}
          </button>
        )}

        {state.kind === "error" && (
          <p className="rn-offline-hint" role="alert" data-testid="local-model-error">
            {t(ERROR_KEYS[state.reason])}
          </p>
        )}

        {state.kind === "loading" && (
          <span className="rn-offline-progress" data-testid="local-model-progress">
            <label>
              {t("localModelLoading")}
              <progress max={100} value={percent} />
            </label>
            <span aria-hidden="true">{percent} %</span>
          </span>
        )}

        {(state.kind === "ready" || state.kind === "cached") && (
          <span className="rn-offline-ready">
            <span data-testid="local-model-ready">
              {t(state.kind === "ready" ? "localModelReady" : "localModelCached")}
            </span>
            <button
              type="button"
              className="rn-btn rn-btn--ghost rn-btn--compact"
              data-testid="btn-local-model-remove"
              onClick={remove}
            >
              {t("localModelRemove")}
            </button>
          </span>
        )}

        {consentOpen && (
          <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            aria-describedby={descId}
            data-testid="local-model-consent"
            className="rn-dialog"
            onCancel={(event) => {
              event.preventDefault();
              setConsentOpen(false);
            }}
            onKeyDown={(event) => {
              if (dialogRef.current) trapTabKey(event, dialogRef.current, document.activeElement);
            }}
          >
            <div className="rn-dialog-card rn-consent-card">
              <h2 id={titleId} className="rn-consent-title">
                {t("localConsentTitle")}
              </h2>
              <div id={descId}>
                <p>{tf("localConsentIntro", { model: LOCAL_MODEL_LABEL })}</p>
                <ul className="rn-consent-list">
                  <li data-testid="local-consent-size">{tf("localConsentDownload", { size })}</li>
                  <li>{tf("localConsentMemory", { vram })}</li>
                  <li>{t("localConsentPrivacy")}</li>
                </ul>
              </div>
              <div className="rn-consent-actions">
                <button
                  type="button"
                  className="rn-btn rn-btn--ghost"
                  data-testid="btn-local-consent-cancel"
                  onClick={() => setConsentOpen(false)}
                >
                  {t("localConsentCancel")}
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  className="rn-btn rn-btn--primary"
                  data-testid="btn-local-consent-confirm"
                  onClick={() => {
                    setConsentOpen(false);
                    void controller.load({ consented: true });
                  }}
                >
                  {t("localConsentConfirm")}
                </button>
              </div>
            </div>
          </dialog>
        )}
      </div>
    );
  }

  return {
    controller,
    canAnswer: () => localRouteFor(controller.getState()) === "local",
    answer: (request) =>
      answerOffline(controller, { ...request, own: LOCALES.texts(request.language) }),
    text: (key, language) => offlineChatTexts(language, LOCALES.texts(language))[key] ?? key,
    errorText: (reason, language) => offlineErrorText(reason, language, LOCALES.texts(language)),
    Control
  };
}
