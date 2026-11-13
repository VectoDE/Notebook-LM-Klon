/**
 * Sprecherton für den Video-Export (Issue #241).
 *
 * POST /api/v1/notebooks/:id/video-tts erzeugt aus dem Sprechertext der Folien eine WAV-Datei
 * mit Gemini-TTS. Schlüsselreihenfolge: eigener Schlüssel (BYOK) des Kontos, sonst der zentrale
 * Demo-Schlüssel, aber nur für offizielle Demo-Notebooks und mit Demo-Ratenlimit. Ohne
 * Schlüssel antwortet die Route mit 409 und Code TTS_KEY_MISSING, damit die Oberfläche
 * erklären kann, was fehlt.
 *
 * Gemini-TTS (Interactions API, Stand der Doku November 2026): Modell gemini-3.8-flash-tts,
 * Antwort als WAV (24 kHz, mono, 16 Bit PCM) base64 in steps[].content[].data.
 * Ältere Antworten im generateContent-Format (inlineData, rohes PCM) werden ebenfalls verstanden.
 */
import { createProblemDetails, z } from "@notebook-lm/shared";
import type { Context, Hono } from "hono";
import {
  type DemoRateLimitResult,
  attachDemoHeaders,
  checkDemoKeyRateLimit,
  resolveDemoGeminiKey
} from "./demo-key-guard.js";
import { type KeyVault, deserializeEncryptedPayload } from "./key-vault.js";
import type { RagRepository } from "./rag-repository.js";

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_TTS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const GEMINI_TTS_SAMPLE_RATE = 24_000;
export const GEMINI_TTS_VOICE = "Kore";
export const VIDEO_TTS_MAX_CHARS = 5000;

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

export const VideoTtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(VIDEO_TTS_MAX_CHARS),
  lang: z.enum(["de", "en"]).default("de")
});

export class GeminiTtsError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GeminiTtsError";
  }
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Rohes PCM (16 Bit, little endian, mono) in eine WAV-Datei mit RIFF-Kopf verpacken. */
export function pcm16ToWav(
  pcm: Uint8Array,
  sampleRate: number = GEMINI_TTS_SAMPLE_RATE
): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(
      bytes[0] as number,
      bytes[1] as number,
      bytes[2] as number,
      bytes[3] as number
    ) === "RIFF"
  );
}

interface InteractionsResponse {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; data?: string; mime_type?: string }>;
  }>;
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
  }>;
}

/** Audiodaten aus der Antwort holen: Interactions-Format, sonst generateContent-Format. */
export function extractTtsAudio(body: InteractionsResponse): Uint8Array | null {
  const audioParts = (body.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === "audio" && typeof part.data === "string");
  const last = audioParts[audioParts.length - 1];
  const data =
    last?.data ??
    body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
  if (!data) return null;
  const bytes = base64ToBytes(data);
  return isWav(bytes) ? bytes : pcm16ToWav(bytes);
}

export interface RequestGeminiTtsOptions {
  readonly apiKey: string;
  readonly text: string;
  readonly voice?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly url?: string | undefined;
}

/** Text an Gemini-TTS schicken, WAV-Bytes zurück. */
export async function requestGeminiTts(options: RequestGeminiTtsOptions): Promise<Uint8Array> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(options.url ?? GEMINI_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{ type: "user_input", content: [{ type: "text", text: options.text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: options.voice ?? GEMINI_TTS_VOICE }] }
    })
  });
  if (!response.ok) {
    throw new GeminiTtsError(`Gemini-TTS antwortete mit HTTP ${response.status}.`, response.status);
  }
  const audio = extractTtsAudio((await response.json()) as InteractionsResponse);
  if (!audio) throw new GeminiTtsError("Gemini-TTS lieferte keine Audiodaten.", 502);
  return audio;
}

/** Eigenen Gemini-Schlüssel eines Kontos aus dem Schlüsseltresor lesen. */
export function createByokGeminiKeyResolver(
  ragRepo: RagRepository,
  keyVault: KeyVault | undefined
): (userId: string) => Promise<string | undefined> {
  return async (userId) => {
    if (!keyVault) return undefined;
    try {
      const stored = await ragRepo.getProviderKey(userId, "google");
      if (!stored) return undefined;
      return await keyVault.decrypt(deserializeEncryptedPayload(stored.encrypted_key), {
        userId,
        provider: "google"
      });
    } catch {
      return undefined;
    }
  };
}

export interface VideoTtsRoutesDependencies {
  readonly resolveUserKey?: ((userId: string) => Promise<string | undefined>) | undefined;
  readonly demoGeminiKey?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly checkDemoRateLimit?: ((c: Context) => Promise<DemoRateLimitResult>) | undefined;
}

export function registerVideoTtsRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: VideoTtsRoutesDependencies = {}
): void {
  app.post("/api/v1/notebooks/:id/video-tts", async (c) => {
    const problem = (
      status: 400 | 401 | 409 | 422 | 429 | 502,
      title: string,
      detail: string,
      code: string
    ) =>
      c.json(
        createProblemDetails({ status, title, detail, instance: c.req.path, code }),
        status,
        PROBLEM_HEADERS
      );

    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return problem(401, "Unauthorized", "Authentifizierung erforderlich.", "UNAUTHORIZED");
    }
    const notebookId = c.req.param("id");

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return problem(400, "Bad Request", "Ungültiges JSON im Request-Body.", "INVALID_JSON");
    }
    const parsed = VideoTtsRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return problem(
        422,
        "Unprocessable Content",
        `Sprechertext fehlt oder ist länger als ${VIDEO_TTS_MAX_CHARS} Zeichen.`,
        "VALIDATION_ERROR"
      );
    }

    let apiKey = await deps.resolveUserKey?.(sessionUser.id);
    if (!apiKey) {
      const demo = resolveDemoGeminiKey({
        notebookId,
        hasUserKey: false,
        demoApiKey: deps.demoGeminiKey,
        env: c.env as { DEMO_GEMINI_KEY?: string } | undefined
      });
      if (demo.apiKey) {
        const limit = await (
          deps.checkDemoRateLimit ??
          ((ctx) => checkDemoKeyRateLimit(ctx, (ctx.env as { DB?: D1Database } | undefined)?.DB))
        )(c);
        attachDemoHeaders(c, limit);
        if (!limit.allowed) {
          c.header("Retry-After", String(limit.retryAfterSeconds));
          return problem(
            429,
            "Too Many Requests",
            "Das Kontingent des Demo-Schlüssels ist für den Moment aufgebraucht.",
            "DEMO_RATE_LIMITED"
          );
        }
        apiKey = demo.apiKey;
      }
    }
    if (!apiKey) {
      return problem(
        409,
        "Conflict",
        "Für den Ton im Video ist ein Gemini-Schlüssel nötig: eigener Schlüssel in den Einstellungen oder ein Demo-Notebook.",
        "TTS_KEY_MISSING"
      );
    }

    try {
      const wav = await requestGeminiTts({ apiKey, text: parsed.data.text, fetchFn: deps.fetchFn });
      return c.body(wav as Uint8Array<ArrayBuffer>, 200, {
        "content-type": "audio/wav",
        "cache-control": "no-store"
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return problem(502, "Bad Gateway", detail, "TTS_FAILED");
    }
  });
}
