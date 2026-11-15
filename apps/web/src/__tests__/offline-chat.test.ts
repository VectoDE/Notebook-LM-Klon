import { describe, expect, it } from "vitest";
import type { LocalChatMessage, LocalModelState } from "../local-llm.js";
import { hasLocalModelFlag } from "../offline-chat-flag.js";
import {
  type OfflineAnswerInfo,
  answerOffline,
  buildLocalMessages,
  chatModeFor,
  chooseChatRoute,
  localRouteFor,
  offlineErrorText,
  passagesToLocations,
  retrieveLocalPassages,
  splitPassages,
  stripMarkers,
  terms
} from "../offline-chat.js";
import {
  OFFLINE_CHAT_DE,
  OFFLINE_CHAT_EN,
  offlineChatTexts
} from "../translations-offline-chat.js";
import type { WorkspaceSource } from "../workspace-types.js";

const S = (kind: LocalModelState["kind"]): LocalModelState =>
  kind === "loading"
    ? { kind, progress: 0.2 }
    : kind === "error"
      ? { kind, reason: "load" }
      : ({ kind } as LocalModelState);

function source(id: string, rawText: string | undefined, isSelected = true): WorkspaceSource {
  return {
    id,
    title: `Titel ${id}`,
    originalName: `${id}.md`,
    mimeType: "text/markdown",
    byteSize: 100,
    isSelected,
    rawText
  };
}

describe("Wahl des Chat-Wegs (online/offline)", () => {
  it("online geht jede Frage an den Server, unabhängig vom lokalen Modell", () => {
    for (const kind of ["checking", "unsupported", "absent", "cached", "ready"] as const) {
      expect(chooseChatRoute(true, S(kind))).toBe("server");
      expect(chatModeFor(true, S(kind))).toBe("online");
    }
  });

  it("offline: lokales Modell, wenn geladen oder gespeichert", () => {
    expect(chooseChatRoute(false, S("ready"))).toBe("local");
    expect(chooseChatRoute(false, S("cached"))).toBe("local");
    expect(chatModeFor(false, S("ready"))).toBe("offline-local");
  });

  it("offline ohne WebGPU: klare Meldung statt Versuch", () => {
    expect(chooseChatRoute(false, S("unsupported"))).toBe("unsupported");
    expect(chatModeFor(false, S("unsupported"))).toBe("offline-unsupported");
  });

  it("offline ohne geladenes Modell: Hinweis auf das Laden", () => {
    for (const kind of ["checking", "absent", "loading", "error"] as const) {
      expect(localRouteFor(S(kind))).toBe("needs-model");
      expect(chatModeFor(false, S(kind))).toBe("offline-no-model");
    }
  });
});

