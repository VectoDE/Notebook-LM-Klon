import { LOCAL_MODEL_DOWNLOAD_BYTES, LOCAL_MODEL_STORAGE_KEY } from "./local-llm-config.js";
import { hasLocalModelFlag } from "./offline-chat-flag.js";

/**
 * Steuerung des lokalen Sprachmodells (Issue #346): WebGPU-Prüfung, Zustimmung, Laden mit
 * Fortschritt, Wiederverwendung aus dem Cache, Antworten im Stream, Entfernen.
 *
 * Die Laufzeit (WebLLM) steckt in local-llm-webllm.ts und wird nur per import() geladen,
 * damit sie nie im Start-Bundle landet. Tests reichen eine eigene Laufzeit herein.
 */

export interface LocalChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LocalLoadProgress {
  /** Anteil 0 bis 1. */
  readonly progress: number;
  readonly text: string;
}

export interface LocalEngine {
  stream(messages: readonly LocalChatMessage[], signal?: AbortSignal): AsyncIterable<string>;
  unload(): Promise<void>;
}

export interface LocalRuntime {
  isModelCached(): Promise<boolean>;
  createEngine(onProgress: (report: LocalLoadProgress) => void): Promise<LocalEngine>;
  deleteModel(): Promise<void>;
}

export type LocalRuntimeLoader = () => Promise<LocalRuntime>;

export type LocalModelState =
  | { readonly kind: "checking" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "absent" }
  | { readonly kind: "cached" }
  | { readonly kind: "loading"; readonly progress: number }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly reason: LocalModelError };

export type LocalModelError = "storage" | "load" | "runtime";

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

export interface LocalModelEnv {
  readonly gpu?: GpuLike | undefined;
  readonly storage?:
    | {
        estimate?: (() => Promise<{ quota?: number; usage?: number }>) | undefined;
        persist?: (() => Promise<boolean>) | undefined;
      }
    | undefined;
  readonly localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
}

/** WebGPU vorhanden und ein Adapter erreichbar? Ohne Adapter (z. B. gesperrte GPU) gilt: nein. */
export async function hasWebGpu(gpu: GpuLike | undefined): Promise<boolean> {
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** Reicht der freie Speicher für den Download? Ohne Schätzung lässt der Browser es entscheiden. */
export async function hasRoomFor(
  storage: LocalModelEnv["storage"],
  bytes: number
): Promise<boolean> {
  if (!storage?.estimate) return true;
  try {
    const { quota, usage = 0 } = await storage.estimate();
    if (typeof quota !== "number") return true;
    return quota - usage >= bytes;
  } catch {
    return true;
  }
}

function readFlag(env: LocalModelEnv): boolean {
  return hasLocalModelFlag(env.localStorage);
}

function writeFlag(env: LocalModelEnv, on: boolean): void {
  try {
    if (on) env.localStorage?.setItem(LOCAL_MODEL_STORAGE_KEY, "1");
    else env.localStorage?.removeItem(LOCAL_MODEL_STORAGE_KEY);
  } catch {
    // Ohne localStorage fragt die Seite beim nächsten Besuch erneut; kein Datenverlust.
  }
}

export class LocalModelController {
  private state: LocalModelState = { kind: "checking" };
  private readonly listeners = new Set<(state: LocalModelState) => void>();
  private runtime: LocalRuntime | null = null;
  private engine: LocalEngine | null = null;
  private pendingEngine: Promise<LocalEngine> | null = null;

  constructor(
    private readonly env: LocalModelEnv,
    private readonly loadRuntime: LocalRuntimeLoader
  ) {}

  getState(): LocalModelState {
    return this.state;
  }

  subscribe(listener: (state: LocalModelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: LocalModelState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private async getRuntime(): Promise<LocalRuntime> {
    this.runtime ??= await this.loadRuntime();
    return this.runtime;
  }

  /**
   * Erste Prüfung. Die Laufzeit wird nur geholt, wenn der Nutzer früher schon zugestimmt hat;
   * dann liegt der Code danach im HTTP-Cache und steht auch ohne Netz bereit.
   */
  async init(): Promise<LocalModelState> {
    if (!(await hasWebGpu(this.env.gpu))) {
      this.set({ kind: "unsupported" });
      return this.state;
    }
    if (!readFlag(this.env)) {
      this.set({ kind: "absent" });
      return this.state;
    }
    try {
      const cached = await (await this.getRuntime()).isModelCached();
      if (!cached) writeFlag(this.env, false);
      this.set({ kind: cached ? "cached" : "absent" });
    } catch {
      this.set({ kind: "absent" });
    }
    return this.state;
  }

  /**
   * Lädt das Modell. Nur mit ausdrücklicher Zustimmung (consented: true), die die Oberfläche
   * nach Anzeige von Größe und Speicherbedarf einholt. Aus dem Cache geht es ohne Download.
   */
  async load(options: { readonly consented: boolean }): Promise<LocalEngine | null> {
    if (!options.consented) throw new Error("Zustimmung fehlt");
    if (this.engine) return this.engine;
    if (this.state.kind === "unsupported") return null;
    if (
      this.state.kind !== "cached" &&
      !(await hasRoomFor(this.env.storage, LOCAL_MODEL_DOWNLOAD_BYTES))
    ) {
      this.set({ kind: "error", reason: "storage" });
      return null;
    }
    this.pendingEngine ??= this.startEngine();
    try {
      return await this.pendingEngine;
    } catch {
      return null;
    } finally {
      this.pendingEngine = null;
    }
  }

  private async startEngine(): Promise<LocalEngine> {
    this.set({ kind: "loading", progress: 0 });
    let runtime: LocalRuntime;
    try {
      runtime = await this.getRuntime();
    } catch (err) {
      this.set({ kind: "error", reason: "runtime" });
      throw err;
    }
    try {
      // Bitte um dauerhaften Speicher, damit der Browser die Gewichte nicht stillschweigend räumt
      await this.env.storage?.persist?.().catch(() => false);
      const engine = await runtime.createEngine((report) =>
        this.set({ kind: "loading", progress: Math.max(0, Math.min(1, report.progress)) })
      );
      this.engine = engine;
      writeFlag(this.env, true);
      this.set({ kind: "ready" });
      return engine;
    } catch (err) {
      this.set({ kind: "error", reason: "load" });
      throw err;
    }
  }

  /** Antwort im Stream. Lädt ein bereits gespeichertes Modell bei Bedarf aus dem Cache. */
  async *stream(
    messages: readonly LocalChatMessage[],
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    // Nie stillschweigend herunterladen: ohne geladenes oder gespeichertes Modell kein Start
    const engine =
      this.engine ?? (this.state.kind === "cached" ? await this.load({ consented: true }) : null);
    if (!engine) throw new Error("Lokales Modell nicht verfügbar");
    yield* engine.stream(messages, signal);
  }

  /** Modell aus dem Speicher und aus dem Browser-Cache entfernen. */
  async remove(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    await engine?.unload().catch(() => undefined);
    try {
      await (await this.getRuntime()).deleteModel();
    } finally {
      writeFlag(this.env, false);
      this.set({ kind: (await hasWebGpu(this.env.gpu)) ? "absent" : "unsupported" });
    }
  }

  /** Ist ein lokaler Chat ohne neuen Download möglich? */
  isAvailable(): boolean {
    return this.state.kind === "ready" || this.state.kind === "cached";
  }
}
