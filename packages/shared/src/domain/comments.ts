import { z } from "zod";

/**
 * Kommentare an Quellen und Notizen mit Erwähnungen (Issue #353).
 *
 * Gemeinsame Schemas für Worker und Web-Client sowie reine Hilfsfunktionen für die
 * Erwähnungs-Eingabe (@Name). Erwähnt werden können nur Personen mit Zugriff auf das Notebook;
 * das prüft der Worker, der Client bietet nur diese Personen zur Auswahl an.
 */

export const COMMENT_TARGET_TYPES = ["source", "note"] as const;
export const CommentTargetTypeSchema = z.enum(COMMENT_TARGET_TYPES);
export type CommentTargetType = z.infer<typeof CommentTargetTypeSchema>;

/** Höchstlänge eines Kommentars in Zeichen. */
export const COMMENT_BODY_MAX_LENGTH = 4000;
/** Höchstzahl erwähnter Personen je Kommentar. */
export const COMMENT_MENTIONS_MAX = 20;
const ID_MAX_LENGTH = 128;

/** Steuerzeichen außer Tabulator, Zeilenvorschub und Wagenrücklauf. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden hier gezielt abgewiesen.
const FORBIDDEN_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const CommentBodyTextSchema = z
  .string()
  .trim()
  .min(1, "Kommentar darf nicht leer sein.")
  .max(COMMENT_BODY_MAX_LENGTH, `Kommentar ist länger als ${COMMENT_BODY_MAX_LENGTH} Zeichen.`)
  .refine((text) => !FORBIDDEN_CONTROL_CHARS.test(text), "Kommentar enthält Steuerzeichen.");

const IdSchema = z.string().trim().min(1).max(ID_MAX_LENGTH);

export const CommentMentionsSchema = z
  .array(IdSchema)
  .max(COMMENT_MENTIONS_MAX, `Höchstens ${COMMENT_MENTIONS_MAX} Erwähnungen je Kommentar.`)
  .default([])
  .transform((ids) => [...new Set(ids)]);

export const CreateCommentBodySchema = z.object({
  targetType: CommentTargetTypeSchema,
  targetId: IdSchema,
  body: CommentBodyTextSchema,
  mentions: CommentMentionsSchema
});
export type CreateCommentBody = z.infer<typeof CreateCommentBodySchema>;

export const UpdateCommentBodySchema = z.object({
  body: CommentBodyTextSchema,
  mentions: CommentMentionsSchema
});
export type UpdateCommentBody = z.infer<typeof UpdateCommentBodySchema>;

export const CommentListQuerySchema = z.object({
  targetType: CommentTargetTypeSchema,
  targetId: IdSchema
});
export type CommentListQuery = z.infer<typeof CommentListQuerySchema>;

export const CommentPersonSchema = z.object({
  id: z.string().min(1),
  displayName: z.string()
});
export type CommentPerson = z.infer<typeof CommentPersonSchema>;

export const NotebookCommentSchema = z.object({
  id: z.string().min(1),
  notebookId: z.string().min(1),
  targetType: CommentTargetTypeSchema,
  targetId: z.string().min(1),
  author: CommentPersonSchema,
  body: z.string(),
  mentions: z.array(CommentPersonSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  edited: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean()
});
export type NotebookComment = z.infer<typeof NotebookCommentSchema>;

/** Laufende Erwähnung an der Schreibmarke: Position des "@" und der bisher getippte Name. */
export interface MentionQuery {
  readonly start: number;
  readonly query: string;
}

/**
 * Findet eine begonnene Erwähnung direkt vor der Schreibmarke. Ein "@" zählt nur am Textanfang
 * oder nach Leerraum (so lösen E-Mail-Adressen keine Auswahl aus). Der Name darf Leerzeichen
 * enthalten, aber keinen Zeilenumbruch und kein weiteres "@", und höchstens 40 Zeichen lang sein.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const prev = at === 0 ? "" : before.charAt(at - 1);
  if (prev !== "" && !/\s/.test(prev)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n\r@]/.test(query)) return null;
  return { start: at, query };
}

/** Personen, deren Name mit der Eingabe beginnt oder sie enthält (ohne Groß-/Kleinschreibung). */
export function filterMentionCandidates(
  people: readonly CommentPerson[],
  query: string,
  excludeId?: string
): CommentPerson[] {
  const needle = query.trim().toLocaleLowerCase();
  const pool = people.filter((p) => p.id !== excludeId && p.displayName.length > 0);
  const starts = pool.filter((p) => p.displayName.toLocaleLowerCase().startsWith(needle));
  const contains = pool.filter(
    (p) => !starts.includes(p) && p.displayName.toLocaleLowerCase().includes(needle)
  );
  return [...starts, ...contains].slice(0, 8);
}

/** Ersetzt die begonnene Erwähnung durch "@Name " und liefert neuen Text und Schreibmarke. */
export function insertMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  displayName: string
): { text: string; caret: number } {
  const inserted = `@${displayName} `;
  const next = text.slice(0, mention.start) + inserted + text.slice(caret);
  return { text: next, caret: mention.start + inserted.length };
}

/**
 * IDs der ausgewählten Personen, deren "@Name" noch im Text steht. Wer aus dem Text gelöscht
 * wurde, wird nicht mehr erwähnt.
 */
export function resolveMentionIds(text: string, selected: readonly CommentPerson[]): string[] {
  const ids = selected
    .filter((p) => p.displayName.length > 0 && text.includes(`@${p.displayName}`))
    .map((p) => p.id);
  return [...new Set(ids)];
}
