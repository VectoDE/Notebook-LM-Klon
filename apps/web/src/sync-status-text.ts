import type { SyncStatus } from "./offline-sync.js";

type Translate = (key: string, vars: Readonly<Record<string, string | number>>) => string;

/**
 * Sichtbarer und angesagter Text zum Synchronisationsstand (Issue #347), DE/EN über die
 * Übersetzungsschlüssel. Die Zahl wartender Änderungen steht immer dabei, wenn es welche gibt.
 */
export function describeSyncStatus(status: SyncStatus, tf: Translate): string {
  const n = status.pending;
  const plural = (one: string, many: string) => tf(n === 1 ? one : many, { n });
  switch (status.state) {
    case "syncing":
      return tf("syncSyncing", {});
    case "synced":
      return tf("syncSynced", {});
    case "pending":
      return plural("syncPendingOne", "syncPendingMany");
    case "offline":
      return n === 0 ? tf("syncOfflineNone", {}) : plural("syncOfflineOne", "syncOfflineMany");
    case "error":
      return n === 0 ? tf("syncErrorNone", {}) : plural("syncErrorOne", "syncErrorMany");
  }
}
