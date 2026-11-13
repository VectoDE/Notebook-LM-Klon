/**
 * Einstellung „Eigener Endpunkt“ (BYOM, Issue #247).
 *
 * Adresse, Modelle und Schlüssel eines OpenAI-kompatiblen Dienstes (z. B. RelationFlow) speichern
 * und die Verbindung testen. Statusmeldungen laufen über eine Live-Region (WCAG 4.1.3).
 */

import { type FormEvent, useEffect, useState } from "react";
import {
  type CustomEndpointState,
  EndpointApiError,
  deleteCustomEndpoint,
  loadCustomEndpoint,
  saveCustomEndpoint,
  testCustomEndpoint
} from "./custom-endpoint-client.js";
import { type EndpointLanguage, endpointText } from "./custom-endpoint-i18n.js";
import { useTheme } from "./useTheme.jsx";

type Busy = "idle" | "loading" | "saving" | "testing";

export function CustomEndpointSettings() {
  const { language } = useTheme();
  const lang: EndpointLanguage = language === "en" ? "en" : "de";
  const tx = (key: string, vars?: Record<string, string | number>) => endpointText(lang, key, vars);

  const [state, setState] = useState<CustomEndpointState | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<Busy>("loading");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const describe = (err: unknown): string => {
    if (err instanceof EndpointApiError && err.status === 401) return tx("signInNeeded");
    return tx("error", { msg: (err as Error).message });
  };

  const applyState = (next: CustomEndpointState) => {
    setState(next);
    setBaseUrl(next.baseUrl ?? "");
    setChatModel(next.chatModel ?? "");
    setEmbedModel(next.embedModel ?? "");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: einmal beim Öffnen laden
  useEffect(() => {
    let active = true;
    loadCustomEndpoint()
      .then((next) => {
        if (active) applyState(next);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setIsError(true);
        setStatus(describe(err));
      })
      .finally(() => {
        if (active) setBusy("idle");
      });
    return () => {
      active = false;
    };
  }, []);

  const report = (message: string, error: boolean) => {
    setStatus(message);
    setIsError(error);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim() || !chatModel.trim()) {
      report(tx("required"), true);
      return;
    }
    setBusy("saving");
    report(tx("saving"), false);
    try {
      await saveCustomEndpoint({ baseUrl, chatModel, embedModel, apiKey });
      setApiKey("");
      applyState(await loadCustomEndpoint());
      report(tx("saved"), false);
    } catch (err) {
      report(describe(err), true);
    } finally {
      setBusy("idle");
    }
  };

  const onTest = async () => {
    setBusy("testing");
    report(tx("testing"), false);
    try {
      const result = await testCustomEndpoint();
      if (result.ok) {
        report(tx("testOk", { ms: result.latencyMs, n: result.models?.length ?? 0 }), false);
      } else {
        report(tx("testFail", { msg: result.message ?? "" }), true);
      }
    } catch (err) {
      report(describe(err), true);
    } finally {
      setBusy("idle");
    }
  };

  const onRemove = async () => {
    setBusy("saving");
    try {
      await deleteCustomEndpoint();
      setApiKey("");
      applyState(await loadCustomEndpoint());
      report(tx("removed"), false);
    } catch (err) {
      report(describe(err), true);
    } finally {
      setBusy("idle");
    }
  };

  const disabled = busy !== "idle" || state?.enabled === false;

  return (
    <section
      className="rn-drawer-section"
      aria-labelledby="custom-endpoint-title"
      aria-busy={busy !== "idle"}
      data-testid="custom-endpoint-settings"
    >
      <h3 id="custom-endpoint-title" className="rn-drawer-section-title">
        {tx("title")}
      </h3>
      <p className="rn-drawer-text">{tx("intro")}</p>
      {state?.enabled === false && (
        <p className="rn-setting-hint" data-testid="custom-endpoint-disabled">
          {tx("disabled")}
        </p>
      )}
      <form className="rn-form" onSubmit={onSave} noValidate>
        <div className="rn-field">
          <label htmlFor="custom-endpoint-url">{tx("baseUrl")}</label>
          <input
            id="custom-endpoint-url"
            className="rn-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={tx("baseUrlHint")}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={disabled}
            required
          />
        </div>
        <div className="rn-field">
          <label htmlFor="custom-endpoint-chat-model">{tx("chatModel")}</label>
          <input
            id="custom-endpoint-chat-model"
            className="rn-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            disabled={disabled}
            required
          />
        </div>
        <div className="rn-field">
          <label htmlFor="custom-endpoint-embed-model">{tx("embedModel")}</label>
          <input
            id="custom-endpoint-embed-model"
            className="rn-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={embedModel}
            onChange={(e) => setEmbedModel(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="rn-field">
          <label htmlFor="custom-endpoint-key">{tx("apiKey")}</label>
          <input
            id="custom-endpoint-key"
            className="rn-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={disabled}
            aria-describedby="custom-endpoint-key-hint"
          />
          <p id="custom-endpoint-key-hint" className="rn-setting-hint">
            {state?.hasKey ? tx("apiKeyStored") : tx("apiKeyHint")}
          </p>
        </div>
        <div className="rn-endpoint-actions">
          <button type="submit" className="rn-btn rn-btn--primary" disabled={disabled}>
            {tx("save")}
          </button>
          <button
            type="button"
            className="rn-btn rn-btn--secondary"
            onClick={onTest}
            disabled={disabled || !state?.configured}
            data-testid="custom-endpoint-test"
          >
            {tx("test")}
          </button>
          <button
            type="button"
            className="rn-btn rn-btn--ghost"
            onClick={onRemove}
            disabled={disabled || !state?.configured}
          >
            {tx("remove")}
          </button>
        </div>
      </form>
      <p
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
        className={isError ? "rn-field-error" : "rn-setting-hint"}
        data-testid="custom-endpoint-status"
      >
        {busy === "loading" ? tx("loading") : status}
      </p>
    </section>
  );
}