describe("Lokale Suche in den Quellen", () => {
  it("zerlegt an Absatz- oder Satzgrenzen und merkt sich die Position", () => {
    const text = `${"a".repeat(300)}. ${"b".repeat(300)}\n\n${"c".repeat(500)}`;
    const parts = splitPassages(text, 700);
    expect(parts.length).toBe(2);
    expect(parts[0]?.start).toBe(0);
    for (const part of parts) expect(text.slice(part.start).startsWith(part.text)).toBe(true);
    // Ohne Grenze im Fenster: harter Schnitt
    expect(splitPassages("x".repeat(1500), 700).map((p) => p.text.length)).toEqual([700, 700, 100]);
    // Führender Leerraum zählt nicht zum Abschnitt, leere Abschnitte fallen weg
    expect(splitPassages("  Hallo", 700)).toEqual([{ text: "Hallo", start: 2 }]);
    expect(splitPassages("   ", 700)).toEqual([]);
  });

  it("filtert kurze Wörter und Füllwörter", () => {
    expect(terms("Wie nutzt D1 die FTS5-Suche?")).toEqual(["nutzt", "fts5", "suche"]);
    expect(terms("?!")).toEqual([]);
  });

  it("findet den passenden Abschnitt nur in ausgewählten Quellen", () => {
    const sources = [
      source("s1", "Durable Objects speichern Vektoren im Speicher."),
      source("s2", "D1 nutzt FTS5 mit BM25 für die Volltextsuche."),
      source("s3", "FTS5 steht auch hier, aber die Quelle ist abgewählt.", false),
      source("s4", undefined)
    ];
    const hits = retrieveLocalPassages("Wie funktioniert FTS5 in D1?", sources);
    expect(hits.map((h) => h.sourceId)).toEqual(["s2"]);
    expect(hits[0]?.sourceTitle).toBe("Titel s2");
    expect(hits[0]?.startOffset).toBe(0);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("ohne Treffer: je Quelle der Anfang; ohne Quelltext: nichts", () => {
    const sources = [
      source("s1", "Erster Text.\n\nZweiter Absatz."),
      source("s2", "Anderer Inhalt.")
    ];
    const hits = retrieveLocalPassages("Quantenphysik", sources);
    expect(hits.map((h) => h.sourceId)).toEqual(["s1", "s2"]);
    expect(retrieveLocalPassages("x", [source("s1", "   ")])).toEqual([]);
    // Lange Quelle ohne Treffer: nur ihr erster Abschnitt
    const long = retrieveLocalPassages("Quantenphysik", [source("s1", "Wort. ".repeat(400))]);
    expect(long).toHaveLength(1);
    expect(long[0]?.startOffset).toBe(0);
  });

  it("begrenzt die Zahl der Auszüge", () => {
    const long = Array.from({ length: 12 }, (_, i) => `FTS5 Abschnitt ${i}. `.repeat(40)).join(
      "\n\n"
    );
    expect(retrieveLocalPassages("FTS5", [source("s1", long)], 3)).toHaveLength(3);
  });

  it("macht aus Auszügen Sprungziele mit gekürztem Zitat", () => {
    const [loc, shortLoc] = passagesToLocations([
      {
        sourceId: "s1",
        sourceTitle: "T",
        text: "x".repeat(200),
        startOffset: 5,
        endOffset: 205,
        score: 1
      },
      { sourceId: "s2", sourceTitle: "U", text: "kurz", startOffset: 0, endOffset: 4, score: 1 }
    ]);
    expect(loc).toEqual({
      sourceId: "s1",
      quote: `${"x".repeat(157)}…`,
      page: null,
      startOffset: 5,
      endOffset: 205
    });
    expect(shortLoc?.quote).toBe("kurz");
  });
});

describe("Prompt für das lokale Modell", () => {
  const passage = {
    sourceId: "s2",
    sourceTitle: "D1",
    text: "D1 nutzt FTS5.",
    startOffset: 0,
    endOffset: 14,
    score: 1
  };

  it("enthält Anweisung in der Oberflächensprache, Auszüge, gekürzten Verlauf und Frage", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`
    }));
    const de = buildLocalMessages("Wie sucht D1?", [passage], "de", history);
    expect(de[0]?.role).toBe("system");
    expect(de[0]?.content).toContain("Antworte auf Deutsch");
    expect(de[0]?.content).toContain("--- 1: D1 ---\nD1 nutzt FTS5.");
    expect(de.slice(1, -1).map((m) => m.content)).toEqual(["m2", "m3", "m4", "m5"]);
    expect(de.at(-1)).toEqual({ role: "user", content: "Wie sucht D1?" });

    const en = buildLocalMessages("How?", [], "en");
    expect(en[0]?.content).toContain("Answer in English");
    expect(en[0]?.content).toContain("No selected source texts");
    expect(en).toHaveLength(2);
    expect(buildLocalMessages("Wie?", [], "de")[0]?.content).toContain("keine ausgewählten");
  });

  it("entfernt Quellenmarker, die offline nicht geprüft werden können", () => {
    expect(stripMarkers("D1 nutzt FTS5 [1]. Und BM25 [12].")).toBe("D1 nutzt FTS5. Und BM25.");
  });
});

describe("Offline-Antwort (Chat ohne Netz, gemockte Laufzeit)", () => {
  const sources = [source("src_2", "D1 nutzt FTS5 mit BM25 für die Volltextsuche.")];

  function fakeController(kind: LocalModelState["kind"], tokens = ["D1 nutzt ", "FTS5 [1]."]) {
    const seen: LocalChatMessage[][] = [];
    return {
      seen,
      getState: () => S(kind),
      async *stream(messages: readonly LocalChatMessage[], signal?: AbortSignal) {
        seen.push([...messages]);
        for (const token of tokens) {
          if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
          yield token;
        }
      }
    };
  }

  it("antwortet lokal mit Auszügen, ehrlichem Hinweis und ohne Quellenmarker", async () => {
    const controller = fakeController("ready");
    const starts: OfflineAnswerInfo[] = [];
    const texts: string[] = [];
    const result = await answerOffline(controller, {
      question: "Wie nutzt D1 FTS5?",
      sources,
      language: "de",
      history: [{ role: "user", content: "vorher" }],
      onStart: (info) => starts.push(info),
      onText: (t) => texts.push(t)
    });
    expect(result).toBe("answered");
    expect(texts.at(-1)).toBe("D1 nutzt FTS5.");
    expect(starts[0]?.modelLabel).toBe("Qwen2.5 1.5B (lokal)");
    expect(starts[0]?.note).toContain("Zitate lassen sich offline nicht prüfen");
    expect(starts[0]?.passages[0]?.label).toBe("Auszug 1 in den Quellen zeigen");
    expect(starts[0]?.passages[0]?.location.sourceId).toBe("src_2");
    expect(controller.seen[0]?.[0]?.content).toContain("Antworte auf Deutsch");
    expect(controller.seen[0]?.[1]).toEqual({ role: "user", content: "vorher" });
  });

  it("englisch und ohne Quellentext: Hinweis ohne Auszüge", async () => {
    const controller = fakeController("cached");
    const starts: OfflineAnswerInfo[] = [];
    await answerOffline(controller, {
      question: "How?",
      sources: [],
      language: "en-GB",
      onStart: (info) => starts.push(info),
      onText: () => undefined
    });
    expect(starts[0]?.note).toContain("without source excerpts");
    expect(starts[0]?.passages).toEqual([]);
    expect(controller.seen[0]?.[0]?.content).toContain("Answer in English");
  });

  it("ohne Modell oder ohne WebGPU: Grund zurück, kein Stream", async () => {
    for (const [kind, expected] of [
      ["absent", "needs-model"],
      ["unsupported", "unsupported"]
    ] as const) {
      const controller = fakeController(kind);
      const result = await answerOffline(controller, {
        question: "x",
        sources,
        language: "de",
        onStart: () => undefined,
        onText: () => undefined
      });
      expect(result).toBe(expected);
      expect(controller.seen).toHaveLength(0);
    }
  });

  it("Abbruch wird als AbortError weitergereicht", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      answerOffline(fakeController("ready"), {
        question: "x",
        sources,
        language: "de",
        signal: abort.signal,
        onStart: () => undefined,
        onText: () => undefined
      })
    ).rejects.toThrow("Abgebrochen");
  });

  it("Fehlertexte in beiden Sprachen", () => {
    expect(offlineErrorText("needs-model", "de")).toContain("noch nicht geladen");
    expect(offlineErrorText("unsupported", "en")).toContain("no WebGPU");
    expect(offlineErrorText("failed", "de")).toBe(
      "Das lokale Modell konnte nicht antworten. Versuchen Sie es erneut."
    );
  });

  it("Merker im localStorage, robust gegen gesperrten Speicher", () => {
    expect(hasLocalModelFlag(undefined)).toBe(false);
    expect(hasLocalModelFlag({ getItem: () => "1" })).toBe(true);
    expect(hasLocalModelFlag({ getItem: () => null })).toBe(false);
    expect(
      hasLocalModelFlag({
        getItem: () => {
          throw new Error("SecurityError");
        }
      })
    ).toBe(false);
  });

  it("beide Kataloge haben dieselben Schlüssel", () => {
    expect(Object.keys(OFFLINE_CHAT_EN)).toEqual(Object.keys(OFFLINE_CHAT_DE));
    expect(offlineChatTexts("en")).toBe(OFFLINE_CHAT_EN);
    expect(offlineChatTexts("fr")).toBe(OFFLINE_CHAT_DE);
  });
});
