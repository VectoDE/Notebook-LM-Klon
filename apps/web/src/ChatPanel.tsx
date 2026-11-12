import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import type { CitationLocation } from "./workspace-types.js";

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly citations?: readonly CitationLocation[] | undefined;
  readonly isStreaming?: boolean | undefined;
  /** Fehlertext, falls die Antwort fehlgeschlagen ist. */
  readonly error?: string | undefined;
  /** True, wenn der Nutzer die Antwort abgebrochen hat. */
  readonly aborted?: boolean | undefined;
  /** Modell, das die Antwort erzeugt hat (EU AI Act Art. 50). */
  readonly modelUsed?: string | undefined;
}

export interface ChatPanelProps {
  readonly notebookTitle?: string | undefined;
  readonly notebookSummary?: string | undefined;
  readonly promptChips?: readonly string[] | undefined;
  readonly messages: readonly ChatMessage[];
  readonly activeModel?: string | undefined;
  readonly onSendMessage?: ((message: string) => void | Promise<void>) | undefined;
  readonly onCitationClick?: ((citation: CitationLocation) => void) | undefined;
  readonly onReadAloud?: ((text: string) => void) | undefined;
  readonly onStop?: (() => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly isGenerating?: boolean | undefined;
}

export function ChatPanel({
  notebookTitle = "RelationNotes Studio",
  notebookSummary,
  promptChips = [
    "Fasse die wichtigsten Erkenntnisse zusammen",
    "Welche Kernarchitektur wird verwendet?",
    "Welche Sicherheitsgarantien bestehen?"
  ],
  messages,
  activeModel = "gemini-2.5-flash",
  onSendMessage,
  onCitationClick,
  onReadAloud,
  onStop,
  onRetry,
  isGenerating = false
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on mount and updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  });

