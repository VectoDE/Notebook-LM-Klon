import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/components/panels/ChatPanel.js";
import type { OfflineChat } from "@/components/panels/offline-chat-ui.js";
import { chatToMarkdown, triggerBrowserDownload } from "@/lib/export/index.js";
import { readChatId, storeChatId } from "@/preferences/index.js";
import {
  ChatApiError,
  errorKeyForStatus,
  fetchChatHistory,
  mapCitations,
  streamChat,
  technicalErrorDetail
} from "@/services/api/index.js";
import { browserStorage } from "@/theme/index.js";
import type { WorkspaceSource } from "@/types/workspace-types.js";
import { documentLanguage, useTheme } from "./useTheme.js";

export interface WorkspaceChatOptions {
  readonly notebookId: string;
  readonly notebookTitle: string;
  /** Test-Hook: ersetzt fetch fuer den Chat-Client. */
  readonly chatFetch: typeof fetch | undefined;
  readonly sources: readonly WorkspaceSource[];
  /** IDs der ausgewählten, nutzbaren Quellen; der Chat fragt nur diese an. */
  readonly selectedIds: readonly string[];
  readonly activeModel: string;
  readonly offlineChatRef: RefObject<OfflineChat | null>;
  readonly notify: (message: string) => void;
}

/**
 * Chat des Arbeitsbereichs: Nachrichten, gespeicherter Verlauf (Issue #243), Senden per
 * SSE gegen den Server mit Rückfall auf das lokale Modell, Abbruch, Wiederholen und Export.
 */
