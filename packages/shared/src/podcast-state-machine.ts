/**
 * podcast-state-machine.ts
 *
 * Deterministic podcast playback state machine supporting seamless
 * interactive host interjections ('Beitreten / Fragen') via mic or text.
 *
 * States:
 *   - 'idle': No playback active
 *   - 'playing': Main audio podcast overview playing
 *   - 'paused': Manually paused by user
 *   - 'interjecting': User joined to ask a question (mic listening or typing), main audio faded out
 *   - 'answering': Hosts responding with grounded answers and synthesized audio / TTS
 *   - 'resuming': Smooth transition back into main audio overview at the exact ms paused
 *
 * Decisions: #65, #68, #79 (Issue #26 / Sub-Issue #118)
 */

export type PodcastState =
  | "idle"
  | "playing"
  | "paused"
  | "interjecting"
  | "answering"
  | "resuming";

export type PodcastEvent =
  | { type: "LOAD"; durationMs: number; trackUrl?: string }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TIME_UPDATE"; currentTimeMs: number }
  | { type: "JOIN_INTERJECT"; inputMode?: "mic" | "text" }
  | { type: "SUBMIT_QUESTION"; question: string }
  | { type: "CANCEL_INTERJECT" }
  | { type: "HOST_ANSWER_START"; answerText: string; durationMs?: number }
  | { type: "HOST_ANSWER_COMPLETE" }
  | { type: "RESUME_CONFIRMED" }
  | { type: "STOP" };

export interface PodcastStateMachineContext {
  state: PodcastState;
  previousState: PodcastState;
  currentTimeMs: number;
  pausedAtMs: number;
  durationMs: number;
  trackUrl: string | null;
  interjectInputMode: "mic" | "text" | null;
  currentQuestion: string | null;
  currentHostAnswer: string | null;
  hostAnswerDurationMs: number;
  volume: number; // 0.0 to 1.0
  fadeStepMs: number;
}

export interface PodcastStateMachineOptions {
  fadeDurationMs?: number;
  initialVolume?: number;
}

export type StateChangeListener = (context: PodcastStateMachineContext) => void;

export class PodcastStateMachine {
  private ctx: PodcastStateMachineContext;
  private readonly listeners: Set<StateChangeListener> = new Set();
  private readonly fadeDurationMs: number;

  constructor(options?: PodcastStateMachineOptions) {
    this.fadeDurationMs = options?.fadeDurationMs ?? 400;
    this.ctx = {
      state: "idle",
      previousState: "idle",
      currentTimeMs: 0,
      pausedAtMs: 0,
      durationMs: 0,
      trackUrl: null,
      interjectInputMode: null,
      currentQuestion: null,
      currentHostAnswer: null,
      hostAnswerDurationMs: 0,
      volume: options?.initialVolume ?? 1.0,
      fadeStepMs: Math.max(10, Math.floor(this.fadeDurationMs / 10))
    };
  }

  public getContext(): Readonly<PodcastStateMachineContext> {
    return { ...this.ctx };
  }

