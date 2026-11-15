import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type ChatMessage, ChatPanel } from "../ChatPanel.js";

const TEST_MESSAGES: ChatMessage[] = [
  {
    id: "m_1",
    role: "user",
    content: "Was ist Durable Objects Hibernation?"
  },
  {
    id: "m_2",
    role: "assistant",
    content: "Durable Objects Hibernation entlädt inaktive WebSockets aus dem RAM [1].",
    citations: [
      {
        sourceId: "src_1",
        quote: "entlädt inaktive WebSockets",
        page: 3
      }
    ]
  }
];

describe("ChatPanel Component (Sub-Issue #132)", () => {
  it("renders executive summary, prompt chips and chat message history", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        notebookTitle: "Cloudflare Stack",
        notebookSummary: "Executive Summary: Single Worker Edge Cluster.",
        promptChips: ["Was sind Durable Objects?", "Wie funktioniert D1?"],
        messages: TEST_MESSAGES,
        activeModel: "gemini-2.5-flash"
      })
    );

    expect(html).toContain('aria-label="Wissens- und Chat-Panel"');
    expect(html).toContain("executive-summary-card");
    expect(html).toContain("Executive Summary: Single Worker Edge Cluster.");
    expect(html).toContain("prompt-chips-container");
    expect(html).toContain("Was sind Durable Objects?");
    expect(html).toContain("Wie funktioniert D1?");
    expect(html).toContain("Durable Objects Hibernation");
    expect(html).toContain("floating-pill-input-bar");
    expect(html).toContain("gemini-2.5-flash");
    expect(html).toContain("citation-pill-1");
  });

  it("renders streaming delta indicator when a message has isStreaming=true", () => {
    const streamingMessages: ChatMessage[] = [
      {
        id: "m_stream",
        role: "assistant",
        content: "Streaming response token...",
        isStreaming: true
      }
    ];

    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: streamingMessages
      })
    );

    expect(html).toContain("streaming-indicator");
    expect(html).toContain('aria-live="polite"');
  });

  it("renders multiple citations within brackets and standalone text", () => {
    const multiCitationMessages: ChatMessage[] = [
      {
        id: "m_multi",
        role: "assistant",
        content: "Hier ist Zitat Eins [1] und Zitat Zwei [2] im Text.",
        citations: [
          { sourceId: "src_1", quote: "Eins" },
          { sourceId: "src_2", quote: "Zwei" }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: multiCitationMessages
      })
    );

    expect(html).toContain("citation-pill-1");
    expect(html).toContain("citation-pill-2");
  });

  it("zeigt Fehler mit role=alert und Retry-Button", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          { id: "m_err", role: "assistant", content: "", error: "Server nicht erreichbar" }
        ],
        onRetry: () => undefined
      })
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Server nicht erreichbar");
    expect(html).toContain("btn-retry-chat");
    expect(html).toContain("Fehler: Server nicht erreichbar");
  });

  it("zeigt Stop-Button und Lade-Status waehrend der Generierung", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ id: "m_s", role: "assistant", content: "", isStreaming: true }],
        isGenerating: true,
        onStop: () => undefined
      })
    );
    expect(html).toContain("btn-stop-chat");
    expect(html).not.toContain("btn-send-chat");
    expect(html).toContain("Antwort wird generiert.");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="log"');
  });

  it("markiert abgebrochene Antworten und zeigt KI-Kennzeichnung", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          { id: "m_a", role: "assistant", content: "Teil", aborted: true },
          { id: "m_b", role: "assistant", content: "Fertig [1]", modelUsed: "gemini-2.5-flash" }
        ]
      })
    );
    expect(html).toContain("chat-aborted-m_a");
    expect(html).toContain("KI-generiert");
    expect(html).toContain("citation-pill-1");
  });

  it("bietet den Markdown-Export erst an, wenn es eine Frage gibt (Issue #243)", () => {
    const onExport = () => undefined;
    const withoutQuestion = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ id: "m_i", role: "assistant", content: "Willkommen" }],
        onExport
      })
    );
    expect(withoutQuestion).not.toContain("btn-export-chat-md");

    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          { id: "m_u", role: "user", content: "Frage" },
          { id: "m_r", role: "assistant", content: "Antwort [1]" }
        ],
        onExport
      })
    );
    expect(html).toContain('data-testid="btn-export-chat-md"');
    // Label in Name (WCAG 2.5.3): der sichtbare Text steht am Anfang des Namens
    expect(html).toContain('aria-label="Als Markdown sichern: Chatverlauf');
    expect(html).toContain(">Als Markdown sichern</button>");

    const busy = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ id: "m_u", role: "user", content: "Frage" }],
        onExport,
        isGenerating: true
      })
    );
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*data-testid="btn-export-chat-md"/);
  });
});
