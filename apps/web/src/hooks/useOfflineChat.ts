import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { OfflineChat } from "@/components/panels/offline-chat-ui.js";
import { hasLocalModelFlag } from "@/services/llm/index.js";
import { browserStorage } from "@/theme/index.js";

export interface OfflineChatState {
  readonly offlineChat: OfflineChat | null;
  readonly offlineChatRef: RefObject<OfflineChat | null>;
  readonly online: boolean;
  readonly loadOfflineChat: () => void;
}

/**
 * Offline-Chat mit lokalem Modell (Issue #346): der Teil kommt erst beim Einrichten oder,
 * nach früherer Zustimmung, gleich beim Start; nichts davon im Start-Bundle. Dazu der
 * Online-Status des Browsers.
 */
export function useOfflineChat(): OfflineChatState {
  const [offlineChat, setOfflineChat] = useState<OfflineChat | null>(null);
  const offlineChatRef = useRef<OfflineChat | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const loadOfflineChat = useCallback(() => {
    if (offlineChatRef.current) return;
    void import("@/components/panels/offline-chat-ui.js")
      .then((module) => {
        offlineChatRef.current ??= module.createOfflineChat();
        setOfflineChat(offlineChatRef.current);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (hasLocalModelFlag(browserStorage())) loadOfflineChat();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [loadOfflineChat]);
  return { offlineChat, offlineChatRef, online, loadOfflineChat };
}
