/**
 * Bedientexte des Offline-Chats (Issue #346), als Tripel [Schlüssel, Deutsch, Englisch].
 *
 * Eigene Datei und nicht im Hauptkatalog: Nur der nachgeladene Offline-Teil
 * (offline-chat-ui.tsx) braucht sie, so bleiben sie aus dem Start-Bundle. Die wenigen Texte
 * vor dem Nachladen stehen in translations-areas.ts.
 */

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  [
    "chatModeOnline",
    "Online · Antworten vom Server mit geprüften Zitaten",
    "Online · answers from the server with checked citations"
  ],
  [
    "chatModeOfflineLocal",
    "Offline · das lokale Modell antwortet auf diesem Gerät",
    "Offline · the local model answers on this device"
  ],
  [
    "chatModeOfflineNoModel",
    "Offline · kein lokales Modell geladen",
    "Offline · no local model loaded"
  ],
  [
    "chatModeOfflineUnsupported",
    "Offline · ohne WebGPU ist kein lokales Modell möglich",
    "Offline · a local model needs WebGPU"
  ],
  ["chatModeLabel", "Chat-Modus", "Chat mode"],
  ["localModelLoad", "Offline-Modell laden ({size} GB)", "Load offline model ({size} GB)"],
  ["localModelLoading", "Offline-Modell wird geladen", "Loading offline model"],
  ["localModelReady", "Offline-Modell bereit", "Offline model ready"],
  ["localModelCached", "Offline-Modell gespeichert", "Offline model saved"],
  ["localModelRemove", "Offline-Modell entfernen", "Remove offline model"],
  [
    "localModelRemoved",
    "Das Offline-Modell ist von diesem Gerät entfernt.",
    "The offline model has been removed from this device."
  ],
  [
    "localModelRemoveFailed",
    "Das Offline-Modell ließ sich nicht vollständig entfernen. Versuchen Sie es erneut.",
    "The offline model could not be removed completely. Please try again."
  ],
  [
    "localModelUnsupported",
    "Offline-Chat braucht WebGPU, etwa in aktuellem Chrome, Edge oder Safari 26. Dieser Browser bietet es nicht an.",
    "Offline chat needs WebGPU, for example in current Chrome, Edge or Safari 26. This browser does not offer it."
  ],
  ["localConsentTitle", "Offline-Modell laden?", "Load the offline model?"],
  [
    "localConsentIntro",
    "Für den Chat ohne Internet lädt RelationNotes ein Sprachmodell in Ihren Browser: {model}, Lizenz Apache 2.0.",
    "For chatting without internet, RelationNotes loads a language model into your browser: {model}, Apache 2.0 licence."
  ],
  [
    "localConsentDownload",
    "Download: rund {size} GB, einmalig. Danach lädt der Browser das Modell aus seinem Speicher.",
    "Download: about {size} GB, once. After that the browser loads the model from its storage."
  ],
  [
    "localConsentMemory",
    "Grafikspeicher: rund {vram} GB, solange das Modell geladen ist.",
    "Graphics memory: about {vram} GB while the model is loaded."
  ],
  [
    "localConsentPrivacy",
    "Die Dateien kommen von Hugging Face und GitHub. Ihre Fragen und Quellen verlassen das Gerät beim Offline-Chat nicht.",
    "The files come from Hugging Face and GitHub. Your questions and sources stay on the device during offline chat."
  ],
  ["localConsentConfirm", "Jetzt laden", "Load now"],
  ["localConsentCancel", "Abbrechen", "Cancel"],
  [
    "localModelErrorStorage",
    "Zu wenig freier Speicher im Browser für das Offline-Modell.",
    "Not enough free browser storage for the offline model."
  ],
  [
    "localModelErrorLoad",
    "Das Offline-Modell ließ sich nicht laden. Prüfen Sie die Verbindung und versuchen Sie es erneut.",
    "The offline model could not be loaded. Check your connection and try again."
  ],
  [
    "localModelErrorRuntime",
    "Die Laufzeit für das Offline-Modell ließ sich nicht laden. Laden Sie die Seite mit Verbindung neu.",
    "The offline model runtime could not be loaded. Reload the page while online."
  ],
  [
    "chatOfflineNote",
    "Offline-Antwort des lokalen Modells. Zitate lassen sich offline nicht prüfen. Grundlage waren diese Auszüge:",
    "Offline answer from the local model. Citations cannot be checked offline. It was based on these excerpts:"
  ],
  [
    "chatOfflineNoPassages",
    "Offline-Antwort des lokalen Modells ohne Quellenauszüge. Zitate lassen sich offline nicht prüfen.",
    "Offline answer from the local model without source excerpts. Citations cannot be checked offline."
  ],
  ["chatOfflinePassageAria", "Auszug {n} in den Quellen zeigen", "Show excerpt {n} in the sources"],
  [
    "chatOfflineFallback",
    "Server nicht erreichbar, das lokale Modell antwortet.",
    "Server unreachable, the local model is answering."
  ],
  [
    "errorOfflineNoModel",
    "Ohne Verbindung kann nur das lokale Modell antworten, und es ist noch nicht geladen. Laden Sie es, sobald Sie wieder online sind.",
    "Without a connection only the local model can answer, and it is not loaded yet. Load it once you are back online."
  ],
  [
    "errorOfflineUnsupported",
    "Ohne Verbindung ist kein Chat möglich: Dieser Browser unterstützt kein WebGPU für ein lokales Modell.",
    "No chat is possible without a connection: this browser has no WebGPU for a local model."
  ],
  [
    "errorLocalFailed",
    "Das lokale Modell konnte nicht antworten. Versuchen Sie es erneut.",
    "The local model could not answer. Please try again."
  ]
];

function pick(index: 1 | 2): Readonly<Record<string, string>> {
  return Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[index]]));
}

export const OFFLINE_CHAT_DE: Readonly<Record<string, string>> = pick(1);
export const OFFLINE_CHAT_EN: Readonly<Record<string, string>> = pick(2);

/**
 * Katalog zur Sprache: Englisch für en und en-*, sonst Deutsch (wie translations-comments.ts).
 * `own` ist der geladene Katalog der Sprache (etwa Leichte Sprache, de-x-ls); was er für
 * einen Schlüssel enthält, ersetzt den deutschen Text.
 */
export function offlineChatTexts(
  language: string,
  own: Readonly<Record<string, string>> = {}
): Readonly<Record<string, string>> {
  if (isEnglish(language)) return OFFLINE_CHAT_EN;
  const keys = Object.keys(OFFLINE_CHAT_DE).filter((key) => own[key] !== undefined);
  if (keys.length === 0) return OFFLINE_CHAT_DE;
  const merged: Record<string, string> = { ...OFFLINE_CHAT_DE };
  for (const key of keys) merged[key] = own[key] as string;
  return merged;
}

/** Englisch für en und en-*; alle anderen Sprachen nutzen den deutschen Katalog. */
export function isEnglish(language: string): boolean {
  return language === "en" || language.startsWith("en-");
}
