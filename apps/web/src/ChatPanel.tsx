import { type FormEvent, useEffect, useRef, useState } from "react";
import type { CitationLocation } from "./workspace-types.js";

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly citations?: readonly CitationLocation[] | undefined;
  readonly isStreaming?: boolean | undefined;
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
  isGenerating = false
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on mount and updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

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
              className="citation-pill"
              data-testid={`citation-pill-${part.num}`}
              aria-label={`Zitat ${part.num} in Quelle anzeigen`}
              onClick={() => onCitationClick?.(citation)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                verticalAlign: "baseline",
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "var(--rn-color-primary, #2563eb)",
                background: "rgba(37, 99, 235, 0.12)",
                border: "1px solid rgba(37, 99, 235, 0.3)",
                borderRadius: "12px",
                padding: "1px 6px",
                margin: "0 3px",
                cursor: "pointer"
              }}
            >
              [{part.num}]
            </button>
          );
        })}
      </>
    );
  };

  return (
    <section
      aria-label="Wissens- und Chat-Panel"
      className="chat-panel"
      data-testid="chat-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        background: "var(--rn-color-background, #f8fafd)",
        color: "var(--rn-color-text-primary, #0f172a)"
      }}
    >
      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 20px 100px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}
      >
        {/* Executive Summary Card */}
        {notebookSummary && (
          <article
            aria-label="Executive Notebook Summary"
            data-testid="executive-summary-card"
            style={{
              padding: "16px 20px",
              borderRadius: "16px",
              background: "var(--rn-color-surface, #ffffff)",
              border: "1px solid var(--rn-color-border, #e2e8f0)",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "8px"
              }}
            >
              <span
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--rn-color-primary, #2563eb)"
                }}
              >
                Executive Summary
              </span>
              <span
                style={{ fontSize: "0.8rem", color: "var(--rn-color-text-secondary, #64748b)" }}
              >
                • {notebookTitle}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "0.95rem",
                lineHeight: 1.6,
                color: "var(--rn-color-text-primary, #1e293b)"
              }}
            >
              {notebookSummary}
            </p>
          </article>
        )}

        {/* Prompt Chips */}
        {promptChips.length > 0 && (
          <div
            aria-label="Vorschlags-Fragen"
            data-testid="prompt-chips-container"
            style={{ display: "flex", flexWrap: "wrap", gap: "8px", margin: "8px 0" }}
          >
            {promptChips.map((chip) => (
              <button
                key={`chip-${chip}`}
                type="button"
                onClick={() => handleChipClick(chip)}
                data-testid={`prompt-chip-${chip}`}
                style={{
                  minHeight: "36px",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  background: "var(--rn-color-surface, #ffffff)",
                  border: "1px solid var(--rn-color-border, #cbd5e1)",
                  color: "var(--rn-color-text-primary, #0f172a)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 150ms ease"
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Chat History */}
        {messages.map((msg) => {
          const isUser = msg.role === "user";

          return (
            <article
              key={msg.id}
              data-testid={`chat-message-${msg.id}`}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "85%",
                borderRadius: "18px",
                padding: "14px 18px",
                background: isUser
                  ? "var(--rn-color-primary, #2563eb)"
                  : "var(--rn-color-surface, #ffffff)",
                color: isUser ? "#ffffff" : "var(--rn-color-text-primary, #0f172a)",
                border: isUser ? "none" : "1px solid var(--rn-color-border, #e2e8f0)",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.04)"
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  marginBottom: "4px",
                  color: isUser
                    ? "rgba(255, 255, 255, 0.8)"
                    : "var(--rn-color-text-secondary, #64748b)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span>{isUser ? "Sie" : "RelationNotes Assistent"}</span>
                {!isUser && (
                  <button
                    type="button"
                    onClick={() => handleReadAloud(msg.content)}
                    data-testid={`btn-read-aloud-${msg.id}`}
                    aria-label="Antwort vorlesen"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      color: "var(--rn-color-primary, #2563eb)",
                      fontWeight: 600,
                      padding: "2px 6px"
                    }}
                  >
                    Vorlesen
                  </button>
                )}
              </div>

              <div
                data-testid={`message-content-${msg.id}`}
                style={{ fontSize: "0.95rem", lineHeight: 1.6 }}
              >
                {renderMessageContent(msg.id, msg.content, msg.citations)}
              </div>

              {msg.isStreaming && (
                <div
                  aria-live="polite"
                  aria-atomic="false"
                  data-testid="streaming-indicator"
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "14px",
                    marginLeft: "4px",
                    background: "var(--rn-color-primary, #2563eb)",
                    verticalAlign: "middle"
                  }}
                />
              )}
            </article>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Floating Pill Input Bar */}
      <footer
        style={{
          position: "absolute",
          bottom: "16px",
          left: "20px",
          right: "20px",
          zIndex: 10
        }}
      >
        <form
          onSubmit={handleSubmit}
          data-testid="floating-pill-input-bar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "var(--rn-color-surface, #ffffff)",
            borderRadius: "32px",
            padding: "6px 8px 6px 18px",
            border: "1px solid var(--rn-color-border, #cbd5e1)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)"
          }}
        >
          {/* Active Model / Auto Router Badge */}
          <span
            data-testid="active-model-badge"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              padding: "4px 8px",
              borderRadius: "12px",
              background: "var(--rn-color-surface-variant, #f1f5f9)",
              color: "var(--rn-color-text-secondary, #64748b)"
            }}
          >
            {activeModel}
          </span>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Frage zu den Quellen stellen oder Thema vertiefen..."
            aria-label="Frage zu den Quellen eingeben"
            disabled={isGenerating}
            data-testid="chat-input-field"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "0.95rem",
              color: "var(--rn-color-text-primary, #0f172a)",
              minHeight: "44px"
            }}
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isGenerating}
            data-testid="btn-send-chat"
            aria-label="Frage absenden"
            style={{
              minWidth: "44px",
              minHeight: "44px",
              borderRadius: "50%",
              border: "none",
              background: "var(--rn-color-primary, #2563eb)",
              color: "#ffffff",
              cursor: inputText.trim() && !isGenerating ? "pointer" : "default",
              opacity: inputText.trim() && !isGenerating ? 1 : 0.4,
              fontWeight: 700,
              fontSize: "1.1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            ➤
          </button>
        </form>
      </footer>
    </section>
  );
}
