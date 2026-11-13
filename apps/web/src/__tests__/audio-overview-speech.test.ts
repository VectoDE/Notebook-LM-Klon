import { describe, expect, it, vi } from "vitest";
import {
  AudioOverviewSpeechController,
  type PlaybackState,
  type SpeechSynthesisLike,
  type SpeechTurn,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
  audioOverviewKeyAction,
  browserSpeech,
  pickVoicesForLang,
  voicesForLang
} from "../audio-overview-speech.js";

const voice = (name: string, lang: string, isDefault = false): SpeechVoiceLike => ({
  name,
  lang,
  voiceURI: name,
  default: isDefault
});

const DE_A = voice("Anna", "de-DE");
const DE_B = voice("Markus", "de-DE");
const DE_AT = voice("Hedda", "de_AT");
const EN_US = voice("Samantha", "en-US", true);
const EN_GB = voice("Daniel", "en-GB");

/** Sprachausgabe-Mock: merkt sich Äußerungen und Aufrufe, Ereignisse löst der Test aus. */
class MockSynth implements SpeechSynthesisLike {
  readonly spoken: SpeechUtteranceLike[] = [];
  readonly calls: string[] = [];
  constructor(public voices: SpeechVoiceLike[]) {}
  speak(utterance: SpeechUtteranceLike) {
    this.calls.push(`speak:${utterance.text}`);
    this.spoken.push(utterance);
  }
  cancel() {
    this.calls.push("cancel");
  }
  pause() {
    this.calls.push("pause");
  }
  resume() {
    this.calls.push("resume");
  }
  getVoices() {
    return this.voices;
  }
  get last(): SpeechUtteranceLike {
    return this.spoken[this.spoken.length - 1] as SpeechUtteranceLike;
  }
}

function createUtterance(text: string): SpeechUtteranceLike {
  return { text, lang: "", voice: null, pitch: 1, rate: 1, onend: null, onerror: null };
}

const TURNS: SpeechTurn[] = [
  { speaker: "host", text: "Hallo", lang: "de" },
  { speaker: "expert", text: "Quelle sagt", lang: "de" },
  { speaker: "host", text: "Danke", lang: "de" }
];

function setup(voices: SpeechVoiceLike[] = [DE_A, DE_B], turns = TURNS) {
  const synth = new MockSynth(voices);
  const states: PlaybackState[] = [];
  const indexes: number[] = [];
  const errors: string[] = [];
  const controller = new AudioOverviewSpeechController({
    synth,
    createUtterance,
    turns,
    onTurnChange: (i) => indexes.push(i),
    onStateChange: (s) => states.push(s),
    onError: (e) => errors.push(e)
  });
  return { synth, controller, states, indexes, errors };
}

