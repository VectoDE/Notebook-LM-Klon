import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DAILY_TOKEN_BUDGET,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_FAILURE_COOLDOWN_MS,
  EMBEDDING_GUEST_DAILY_TOKEN_BUDGET,
  EMBEDDING_MODEL,
  type EmbeddingRunner,
  documentInput,
  embedQuery,
  embedTexts,
  estimateTokens,
  queryInput,
  resetEmbeddingCircuit
} from "../embeddings.js";
import { createSqliteD1Adapter, runSqliteMigrations } from "../node/sqlite-d1.js";

/** Liefert je Eingabe einen 768-dim-Vektor, dessen erste Komponente die Textlänge ist. */
function vectorFor(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = text.length;
  v[1] = 1;
  return v;
}

function base64Of(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function createRunner(
  encode: "float" | "base64" = "base64",
  usage: "with" | "without" = "with"
): EmbeddingRunner & { calls: Array<{ model: string; inputs: Record<string, unknown> }> } {
  const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  return {
    calls,
    async run(model, inputs) {
      calls.push({ model, inputs });
      const texts = inputs.input as string[];
      return {
        object: "list",
        // Rückwärts sortiert, um die Sortierung nach index zu prüfen
        data: texts
          .map((t, index) => ({
            object: "embedding",
            index,
            embedding: encode === "base64" ? base64Of(vectorFor(t)) : vectorFor(t)
          }))
          .reverse(),
        ...(usage === "with" ? { usage: { prompt_tokens: 7, total_tokens: 7 } } : {})
      };
    }
  };
}

describe("Workers-AI-Embeddings (embeddinggemma-2) mit Kontingentschutz", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  const alice = { id: "alice", isGuest: false };
  const guest = { id: "gast1", isGuest: true };
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);

  beforeEach(() => {
    resetEmbeddingCircuit();
    sqlite = new DatabaseSync(":memory:");
    runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
    db = createSqliteD1Adapter(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  const usageRows = () =>
    sqlite.prepare("SELECT day, scope, tokens FROM ai_embedding_usage ORDER BY scope").all();

  it("formatiert Dokumente und Anfragen mit den Aufgabenpräfixen des Modells", () => {
    expect(documentInput("Elbe.pdf", "Die Elbe")).toBe("title: Elbe.pdf | text: Die Elbe");
    expect(documentInput("  ", "x")).toBe("title: none | text: x");
    expect(documentInput(null, "x")).toBe("title: none | text: x");
    expect(documentInput("a|b\nc", "x")).toBe("title: a b c | text: x");
    expect(queryInput("Wo fließt die Elbe?")).toBe(
      "task: search result | query: Wo fließt die Elbe?"
    );
    expect(estimateTokens(["abc", "abcd"])).toBe(3);
  });

  it("ohne AI-Binding oder D1 gibt es keine Embeddings (Rückfall auf Volltext)", async () => {
    expect(await embedTexts(undefined, ["x"], alice)).toEqual({ ok: false, reason: "no-binding" });
    expect(await embedTexts({ DB: db }, ["x"], alice)).toEqual({
      ok: false,
      reason: "no-binding"
    });
    expect(await embedTexts({ AI: createRunner() }, ["x"], alice)).toEqual({
      ok: false,
      reason: "no-binding"
    });
    expect(await embedTexts({ AI: createRunner(), DB: db }, [], alice)).toEqual({
      ok: true,
      vectors: [],
      tokens: 0
    });
    expect(await embedQuery(undefined, "x", alice)).toBeNull();
  });

  it("rechnet in Paketen, sortiert nach index, normiert auf Länge 1 und zählt Tokens", async () => {
    const ai = createRunner("base64");
    const texts = Array.from({ length: EMBEDDING_BATCH_SIZE + 2 }, (_, i) => "t".repeat(i + 1));
    const result = await embedTexts({ AI: ai, DB: db }, texts, alice, { now });
    if (!result.ok) throw new Error(result.reason);

    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[0]?.model).toBe(EMBEDDING_MODEL);
    expect(EMBEDDING_MODEL).toBe("@cf/google/embeddinggemma-2");
    expect(ai.calls[0]?.inputs).toMatchObject({
      dimensions: 768,
      encoding_format: "base64"
    });
    expect((ai.calls[0]?.inputs.input as string[]).length).toBe(EMBEDDING_BATCH_SIZE);
    expect(result.vectors).toHaveLength(texts.length);
    const v3 = result.vectors[2] as Float32Array;
    expect(v3.length).toBe(768);
    // [3, 1, 0...] normiert
    expect(v3[0]).toBeCloseTo(3 / Math.sqrt(10), 5);
    expect(v3[1]).toBeCloseTo(1 / Math.sqrt(10), 5);
    expect(result.tokens).toBe(14);
    expect(usageRows()).toEqual([{ day: "2026-11-14", scope: "global", tokens: 14 }]);
  });

  it("versteht auch Float-Arrays ohne usage-Angabe und schätzt dann die Tokens", async () => {
    const ai = createRunner("float", "without");
    const result = await embedTexts({ AI: ai, DB: db }, ["abcdef"], guest, { now });
    if (!result.ok) throw new Error(result.reason);
    expect(result.vectors[0]?.[0]).toBeCloseTo(6 / Math.sqrt(37), 5);
    expect(result.tokens).toBe(estimateTokens(["abcdef"]));
    expect(usageRows()).toEqual([
      { day: "2026-11-14", scope: "global", tokens: 2 },
      { day: "2026-11-14", scope: "guest:gast1", tokens: 2 }
    ]);
  });

  it("Nullvektoren bleiben Nullvektoren statt NaN", async () => {
    const ai: EmbeddingRunner = {
      run: async () => ({
        data: [{ index: 0, embedding: new Array(EMBEDDING_DIMENSIONS).fill(0) }]
      })
    };
    const result = await embedTexts({ AI: ai, DB: db }, ["x"], alice, { now });
    if (!result.ok) throw new Error(result.reason);
    expect(Array.from(result.vectors[0] as Float32Array).every((x) => x === 0)).toBe(true);
  });

  it("Tageskontingent: über dem globalen Budget wird nicht mehr gerechnet, am nächsten UTC-Tag wieder", async () => {
    sqlite
      .prepare("INSERT INTO ai_embedding_usage (day, scope, tokens) VALUES (?, 'global', ?)")
      .run("2026-11-14", EMBEDDING_DAILY_TOKEN_BUDGET - 1);
    const ai = createRunner();
    expect(await embedTexts({ AI: ai, DB: db }, ["abcdef"], alice, { now })).toEqual({
      ok: false,
      reason: "daily-budget"
    });
    expect(ai.calls).toHaveLength(0);

    const tomorrow = now + 24 * 60 * 60 * 1000;
    const next = await embedTexts({ AI: ai, DB: db }, ["abcdef"], alice, { now: tomorrow });
    expect(next.ok).toBe(true);
    // Der Vortag wird beim Schreiben aufgeräumt
    expect(usageRows()).toEqual([{ day: "2026-11-15", scope: "global", tokens: 7 }]);
  });

  it("Gäste haben ein eigenes, kleineres Tageslimit", async () => {
    sqlite
      .prepare("INSERT INTO ai_embedding_usage (day, scope, tokens) VALUES (?, ?, ?)")
      .run("2026-11-14", "guest:gast1", EMBEDDING_GUEST_DAILY_TOKEN_BUDGET);
    const ai = createRunner();
    expect(await embedTexts({ AI: ai, DB: db }, ["x"], guest, { now })).toEqual({
      ok: false,
      reason: "guest-budget"
    });
    // Angemeldete Konten sind davon nicht betroffen
    expect((await embedTexts({ AI: ai, DB: db }, ["x"], alice, { now })).ok).toBe(true);
    expect(EMBEDDING_GUEST_DAILY_TOKEN_BUDGET).toBeLessThan(EMBEDDING_DAILY_TOKEN_BUDGET);
  });

  it("Fehler von Workers AI: Rückfall, Teilverbrauch wird gezählt, danach Pause", async () => {
    let call = 0;
    const ai: EmbeddingRunner = {
      run: async (_model, inputs) => {
        call++;
        if (call === 2) throw new Error("4006: daily free allocation used up");
        const texts = inputs.input as string[];
        return {
          data: texts.map((t, index) => ({ index, embedding: vectorFor(t) })),
          usage: { total_tokens: 5 }
        };
      }
    };
    const texts = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, () => "x");
    expect(await embedTexts({ AI: ai, DB: db }, texts, alice, { now })).toEqual({
      ok: false,
      reason: "error"
    });
    expect(usageRows()).toEqual([{ day: "2026-11-14", scope: "global", tokens: 5 }]);

    // Während der Pause kein weiterer Aufruf
    expect(await embedTexts({ AI: ai, DB: db }, ["x"], alice, { now: now + 1000 })).toEqual({
      ok: false,
      reason: "cooldown"
    });
    expect(call).toBe(2);
    const later = now + EMBEDDING_FAILURE_COOLDOWN_MS + 1;
    expect((await embedTexts({ AI: ai, DB: db }, ["x"], alice, { now: later })).ok).toBe(true);
  });

  it("verwirft unbrauchbare Antworten (falsche Anzahl, falsche Dimension, kein data)", async () => {
    const answers: unknown[] = [
      null,
      { data: "kaputt" },
      { data: [] },
      { data: [{ index: 0, embedding: [1, 2, 3] }] },
      { data: [{ index: 0, embedding: 42 }] }
    ];
    for (const answer of answers) {
      resetEmbeddingCircuit();
      const ai: EmbeddingRunner = { run: async () => answer };
      expect(await embedTexts({ AI: ai, DB: db }, ["x"], alice, { now })).toEqual({
        ok: false,
        reason: "error"
      });
    }
    expect(usageRows()).toEqual([]);
  });

  it("bricht nach der Zeitgrenze ab, statt die Anfrage hängen zu lassen", async () => {
    vi.useFakeTimers();
    const ai: EmbeddingRunner = { run: () => new Promise(() => {}) };
    const pending = embedTexts({ AI: ai, DB: db }, ["x"], alice, { now, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toEqual({ ok: false, reason: "error" });
  });

  it("ein D1-Fehler beim Kontingent führt zum Rückfall, nicht zum Absturz", async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error("no such table");
      }
    } as unknown as D1Database;
    expect(await embedTexts({ AI: createRunner(), DB: brokenDb }, ["x"], alice, { now })).toEqual({
      ok: false,
      reason: "error"
    });
  });

  it("embedQuery liefert den Anfragevektor samt Modell für die Vektorsuche", async () => {
    const ai = createRunner();
    const q = await embedQuery({ AI: ai, DB: db }, "Elbe", alice);
    expect(q?.model).toBe(EMBEDDING_MODEL);
    expect(q?.queryVector).toHaveLength(768);
    expect((ai.calls[0]?.inputs.input as string[])[0]).toBe("task: search result | query: Elbe");
  });
});
