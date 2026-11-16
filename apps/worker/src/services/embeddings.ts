import { getUtcDayString } from "./quota-guard.js";

/**
 * Serverseitige Embeddings über Workers AI (nur kostenlose Stufe).
 *
 * Modell: `@cf/google/embeddinggemma-2`, 768 Dimensionen (passt zu `chunk_vectors`),
 * 100+ Sprachen, 8.192 Tokens Kontext je Eingabe, 154 Neuronen je Mio. Eingabe-Tokens.
 * Quellen und Rechnung: docs/rag-and-vectors.md, docs/platform-limits.md.
 *
 * Jeder Fehler, fehlendes Binding (Node/Docker) oder ein erschöpftes Kontingent führt zu
 * `{ ok: false }`; die Aufrufer suchen dann wie bisher nur per FTS5.
 */
export const EMBEDDING_MODEL = "@cf/google/embeddinggemma-2";
export const EMBEDDING_DIMENSIONS = 768;
/** Eingaben je AI-Aufruf. Die Doku nennt für dieses Modell keine Obergrenze; 25 bleibt klein. */
export const EMBEDDING_BATCH_SIZE = 25;
/**
 * Tagesbudget in Eingabe-Tokens für das ganze Konto: 50 Mio. × 154 Neuronen / 1 Mio.
 * = 7.700 Neuronen, also 77 % der freien 10.000 Neuronen pro Tag. Der Rest bleibt Puffer
 * für Schätzfehler und andere Workers-AI-Nutzung im selben Konto.
 */
export const EMBEDDING_DAILY_TOKEN_BUDGET = 50_000_000;
/** Tagesbudget je Gastkonto (2 % des Gesamtbudgets), damit einzelne Gäste nicht alles verbrauchen. */
export const EMBEDDING_GUEST_DAILY_TOKEN_BUDGET = 1_000_000;
/** Nach einem Fehler so lange kein weiterer Versuch in dieser Isolate-Instanz. */
export const EMBEDDING_FAILURE_COOLDOWN_MS = 60_000;
export const EMBEDDING_TIMEOUT_MS = 20_000;

export interface EmbeddingRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface EmbeddingRequester {
  readonly id: string;
  readonly isGuest?: boolean | undefined;
}

export interface EmbeddingEnv {
  readonly AI?: unknown;
  readonly DB?: D1Database | undefined;
}

export type EmbeddingSkipReason =
  | "no-binding"
  | "cooldown"
  | "daily-budget"
  | "guest-budget"
  | "error";

export type EmbeddingResult =
  | { readonly ok: true; readonly vectors: Float32Array[]; readonly tokens: number }
  | { readonly ok: false; readonly reason: EmbeddingSkipReason };

let cooldownUntil = 0;

/** Setzt die Fehlerpause zurück (für Tests). */
export function resetEmbeddingCircuit(): void {
  cooldownUntil = 0;
}

/** Dokument-Präfix laut Modellkarte: `title: {title} | text: {content}`, sonst `title: none`. */
export function documentInput(title: string | null | undefined, text: string): string {
  const cleanTitle = (title ?? "").replace(/[|\r\n]+/g, " ").trim();
  return `title: ${cleanTitle || "none"} | text: ${text}`;
}

/** Anfrage-Präfix laut Modellkarte für asymmetrische Suche. */
export function queryInput(query: string): string {
  return `task: search result | query: ${query}`;
}

/** Vorsichtige Schätzung (≈ 3 Zeichen je Token), wenn die Antwort keine Token-Zahl liefert. */
export function estimateTokens(texts: readonly string[]): number {
  let total = 0;
  for (const text of texts) {
    total += Math.ceil(text.length / 3);
  }
  return total;
}

