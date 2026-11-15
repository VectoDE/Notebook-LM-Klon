import type { CitationLocation } from "./workspace-types.js";

/**
 * Markdown-Export des Chatverlaufs mit Zitaten (Issue #243).
 * Reine Funktionen ohne DOM: der Aufrufer lädt die Datei herunter.
 */

export interface ExportableChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly citations?: readonly CitationLocation[] | undefined;
  readonly aborted?: boolean | undefined;
  readonly error?: string | undefined;
  readonly modelUsed?: string | undefined;
}

/** Bedientexte des Exports in der Sprache der Oberfläche. */
export interface ChatExportLabels {
  readonly exportedAt: string;
  readonly user: string;
  readonly assistant: string;
  readonly sources: string;
  readonly page: string;
  readonly aborted: string;
  readonly aiLabel: string;
}

export interface ChatExportOptions {
  readonly title: string;
  readonly date: Date;
  readonly labels: ChatExportLabels;
  /** Liefert den Titel einer Quelle zur id; sonst steht die id im Export. */
  readonly sourceTitle?: ((sourceId: string) => string | undefined) | undefined;
}

/**
 * Markdown-Leser stellen rohes HTML dar. Fragen und Antworten bleiben reiner Text,
 * deshalb werden &, < und > maskiert (Anführungszeichen bleiben lesbar).
 */
export function escapeMarkdownHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Zitatnummern [n], die im Text tatsächlich vorkommen, aufsteigend und ohne Doppelte. */
export function citedNumbers(content: string): number[] {
  const found = new Set<number>();
  for (const match of content.matchAll(/\[(\d+)\]/g)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function citationLine(
  n: number,
  citation: CitationLocation | undefined,
  options: ChatExportOptions
): string {
  if (!citation) return `${n}. [${n}]`;
  const title = options.sourceTitle?.(citation.sourceId) ?? citation.sourceId;
  const parts = [escapeMarkdownHtml(title)];
  if (typeof citation.page === "number") parts.push(`${options.labels.page} ${citation.page}`);
  const quote = citation.quote ? `: „${escapeMarkdownHtml(citation.quote)}“` : "";
  return `${n}. ${parts.join(", ")}${quote}`;
}

/** Baut die Markdown-Datei: Titel, Datum, dann jede Nachricht mit ihren Quellen. */
export function chatToMarkdown(
  messages: readonly ExportableChatMessage[],
  options: ChatExportOptions
): string {
  const { labels } = options;
  const lines: string[] = [
    `# ${escapeMarkdownHtml(options.title)}`,
    "",
    `${labels.exportedAt}: ${options.date.toISOString().slice(0, 10)}`
  ];
  for (const message of messages) {
    if (message.role === "system" || (!message.content && !message.aborted)) continue;
    lines.push("", `## ${message.role === "user" ? labels.user : labels.assistant}`, "");
    lines.push(escapeMarkdownHtml(message.content));
    if (message.aborted) lines.push("", `_${labels.aborted}_`);
    if (message.role === "assistant") {
      const numbers = citedNumbers(message.content);
      if (numbers.length > 0) {
        lines.push("", `**${labels.sources}**`, "");
        for (const n of numbers) {
          lines.push(citationLine(n, message.citations?.[n - 1], options));
        }
      }
      if (message.modelUsed) lines.push("", `_${labels.aiLabel}: ${message.modelUsed}_`);
    }
  }
  return `${lines.join("\n")}\n`;
}
