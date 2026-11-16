import { z } from "zod";

/**
 * Valid host keys for the two-speaker audio podcast.
 */
export const PodcastHostSchema = z.enum(["host1", "host2"]);
export type PodcastHost = z.infer<typeof PodcastHostSchema>;

/**
 * Individual turn in a two-speaker host response dialog.
 */
export const AudioHostTurnSchema = z.object({
  speaker: PodcastHostSchema,
  speakerName: z.string().min(1),
  text: z.string().min(1),
  ssmlCue: z.string().optional()
});
export type AudioHostTurn = z.infer<typeof AudioHostTurnSchema>;

/**
 * Request payload for POST /api/v1/notebooks/:id/audio-interject
 */
export const AudioInterjectRequestSchema = z.object({
  userQuestion: z.string().trim().min(1, "Nutzerfrage darf nicht leer sein.").max(4000),
  currentTimeMs: z.number().nonnegative().default(0),
  podcastContext: z.string().max(32000).optional().default(""),
  sourceIds: z.array(z.string().min(1)).optional(),
  voiceMode: z.enum(["dialogue", "single", "summary"]).optional().default("dialogue"),
  host1Name: z.string().min(1).optional().default("Dr. Maria Weber"),
  host2Name: z.string().min(1).optional().default("Thomas Koch")
});
export type AudioInterjectRequest = z.infer<typeof AudioInterjectRequestSchema>;

/**
 * Grounded citation metadata returned by audio interject.
 */
export const AudioInterjectCitationSchema = z.object({
  index: z.number().int().positive(),
  chunkId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceTitle: z.string(),
  page: z.number().int().positive().nullable().optional(),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
  quote: z.string().optional()
});
export type AudioInterjectCitation = z.infer<typeof AudioInterjectCitationSchema>;

/**
 * Response payload for POST /api/v1/notebooks/:id/audio-interject
 */
export const AudioInterjectResponseSchema = z.object({
  notebookId: z.string().min(1),
  question: z.string().min(1),
  currentTimeMs: z.number().nonnegative(),
  turns: z.array(AudioHostTurnSchema).min(1),
  fullAnswer: z.string().min(1),
  citations: z.array(AudioInterjectCitationSchema),
  speechSynthesis: z.object({
    mode: z.enum(["dialogue", "single", "summary"]),
    estimatedDurationMs: z.number().positive(),
    cues: z.array(
      z.object({
        speaker: PodcastHostSchema,
        speakerName: z.string().min(1),
        text: z.string().min(1),
        voiceName: z.string().min(1),
        rate: z.number().positive().default(1.0)
      })
    )
  }),
  aiMetadata: z.object({
    aiGenerated: z.literal(true),
    provider: z.string().min(1),
    model: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    timestamp: z.string().datetime()
  })
});
export type AudioInterjectResponse = z.infer<typeof AudioInterjectResponseSchema>;

/**
 * Builds the structured prompt for the two-speaker audio host dialogue.
 */
export function buildAudioInterjectPrompt(options: {
  userQuestion: string;
  currentTimeMs: number;
  podcastContext: string;
  groundedXml: string;
  host1Name: string;
  host2Name: string;
  voiceMode?: "dialogue" | "single" | "summary";
}): string {
  const {
    userQuestion,
    currentTimeMs,
    podcastContext,
    groundedXml,
    host1Name,
    host2Name,
    voiceMode = "dialogue"
  } = options;

  return [
    `Du bist die KI-Regie für einen interaktiven Zwei-Sprecher-Podcast zwischen Host 1 (${host1Name}) und Host 2 (${host2Name}).`,
    "Ein Hörer hat während der laufenden Episode eine Zwischenfrage gestellt.",
    `Unterbrochene Position im Podcast: ${Math.round(currentTimeMs / 1000)}s (${currentTimeMs} ms).`,
    "",
    "BISHERIGER PODCAST-KONTEXT VOR DER UNTERBRECHUNG:",
    podcastContext.trim().length > 0
      ? podcastContext.trim()
      : "[Kein vorheriger Kontext übermittelt]",
    "",
    "NUTZERFRAGE:",
    userQuestion.trim(),
    "",
    "GEPRÜFTE QUELLEN AUS DEM NOTEBOOK:",
    groundedXml,
    "",
    "ANWEISUNGEN:",
    `1. Beantworte die Zwischenfrage fundiert auf Basis der bereitgestellten Quellen im Modus '${voiceMode}'.`,
    "2. Verwende bei Faktenbelegen exakte Quellenzitate in eckigen Klammern [n], wobei n dem Index der Quelle entspricht.",
    `3. Gestalte die Antwort als lebendigen Dialog zwischen ${host1Name} (Host 1, leitend/analytisch) und ${host2Name} (Host 2, pragmatisch/reflektierend).`,
    "4. Formatiere jeden Redebeitrag strikt mit einem Präfix:",
    `   ${host1Name}: <Text mit [n] Zitaten>`,
    `   ${host2Name}: <Text mit [n] Zitaten>`,
    "5. Schließe mit einer kurzen Überleitung ab, dass die beiden Hosts jetzt zum Hauptthema des Podcasts zurückkehren."
  ].join("\n");
}

/**
 * Parses raw LLM text output into structured host dialogue turns.
 */
export function parseAudioHostTurns(
  rawText: string,
  host1Name: string,
  host2Name: string
): AudioHostTurn[] {
  const turns: AudioHostTurn[] = [];
  const lines = rawText.split("\n");

  let currentSpeaker: PodcastHost | null = null;
  let currentSpeakerName = "";
  let currentBuffer: string[] = [];

  function flushCurrent() {
    if (currentSpeaker && currentBuffer.length > 0) {
      const text = currentBuffer.join(" ").trim();
      turns.push({
        speaker: currentSpeaker,
        speakerName: currentSpeakerName,
        text
      });
    }
    currentBuffer = [];
  }

  // Regex for speaker prefixes
  // e.g. "Dr. Maria Weber:", "Host 1:", "host1:", "Thomas Koch:", "Host 2:"
  const host1Pattern = new RegExp(`^(?:${escapeRegex(host1Name)}|host\\s*1|host1):\\s*(.*)$`, "i");
  const host2Pattern = new RegExp(`^(?:${escapeRegex(host2Name)}|host\\s*2|host2):\\s*(.*)$`, "i");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match1 = trimmed.match(host1Pattern);
    const match2 = trimmed.match(host2Pattern);

    if (match1) {
      flushCurrent();
      currentSpeaker = "host1";
      currentSpeakerName = host1Name;
      if (match1[1]?.trim()) {
        currentBuffer.push(match1[1].trim());
      }
    } else if (match2) {
      flushCurrent();
      currentSpeaker = "host2";
      currentSpeakerName = host2Name;
      if (match2[1]?.trim()) {
        currentBuffer.push(match2[1].trim());
      }
    } else if (currentSpeaker) {
      currentBuffer.push(trimmed);
    }
  }

  flushCurrent();

  // If no turns were extracted at all, create a single turn with host1
  if (turns.length === 0 && rawText.trim().length > 0) {
    turns.push({
      speaker: "host1",
      speakerName: host1Name,
      text: rawText.trim()
    });
  }

  return turns;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