describe("Audio-Übersicht: Stimmenwahl (#240)", () => {
  it("zwei verschiedene Stimmen für Host und Expertin, bevorzugte Region zuerst", () => {
    const assignment = pickVoicesForLang([EN_US, DE_AT, DE_A, DE_B], "de-DE");
    expect(assignment.fallback).toBe("none");
    expect(assignment.host.voice).toBe(DE_A);
    expect(assignment.expert.voice).toBe(DE_B);
    expect(assignment.host.pitch).not.toBe(assignment.expert.pitch);
    expect(voicesForLang([DE_AT, EN_GB, EN_US], "en")).toEqual([EN_US, EN_GB]);
    expect(voicesForLang([DE_AT], "de")).toEqual([DE_AT]);
  });

  it("nur eine Stimme: gleiche Stimme, deutlich andere Tonhöhe, Hinweis single-voice", () => {
    const assignment = pickVoicesForLang([DE_A, EN_US], "de");
    expect(assignment.fallback).toBe("single-voice");
    expect(assignment.host.voice).toBe(DE_A);
    expect(assignment.expert.voice).toBe(DE_A);
    expect(assignment.host.pitch - assignment.expert.pitch).toBeGreaterThanOrEqual(0.4);
  });

  it("keine Stimme für die Sprache: Hinweis no-voice, Tonhöhe trennt die Rollen", () => {
    const assignment = pickVoicesForLang([EN_US], "de");
    expect(assignment.fallback).toBe("no-voice");
    expect(assignment.host.voice).toBeNull();
    expect(assignment.host.pitch).toBeGreaterThan(assignment.expert.pitch);
  });

  it("browserSpeech erkennt fehlende und vorhandene API", () => {
    expect(browserSpeech(undefined)).toBeNull();
    expect(browserSpeech({})).toBeNull();
    expect(browserSpeech({ speechSynthesis: new MockSynth([]) })).toBeNull();
    class FakeUtterance {
      constructor(public text: string) {}
    }
    const synth = new MockSynth([]);
    const api = browserSpeech({ speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
    expect(api?.synth).toBe(synth);
    expect(api?.createUtterance("Test").text).toBe("Test");
    // Ohne Argument: Node hat kein window
    expect(browserSpeech()).toBeNull();
  });
});

describe("Audio-Übersicht: Wiedergabe mit Sprachausgabe-Mock (#240)", () => {
  it("spielt alle Beiträge nacheinander mit zwei Stimmen und meldet den aktiven Beitrag", () => {
    const { synth, controller, states, indexes } = setup();
    controller.play();
    expect(controller.state).toBe("playing");
    expect(synth.last.text).toBe("Hallo");
    expect(synth.last.voice).toBe(DE_A);
    expect(synth.last.lang).toBe("de");

    synth.last.onend?.();
    expect(synth.last.text).toBe("Quelle sagt");
    expect(synth.last.voice).toBe(DE_B);
    expect(controller.currentIndex).toBe(1);

    synth.last.onend?.();
    synth.last.onend?.();
    expect(controller.state).toBe("ended");
    expect(indexes).toEqual([1, 2]);
    expect(states).toEqual(["playing", "ended"]);
  });

  it("Pause und Fortsetzen gehen an die Sprachausgabe; toggle wechselt passend", () => {
    const { synth, controller } = setup();
    controller.pause(); // ohne Wiedergabe: nichts
    controller.resume();
    expect(synth.calls).toEqual([]);
    controller.toggle();
    expect(controller.state).toBe("playing");
    controller.toggle();
    expect(controller.state).toBe("paused");
    controller.toggle();
    expect(controller.state).toBe("playing");
    expect(synth.calls).toEqual(["cancel", "speak:Hallo", "pause", "resume"]);
  });

  it("Springen während der Wiedergabe bricht ab und verwirft späte Ereignisse", () => {
    const { synth, controller } = setup();
    controller.play();
    const first = synth.last;
    controller.next();
    expect(synth.last.text).toBe("Quelle sagt");
    // onend der abgebrochenen Äußerung darf nicht weiterschalten
    first.onend?.();
    first.onerror?.({ error: "interrupted" });
    expect(controller.currentIndex).toBe(1);
    expect(controller.state).toBe("playing");
    controller.previous();
    expect(synth.last.text).toBe("Hallo");
    controller.previous(); // bleibt bei 0
    expect(controller.currentIndex).toBe(0);
  });

  it("Springen ohne Wiedergabe setzt nur die Position; danach spielt play() dort", () => {
    const { synth, controller, indexes } = setup();
    controller.next();
    controller.next();
    controller.next(); // begrenzt auf den letzten Beitrag
    expect(controller.currentIndex).toBe(2);
    expect(synth.spoken).toHaveLength(0);
    controller.play();
    expect(synth.last.text).toBe("Danke");
    synth.last.onend?.();
    expect(controller.state).toBe("ended");
    controller.play(); // nach dem Ende von vorn
    expect(synth.last.text).toBe("Hallo");
    expect(indexes).toEqual([1, 2, 0]);
  });

  it("Browser, die onend synchron beim cancel() feuern, schalten nicht doppelt weiter", () => {
    const { synth, controller } = setup();
    synth.cancel = () => {
      synth.calls.push("cancel");
      synth.spoken[synth.spoken.length - 1]?.onend?.();
    };
    controller.play();
    controller.next();
    expect(controller.currentIndex).toBe(1);
    expect(synth.spoken.map((u) => u.text)).toEqual(["Hallo", "Quelle sagt"]);
  });

  it("interrupted/canceled der laufenden Äußerung gilt nicht als Fehler", () => {
    const { synth, controller, errors } = setup();
    controller.play();
    synth.last.onerror?.({ error: "canceled" });
    expect(controller.state).toBe("playing");
    expect(errors).toEqual([]);
  });

  it("stop() bricht ab, setzt auf Anfang und ignoriert die alte Äußerung", () => {
    const { synth, controller } = setup();
    controller.play(1);
    const utterance = synth.last;
    controller.stop();
    expect(controller.state).toBe("idle");
    expect(controller.currentIndex).toBe(0);
    utterance.onend?.();
    expect(synth.spoken).toHaveLength(1);
  });

  it("pausiert springen spielt am Ziel weiter", () => {
    const { synth, controller } = setup();
    controller.play();
    controller.pause();
    controller.jump(2);
    expect(controller.state).toBe("playing");
    expect(synth.last.text).toBe("Danke");
  });

  it("echter Fehler stoppt und meldet ihn, ohne Fehlercode als unknown", () => {
    const { synth, controller, errors } = setup();
    controller.play();
    synth.last.onerror?.({ error: "not-allowed" });
    expect(controller.state).toBe("idle");
    expect(errors).toEqual(["not-allowed"]);
    controller.play();
    synth.last.onerror?.({});
    expect(errors).toEqual(["not-allowed", "unknown"]);
    // Nach dem Fehler: späte Ereignisse derselben Äußerung zählen nicht
    synth.last.onend?.();
    expect(controller.state).toBe("idle");
  });

  it("Stimmen je Sprache: Zitat in Quellsprache, Cache bis voiceschanged", () => {
    const turns: SpeechTurn[] = [
      { speaker: "host", text: "Welcome", lang: "en" },
      { speaker: "expert", text: "Zitat", lang: "de" }
    ];
    const { synth, controller } = setup([EN_US], turns);
    expect(controller.voicesFor("en").fallback).toBe("single-voice");
    synth.voices = [EN_US, EN_GB, DE_A];
    expect(controller.voicesFor("en").fallback).toBe("single-voice"); // zwischengespeichert
    controller.invalidateVoices();
    expect(controller.voicesFor("en").fallback).toBe("none");
    controller.play();
    expect(synth.last.voice).toBe(EN_US);
    synth.last.onend?.();
    expect(synth.last.lang).toBe("de");
    expect(synth.last.voice).toBe(DE_A);
    expect(synth.last.pitch).toBeLessThan(1);
  });

  it("leeres Skript endet sofort; Rückrufe sind optional", () => {
    const synth = new MockSynth([]);
    const controller = new AudioOverviewSpeechController({ synth, createUtterance, turns: [] });
    controller.play();
    expect(controller.state).toBe("ended");
    const spy = vi.spyOn(synth, "cancel");
    controller.stop();
    expect(spy).toHaveBeenCalled();

    const quiet = new AudioOverviewSpeechController({ synth, createUtterance, turns: TURNS });
    quiet.play();
    quiet.next();
    synth.last.onerror?.({ error: "synthesis-failed" });
    expect(quiet.state).toBe("idle");
    expect(quiet.currentIndex).toBe(1);
  });

  it("browserSpeech nimmt ohne Argument das globale window", () => {
    class FakeUtterance {
      constructor(public text: string) {}
    }
    const synth = new MockSynth([]);
    vi.stubGlobal("window", { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
    try {
      expect(browserSpeech()?.synth).toBe(synth);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Audio-Übersicht: Tastatur (#240)", () => {
  it("ordnet Tasten den Aktionen zu", () => {
    expect(audioOverviewKeyAction(" ", {})).toBe("toggle");
    expect(audioOverviewKeyAction("Spacebar", {}, "OL")).toBe("toggle");
    expect(audioOverviewKeyAction("k", {}, "BUTTON")).toBe("toggle");
    expect(audioOverviewKeyAction("K", {})).toBe("toggle");
    expect(audioOverviewKeyAction("ArrowRight", {}, "button")).toBe("next");
    expect(audioOverviewKeyAction("l", {})).toBe("next");
    expect(audioOverviewKeyAction("L", {})).toBe("next");
    expect(audioOverviewKeyAction("ArrowLeft", {})).toBe("previous");
    expect(audioOverviewKeyAction("j", {})).toBe("previous");
    expect(audioOverviewKeyAction("J", {})).toBe("previous");
    expect(audioOverviewKeyAction("Home", {})).toBe("restart");
    expect(audioOverviewKeyAction("Escape", {}, "INPUT")).toBe("stop");
    expect(audioOverviewKeyAction("x", {})).toBeNull();
  });

  it("lässt Eingaben, Knöpfe und Kombinationen mit Strg/Alt/Meta in Ruhe", () => {
    expect(audioOverviewKeyAction(" ", {}, "BUTTON")).toBeNull();
    expect(audioOverviewKeyAction(" ", {}, "SELECT")).toBeNull();
    expect(audioOverviewKeyAction(" ", {}, "TEXTAREA")).toBeNull();
    expect(audioOverviewKeyAction("k", {}, "INPUT")).toBeNull();
    expect(audioOverviewKeyAction("ArrowRight", {}, "INPUT")).toBeNull();
    expect(audioOverviewKeyAction("ArrowLeft", {}, "TEXTAREA")).toBeNull();
    expect(audioOverviewKeyAction("Home", {}, "INPUT")).toBeNull();
    expect(audioOverviewKeyAction("k", { ctrlKey: true })).toBeNull();
    expect(audioOverviewKeyAction("k", { altKey: true })).toBeNull();
    expect(audioOverviewKeyAction("k", { metaKey: true })).toBeNull();
  });
});