  public getState(): PodcastState {
    return this.ctx.state;
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private transition(nextState: PodcastState): void {
    this.ctx.previousState = this.ctx.state;
    this.ctx.state = nextState;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getContext();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /**
   * Dispatches an event to transition the state machine deterministically.
   */
  public dispatch(event: PodcastEvent): boolean {
    const current = this.ctx.state;

    switch (event.type) {
      case "LOAD": {
        this.ctx.durationMs = Math.max(0, event.durationMs);
        this.ctx.trackUrl = event.trackUrl ?? null;
        this.ctx.currentTimeMs = 0;
        this.ctx.pausedAtMs = 0;
        this.ctx.volume = 1.0;
        this.transition("paused");
        return true;
      }

      case "PLAY": {
        if (current === "paused" || current === "idle") {
          this.ctx.volume = 1.0;
          this.transition("playing");
          return true;
        }
        return false;
      }

      case "PAUSE": {
        if (current === "playing") {
          this.ctx.pausedAtMs = this.ctx.currentTimeMs;
          this.transition("paused");
          return true;
        }
        return false;
      }

      case "TIME_UPDATE": {
        if (current === "playing") {
          this.ctx.currentTimeMs = Math.max(0, event.currentTimeMs);
          this.notify();
          return true;
        }
        return false;
      }

      case "JOIN_INTERJECT": {
        if (current === "playing" || current === "paused") {
          // Record the exact position where audio was paused
          this.ctx.pausedAtMs = this.ctx.currentTimeMs;
          this.ctx.interjectInputMode = event.inputMode ?? "text";
          this.ctx.currentQuestion = null;
          this.ctx.currentHostAnswer = null;
          // Fade volume to 0 for soft mute
          this.ctx.volume = 0.0;
          this.transition("interjecting");
          return true;
        }
        return false;
      }

      case "SUBMIT_QUESTION": {
        if (current === "interjecting") {
          this.ctx.currentQuestion = event.question;
          this.notify();
          return true;
        }
        return false;
      }

      case "CANCEL_INTERJECT": {
        if (current === "interjecting") {
          this.ctx.currentQuestion = null;
          this.ctx.interjectInputMode = null;
          // Restore exact paused timestamp and volume
          this.ctx.currentTimeMs = this.ctx.pausedAtMs;
          this.ctx.volume = 1.0;
          // If was playing before interject, return to resuming/playing, else paused
          if (this.ctx.previousState === "playing") {
            this.transition("resuming");
            this.transition("playing");
          } else {
            this.transition("paused");
          }
          return true;
        }
        return false;
      }

      case "HOST_ANSWER_START": {
        if (current === "interjecting") {
          this.ctx.currentHostAnswer = event.answerText;
          this.ctx.hostAnswerDurationMs = event.durationMs ?? 0;
          this.transition("answering");
          return true;
        }
        return false;
      }

      case "HOST_ANSWER_COMPLETE": {
        if (current === "answering") {
          // Transition into resuming state to trigger seamless ramp-up
          this.transition("resuming");
          return true;
        }
        return false;
      }

      case "RESUME_CONFIRMED": {
        if (current === "resuming") {
          // Reset interject-specific state
          this.ctx.currentQuestion = null;
          this.ctx.currentHostAnswer = null;
          this.ctx.interjectInputMode = null;
          this.ctx.hostAnswerDurationMs = 0;
          // Ensure playback continues at exact timestamp
          this.ctx.currentTimeMs = this.ctx.pausedAtMs;
          this.ctx.volume = 1.0;
          this.transition("playing");
          return true;
        }
        return false;
      }

      case "STOP": {
        this.ctx.currentTimeMs = 0;
        this.ctx.pausedAtMs = 0;
        this.ctx.currentQuestion = null;
        this.ctx.currentHostAnswer = null;
        this.ctx.interjectInputMode = null;
        this.ctx.volume = 1.0;
        this.transition("idle");
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Helper to perform programmatic volume fade-out.
   */
  public async fadeOut(steps = 5): Promise<void> {
    const startVolume = this.ctx.volume;
    for (let i = 1; i <= steps; i++) {
      this.ctx.volume = Math.max(0, startVolume * (1 - i / steps));
      this.notify();
      await delay(this.ctx.fadeStepMs);
    }
    this.ctx.volume = 0;
    this.notify();
  }

  /**
   * Helper to perform programmatic volume fade-in.
   */
  public async fadeIn(targetVolume = 1.0, steps = 5): Promise<void> {
    for (let i = 1; i <= steps; i++) {
      this.ctx.volume = Math.min(targetVolume, (targetVolume * i) / steps);
      this.notify();
      await delay(this.ctx.fadeStepMs);
    }
    this.ctx.volume = targetVolume;
    this.notify();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
