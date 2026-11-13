/**
 * Lokales Sprachmodell für den Offline-Chat (Issue #346).
 *
 * Gewählt: Qwen2.5-1.5B-Instruct, 4-Bit quantisiert (q4f16_1) für WebLLM (MLC).
 * Begründung und Vergleich: docs/offline-chat.md.
 *
 * Alle Adressen sind auf feste Stände gepinnt (Commit im Hugging-Face-Repo und im
 * Bibliotheks-Repo von MLC), dazu SRI-Hashes für Konfiguration, Tokenizer und WebAssembly.
 * Gewichte liegen nie im Repository; sie kommen erst nach Zustimmung aus dem Netz und
 * bleiben danach im Cache Storage des Browsers.
 */

export const LOCAL_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

/** Anzeigename in der Oberfläche und im KI-Hinweis (EU AI Act Art. 50). */
export const LOCAL_MODEL_LABEL = "Qwen2.5 1.5B (lokal)";

/** Commit von huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC (Stand 07.09.2025). */
export const LOCAL_MODEL_REVISION = "9bd564b064631febf14deadcac492efb761d60c3";

/** Commit von github.com/mlc-ai/binary-mlc-llm-libs mit der WebGPU-Bibliothek für WebLLM 0.2.87. */
export const LOCAL_MODEL_LIB_REVISION = "146ed9cd4b4062e967b017fd2291f7106b50599f";

export const LOCAL_MODEL_URL = `https://huggingface.co/mlc-ai/${LOCAL_MODEL_ID}/resolve/${LOCAL_MODEL_REVISION}/`;

export const LOCAL_MODEL_LIB_URL = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${LOCAL_MODEL_LIB_REVISION}/web-llm-models/v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`;

/**
 * Datenmenge des ersten Downloads in Byte: Gewichte, Tokenizer und Konfiguration
 * (Summe der Dateien im Repo am gepinnten Commit, 880 MB) plus WebAssembly-Bibliothek (6,2 MB).
 */
export const LOCAL_MODEL_DOWNLOAD_BYTES = 886_000_000;

/** Grafikspeicher laut WebLLM-Modellliste (vram_required_MB, Kontext 4096 Token). */
export const LOCAL_MODEL_VRAM_MB = 1630;

/** Kontextfenster in Token; kleiner als im Modell möglich, damit der Grafikspeicher reicht. */
export const LOCAL_MODEL_CONTEXT_TOKENS = 4096;

/** SRI-Hashes (SHA-256), berechnet am 13.11.2026 aus den gepinnten Dateien. */
export const LOCAL_MODEL_INTEGRITY = {
  config: "sha256-faSVQhLT8hqRzD5pPRefYyE/1XNWeWhH9l1/lUeKH54=",
  model_lib: "sha256-FV73NZyFn31kb0xa3FSNd5R12j4xlnAcep1LgoJ1Wag=",
  tokenizer: { "tokenizer.json": "sha256-wDghF+oynN8JcEETL21zWSS2l5JNb2/DlFcT6WzodTk=" },
  onFailure: "error"
} as const;

export { LOCAL_MODEL_STORAGE_KEY } from "./offline-chat-flag.js";

/** Größe in Gigabyte, gerundet auf eine Nachkommastelle, im Zahlenformat der Sprache. */
export function formatGigabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(bytes / 1e9);
}