function decodeEmbedding(raw: unknown): Float32Array {
  let values: Float32Array;
  if (typeof raw === "string") {
    const bin = atob(raw);
    const view = new DataView(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) {
      view.setUint8(i, bin.charCodeAt(i));
    }
    values = new Float32Array(Math.floor(bin.length / 4));
    for (let i = 0; i < values.length; i++) {
      values[i] = view.getFloat32(i * 4, true);
    }
  } else if (Array.isArray(raw)) {
    values = Float32Array.from(raw as number[]);
  } else {
    throw new Error("Embedding hat ein unbekanntes Format.");
  }
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding hat ${values.length} statt ${EMBEDDING_DIMENSIONS} Dimensionen.`);
  }
  // Auf Länge 1 normieren: das int8-Skalarprodukt entspricht dann der Kosinus-Ähnlichkeit.
  let sum = 0;
  for (const x of values) {
    sum += x * x;
  }
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 1;
  for (let i = 0; i < values.length; i++) {
    values[i] = (values[i] as number) * inv;
  }
  return values;
}

function parseResponse(
  response: unknown,
  expected: number
): { vectors: Float32Array[]; tokens: number | null } {
  const body = (response ?? {}) as {
    data?: unknown;
    usage?: { total_tokens?: unknown };
  };
  if (!Array.isArray(body.data) || body.data.length !== expected) {
    throw new Error("Antwort von Workers AI passt nicht zur Anfrage.");
  }
  const items = (body.data as Array<{ index?: number; embedding?: unknown }>)
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));
  const tokens = body.usage?.total_tokens;
  return {
    vectors: items.map((item) => decodeEmbedding(item.embedding)),
    tokens: typeof tokens === "number" ? tokens : null
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Workers AI hat nicht rechtzeitig geantwortet.")),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readUsage(
  db: D1Database,
  day: string,
  scopes: string[]
): Promise<Map<string, number>> {
  const placeholders = scopes.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT scope, tokens FROM ai_embedding_usage WHERE day = ? AND scope IN (${placeholders})`
    )
    .bind(day, ...scopes)
    .all<{ scope: string; tokens: number }>();
  return new Map(rows.results.map((row) => [row.scope, Number(row.tokens)]));
}

async function recordUsage(
  db: D1Database,
  day: string,
  scopes: string[],
  tokens: number
): Promise<void> {
  await db.prepare("DELETE FROM ai_embedding_usage WHERE day < ?").bind(day).run();
  for (const scope of scopes) {
    await db
      .prepare(
        `INSERT INTO ai_embedding_usage (day, scope, tokens) VALUES (?, ?, ?)
         ON CONFLICT(day, scope) DO UPDATE SET tokens = tokens + excluded.tokens`
      )
      .bind(day, scope, tokens)
      .run();
  }
}

/**
 * Berechnet Embeddings für `texts` (bereits mit Präfix) in Paketen. Prüft vorher das
 * Tages- und das Gastbudget und zählt danach den tatsächlichen Verbrauch.
 */
export async function embedTexts(
  env: EmbeddingEnv | undefined,
  texts: readonly string[],
  requester: EmbeddingRequester,
  options: { now?: number; timeoutMs?: number } = {}
): Promise<EmbeddingResult> {
  const ai = env?.AI as EmbeddingRunner | undefined;
  const db = env?.DB;
  if (!ai || !db) {
    return { ok: false, reason: "no-binding" };
  }
  if (texts.length === 0) {
    return { ok: true, vectors: [], tokens: 0 };
  }
  const now = options.now ?? Date.now();
  if (now < cooldownUntil) {
    return { ok: false, reason: "cooldown" };
  }

  const day = getUtcDayString(new Date(now));
  const guestScope = requester.isGuest ? `guest:${requester.id}` : null;
  const scopes = guestScope ? ["global", guestScope] : ["global"];
  const estimate = estimateTokens(texts);
  let usedTokens = 0;

  try {
    const usage = await readUsage(db, day, scopes);
    if ((usage.get("global") ?? 0) + estimate > EMBEDDING_DAILY_TOKEN_BUDGET) {
      return { ok: false, reason: "daily-budget" };
    }
    if (
      guestScope &&
      (usage.get(guestScope) ?? 0) + estimate > EMBEDDING_GUEST_DAILY_TOKEN_BUDGET
    ) {
      return { ok: false, reason: "guest-budget" };
    }

    const vectors: Float32Array[] = [];
    try {
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
        const response = await withTimeout(
          ai.run(EMBEDDING_MODEL, {
            input: batch,
            dimensions: EMBEDDING_DIMENSIONS,
            encoding_format: "base64"
          }),
          options.timeoutMs ?? EMBEDDING_TIMEOUT_MS
        );
        const parsed = parseResponse(response, batch.length);
        usedTokens += parsed.tokens ?? estimateTokens(batch);
        vectors.push(...parsed.vectors);
      }
    } finally {
      // Auch bei Abbruch nach Teilpaketen zählt, was Workers AI schon berechnet hat.
      if (usedTokens > 0) {
        await recordUsage(db, day, scopes, usedTokens);
      }
    }
    return { ok: true, vectors, tokens: usedTokens };
  } catch {
    cooldownUntil = now + EMBEDDING_FAILURE_COOLDOWN_MS;
    return { ok: false, reason: "error" };
  }
}

/** Anfragevektor für die Vektorsuche, oder `null` für reinen Volltext-Rückfall. */
export async function embedQuery(
  env: EmbeddingEnv | undefined,
  query: string,
  requester: EmbeddingRequester
): Promise<{ queryVector: number[]; model: string } | null> {
  const result = await embedTexts(env, [queryInput(query)], requester);
  if (!result.ok) {
    return null;
  }
  return { queryVector: Array.from(result.vectors[0] as Float32Array), model: EMBEDDING_MODEL };
}