  // Fokus zurueck ins Eingabefeld, sobald die Generierung endet (Tastaturbedienung)
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) inputRef.current?.focus();
    wasGenerating.current = isGenerating;
  }, [isGenerating]);

  const lastMessage = messages[messages.length - 1];
  let statusText = "";
  if (isGenerating) statusText = "Antwort wird generiert.";
  else if (lastMessage?.error) statusText = `Fehler: ${lastMessage.error}`;
  else if (lastMessage?.aborted) statusText = "Generierung abgebrochen.";
  else if (lastMessage?.role === "assistant" && messages.length > 1)
    statusText = "Antwort vollständig.";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isGenerating) return;
    onSendMessage?.(inputText.trim());
    setInputText("");
  };

  const handleChipClick = (prompt: string) => {
    if (isGenerating) return;
    onSendMessage?.(prompt);
  };

  // Web Speech API Read Aloud
  const handleReadAloud = (text: string) => {
    if (onReadAloud) {
      onReadAloud(text);
      return;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (isReadingAloud) {
        window.speechSynthesis.cancel();
        setIsReadingAloud(false);
        return;
      }

      window.speechSynthesis.cancel();
      const cleanText = text.replace(/\[\d+\]/g, "");
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "de-DE";
      utterance.onend = () => setIsReadingAloud(false);
      utterance.onerror = () => setIsReadingAloud(false);
      setIsReadingAloud(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Helper to render text with clickable citation pills like [1], [2]
  const renderMessageContent = (
    messageId: string,
    content: string,
    citations?: readonly CitationLocation[]
  ) => {
    const citationRegex = /\[(\d+)\]/g;
    const parts: (string | { num: number; index: number })[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while (true) {
      match = citationRegex.exec(content);
      if (!match) break;

      const numStr = match[1];
      if (numStr) {
        const num = Number.parseInt(numStr, 10);
        if (match.index > lastIndex) {
          parts.push(content.slice(lastIndex, match.index));
        }
        parts.push({ num, index: match.index });
        lastIndex = match.index + match[0].length;
      }
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return (
      <>
        {parts.map((part) => {
          if (typeof part === "string") {
            return <span key={`${messageId}-txt-${part.slice(0, 10)}`}>{part}</span>;
          }

          // Find citation metadata
          const citation = citations?.[part.num - 1] ?? {
            sourceId: `src_${part.num}`,
            quote: `Zitat [${part.num}]`
          };

          return (
            <button
              key={`${messageId}-pill-${part.num}`}
              type="button"
              className="citation-pill rn-cite"
              data-testid={`citation-pill-${part.num}`}
              aria-label={`Zitat ${part.num} in Quelle anzeigen`}
              onClick={() => onCitationClick?.(citation)}
            >
              {part.num}
            </button>
          );
        })}
      </>
    );
  };

  const canSend = inputText.trim().length > 0 && !isGenerating;

  return (
    <section aria-label="Wissens- und Chat-Panel" className="chat-panel" data-testid="chat-panel">
      {/* Statusmeldungen fuer Screenreader (nicht pro Token, sondern pro Zustand) */}
      <output
        aria-live="polite"
        aria-atomic="true"
        data-testid="chat-status-live"
        className="rn-visually-hidden"
      >
        {statusText}
      </output>

      {/* Verlauf */}
      <div role="log" aria-label="Chat-Verlauf" aria-busy={isGenerating} className="chat-log">
        <div className="chat-column">
          {/* Zusammenfassung des Notebooks */}
          {notebookSummary && (
            <article
              aria-label="Executive Notebook Summary"
              data-testid="executive-summary-card"
              className="rn-summary"
            >
              <p className="rn-eyebrow">Executive Summary</p>
              <h2 className="rn-summary-title">{notebookTitle}</h2>
              <p className="rn-summary-text">{notebookSummary}</p>
            </article>
          )}

          {/* Vorschlagsfragen */}
          {promptChips.length > 0 && (
            <div
              aria-label="Vorschlags-Fragen"
              data-testid="prompt-chips-container"
              className="rn-chips"
            >
              {promptChips.map((chip) => (
                <button
                  key={`chip-${chip}`}
                  type="button"
                  onClick={() => handleChipClick(chip)}
                  data-testid={`prompt-chip-${chip}`}
                  className="rn-chip"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Nachrichten */}
          {messages.map((msg) => {
            const isUser = msg.role === "user";

            return (
              <article
                key={msg.id}
                data-testid={`chat-message-${msg.id}`}
                className={`rn-msg ${isUser ? "rn-msg--user" : "rn-msg--assistant"}`}
              >
                <div className="rn-msg-meta">
                  {isUser ? (
                    <span className="rn-msg-author">Sie</span>
                  ) : (
                    <>
                      <span className="rn-msg-author">
                        <span className="rn-avatar" aria-hidden="true" />
                        RelationNotes Assistent
                      </span>
                      <button
                        type="button"
                        onClick={() => handleReadAloud(msg.content)}
                        data-testid={`btn-read-aloud-${msg.id}`}
                        aria-label="Antwort vorlesen"
                        className="rn-btn rn-btn--ghost rn-btn--compact"
                      >
                        <Icon name="speaker" size={18} />
                        Vorlesen
                      </button>
                    </>
                  )}
                </div>

                <div data-testid={`message-content-${msg.id}`} className="rn-msg-body">
                  {msg.isStreaming && msg.content.length === 0
                    ? "Antwort wird erstellt …"
                    : renderMessageContent(msg.id, msg.content, msg.citations)}
                  {msg.isStreaming && (
                    <span
                      aria-live="polite"
                      aria-atomic="false"
                      data-testid="streaming-indicator"
                      className="rn-caret"
                    />
                  )}
                </div>

                {msg.error && (
                  <div role="alert" data-testid={`chat-error-${msg.id}`} className="rn-msg-error">
                    <span>{msg.error}</span>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        disabled={isGenerating}
                        data-testid="btn-retry-chat"
                        className="rn-btn rn-btn--danger rn-btn--compact"
                      >
                        Erneut versuchen
                      </button>
                    )}
                  </div>
                )}

                {msg.aborted && (
                  <p data-testid={`chat-aborted-${msg.id}`} className="rn-msg-note">
                    Generierung abgebrochen.
                  </p>
                )}

                {!isUser && msg.modelUsed && !msg.isStreaming && (
                  <p data-testid={`ai-label-${msg.id}`} className="rn-msg-note">
                    KI-generiert · {msg.modelUsed}
                  </p>
                )}
              </article>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Eingabe: liegt unter dem Verlauf, verdeckt nichts */}
      <footer className="chat-dock">
        <form onSubmit={handleSubmit} data-testid="floating-pill-input-bar" className="rn-composer">
          <span data-testid="active-model-badge" className="rn-model-badge">
            <span className="rn-model-dot" aria-hidden="true" />
            {activeModel}
          </span>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && isGenerating) onStop?.();
            }}
            placeholder="Frage zu den Quellen stellen …"
            aria-label="Frage zu den Quellen eingeben"
            readOnly={isGenerating}
            aria-busy={isGenerating}
            data-testid="chat-input-field"
            className="rn-composer-input"
          />

          {isGenerating && onStop ? (
            <button
              type="button"
              onClick={onStop}
              data-testid="btn-stop-chat"
              aria-label="Generierung stoppen"
              className="rn-send rn-send--stop"
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              data-testid="btn-send-chat"
              aria-label="Frage absenden"
              className="rn-send"
            >
              <Icon name="send" />
            </button>
          )}
        </form>
      </footer>
    </section>
  );
}