export function useWorkspaceChat({
  notebookId,
  notebookTitle,
  chatFetch,
  sources,
  selectedIds,
  activeModel,
  offlineChatRef,
  notify
}: WorkspaceChatOptions) {
  const { t, tf, language } = useTheme();
  // Chat Messages
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_intro",
      role: "assistant",
      // Ortsneutral (mobil liegt Studio nicht rechts); Text aus dem Sprachkatalog, siehe chatMessages
      content: t("chatWelcome")
    }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const chatIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string>("");

  // Laufende Anfrage beim Verlassen abbrechen
  useEffect(() => () => abortRef.current?.abort(), []);

  // Gespeicherten Verlauf vollständig laden, Seite für Seite (Issue #243). Ohne Server
  // (Vorschau, Offline) bleibt es still bei der Begrüßung.
  useEffect(() => {
    const storedChatId = readChatId(browserStorage(), notebookId);
    if (!storedChatId) return;
    const controller = new AbortController();
    fetchChatHistory({ chatId: storedChatId, signal: controller.signal, fetchImpl: chatFetch })
      .then((items) => {
        chatIdRef.current = storedChatId;
        const restored: ChatMessage[] = items
          .filter((item) => item.role !== "system")
          .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            citations: mapCitations(item.citations ?? [])
          }));
        if (restored.length > 0) setMessages((prev) => [...prev.slice(0, 1), ...restored]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [notebookId, chatFetch]);

  const updateMessage = useCallback((id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  const handleStopChat = () => {
    abortRef.current?.abort();
  };

  // Chat send message: SSE-Stream gegen /api/v1/notebooks/:id/chat
  const handleSendMessage = async (text: string, options?: { readonly isRetry?: boolean }) => {
    if (abortRef.current) return;
    lastPromptRef.current = text;
    const stamp = Date.now();
    const assistantId = `msg_a_${stamp}`;
    const controller = new AbortController();
    abortRef.current = controller;

    const retryBase = options?.isRetry
      ? (prev: ChatMessage[]) => prev.filter((m) => !m.error)
      : (prev: ChatMessage[]) => [
          ...prev,
          { id: `msg_u_${stamp}`, role: "user" as const, content: text }
        ];
    setMessages((prev) => [
      ...retryBase(prev),
      { id: assistantId, role: "assistant", content: "", isStreaming: true }
    ]);
    setIsGenerating(true);

    const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

    // Ohne Netz oder ohne erreichbaren Server: lokales Modell (Issue #346)
    const answerOffline = async (fallback: boolean) => {
      const local = offlineChatRef.current;
      if (!local) {
        updateMessage(assistantId, (m) => ({ ...m, error: t("errorOfflineNoModel") }));
        return;
      }
      if (fallback) notify(local.text("chatOfflineFallback", language));
      try {
        const result = await local.answer({
          question: text,
          sources,
          language,
          history: messages
            .filter((m) => m.id !== "msg_intro" && !m.error && m.role !== "system")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          signal: controller.signal,
          onStart: (offline) =>
            updateMessage(assistantId, (m) => ({
              ...m,
              content: "",
              error: undefined,
              errorDetail: undefined,
              modelUsed: offline.modelLabel,
              offline
            })),
          onText: (content) => updateMessage(assistantId, (m) => ({ ...m, content }))
        });
        if (result !== "answered") {
          const error = local.errorText(result, language);
          updateMessage(assistantId, (m) => ({ ...m, error, errorDetail: undefined }));
        }
      } catch (err) {
        if (isAbort(err)) updateMessage(assistantId, (m) => ({ ...m, aborted: true }));
        else {
          const error = local.errorText("failed", language);
          updateMessage(assistantId, (m) => ({ ...m, error, errorDetail: undefined }));
        }
      }
    };

    try {
      if (!navigator.onLine) {
        await answerOffline(false);
        return;
      }
      for await (const ev of streamChat({
        notebookId,
        message: text,
        chatId: chatIdRef.current,
        model: activeModel,
        sourceIds: selectedIds,
        // Antworten der KI: Leichte Sprache gilt für die Oberfläche, die Antwort kommt auf Deutsch.
        language: documentLanguage(language),
        signal: controller.signal,
        fetchImpl: chatFetch
      })) {
        if (ev.type === "token") {
          if (ev.chatId && ev.chatId !== chatIdRef.current) {
            chatIdRef.current = ev.chatId;
            storeChatId(browserStorage(), notebookId, ev.chatId);
          }
          updateMessage(assistantId, (m) => ({ ...m, content: m.content + ev.delta }));
        } else if (ev.type === "citations") {
          const citations = mapCitations(ev.citations);
          updateMessage(assistantId, (m) => ({ ...m, citations }));
        } else if (ev.type === "metadata") {
          updateMessage(assistantId, (m) => ({ ...m, modelUsed: ev.metadata.model }));
        } else if (ev.type === "done") {
          if (ev.chatId) chatIdRef.current = ev.chatId;
        } else if (ev.type === "error") {
          updateMessage(assistantId, (m) => ({ ...m, error: ev.message }));
        }
      }
    } catch (err) {
      if (isAbort(err)) {
        updateMessage(assistantId, (m) => ({ ...m, aborted: true }));
      } else if (
        err instanceof ChatApiError &&
        err.status === 0 &&
        offlineChatRef.current?.canAnswer()
      ) {
        await answerOffline(true);
      } else {
        // Klartext mit Handlungshinweis; Statuscode und Servertext nur als Detail (Issue #315)
        const error = t(
          err instanceof ChatApiError ? errorKeyForStatus(err.status) : "errorGeneric"
        );
        const errorDetail =
          err instanceof ChatApiError
            ? `${t("errorTechnical")}: ${technicalErrorDetail(err.status, err.message)}`
            : undefined;
        updateMessage(assistantId, (m) => ({ ...m, error, errorDetail }));
      }
    } finally {
      updateMessage(assistantId, (m) => ({ ...m, isStreaming: false }));
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  // Begrüßung folgt der gewählten Sprache, auch nach einem Wechsel
  const chatMessages = useMemo(
    () => messages.map((m) => (m.id === "msg_intro" ? { ...m, content: t("chatWelcome") } : m)),
    [messages, t]
  );

  // Verlauf mit Zitaten als Markdown sichern (Issue #243)
  const handleExportChat = () => {
    const titles = new Map(sources.map((s) => [s.id, s.title]));
    const markdown = chatToMarkdown(
      chatMessages.filter((m) => m.id !== "msg_intro"),
      {
        title: notebookTitle,
        date: new Date(),
        labels: {
          exportedAt: t("chatExportedAt"),
          user: t("chatUser"),
          assistant: t("chatAssistant"),
          sources: t("chatExportSources"),
          page: t("chatExportPage"),
          aborted: t("chatStatusAborted"),
          aiLabel: t("chatExportAiLabel")
        },
        sourceTitle: (id) => titles.get(id)
      }
    );
    const file = `${notebookTitle}_${t("chatExportFile")}.md`;
    if (triggerBrowserDownload(file, markdown, "text/markdown;charset=utf-8")) {
      notify(tf("toastDownload", { file }));
    }
  };

  const handleRetryChat = () => {
    if (lastPromptRef.current) void handleSendMessage(lastPromptRef.current, { isRetry: true });
  };

  return {
    chatMessages,
    isGenerating,
    handleSendMessage,
    handleStopChat,
    handleRetryChat,
    handleExportChat
  };
}
