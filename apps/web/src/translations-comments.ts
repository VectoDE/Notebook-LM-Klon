/**
 * Bedientexte der Kommentare (Issue #353), als Tripel [Schlüssel, Deutsch, Englisch].
 *
 * Eigene Datei und nicht im Hauptkatalog: Nur die nachgeladene Kommentar-Oberfläche
 * (CommentThread, siehe lazy-viewers.tsx) braucht sie, so bleiben sie aus dem Start-Bundle.
 */

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  ["cmtTitle", "Kommentare", "Comments"],
  ["cmtToggleShow", "Kommentare anzeigen", "Show comments"],
  ["cmtToggleHide", "Kommentare ausblenden", "Hide comments"],
  ["cmtListLabel", "Kommentare zu {title}", "Comments on {title}"],
  ["cmtLoading", "Kommentare werden geladen …", "Loading comments …"],
  ["cmtEmpty", "Noch keine Kommentare.", "No comments yet."],
  ["cmtFieldLabel", "Kommentar schreiben", "Write a comment"],
  [
    "cmtFieldHint",
    "Mit @ erwähnen Sie Personen, die Zugriff auf dieses Notebook haben. Strg+Enter sendet.",
    "Type @ to mention people with access to this notebook. Ctrl+Enter sends."
  ],
  ["cmtSend", "Kommentieren", "Comment"],
  ["cmtSending", "Wird gesendet …", "Sending …"],
  ["cmtEditAria", "Kommentar von {name} bearbeiten", "Edit comment by {name}"],
  ["cmtEditLabel", "Kommentar bearbeiten", "Edit comment"],
  ["cmtEdit", "Bearbeiten", "Edit"],
  ["cmtSave", "Speichern", "Save"],
  ["cmtCancel", "Abbrechen", "Cancel"],
  ["cmtDelete", "Löschen", "Delete"],
  ["cmtDeleteAria", "Kommentar von {name} löschen", "Delete comment by {name}"],
  ["cmtDeleteConfirm", "Diesen Kommentar endgültig löschen?", "Delete this comment permanently?"],
  ["cmtEdited", "bearbeitet", "edited"],
  ["cmtUnknownAuthor", "Gelöschtes Konto", "Deleted account"],
  ["cmtMentionList", "Personen zum Erwähnen", "People to mention"],
  ["cmtMentionNone", "Keine passende Person mit Zugriff.", "No matching person with access."],
  ["cmtMentionsOf", "Erwähnt: {names}", "Mentioned: {names}"],
  [
    "cmtMentionOptions",
    "Vorschläge: {n}. Pfeiltasten wählen, Enter übernimmt, Escape schließt.",
    "Suggestions: {n}. Arrow keys choose, Enter selects, Escape closes."
  ],
  ["cmtAdded", "Kommentar gespeichert.", "Comment saved."],
  ["cmtUpdated", "Kommentar geändert.", "Comment updated."],
  ["cmtDeleted", "Kommentar gelöscht.", "Comment deleted."],
  ["cmtRetry", "Erneut laden", "Reload"],
  [
    "cmtErrUnauthorized",
    "Bitte melden Sie sich an, um Kommentare zu lesen und zu schreiben.",
    "Please sign in to read and write comments."
  ],
  [
    "cmtErrForbidden",
    "Dafür fehlen Ihnen in diesem Notebook die Rechte. Lesen geht, Schreiben braucht die Rolle Bearbeiten.",
    "You lack the rights for this in this notebook. Reading works, writing needs the editor role."
  ],
  [
    "cmtErrNotFound",
    "Hier gibt es keine Kommentare: Notebook, Quelle oder Kommentar wurde nicht gefunden.",
    "No comments here: notebook, source or comment not found."
  ],
  [
    "cmtErrInvalid",
    "Der Kommentar ist leer, zu lang oder erwähnt jemanden ohne Zugriff.",
    "The comment is empty, too long or mentions someone without access."
  ],
  [
    "cmtErrRateLimited",
    "Zu viele Anfragen. Bitte warten Sie eine Minute.",
    "Too many requests. Please wait a minute."
  ],
  [
    "cmtErrNetwork",
    "Keine Verbindung zum Server. Ihr Text bleibt erhalten.",
    "No connection to the server. Your text is kept."
  ],
  [
    "cmtErrServer",
    "Der Server hat einen Fehler gemeldet. Bitte versuchen Sie es später erneut.",
    "The server reported an error. Please try again later."
  ]
];

function pick(index: 1 | 2): Readonly<Record<string, string>> {
  return Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[index]]));
}

export const COMMENTS_DE: Readonly<Record<string, string>> = pick(1);
export const COMMENTS_EN: Readonly<Record<string, string>> = pick(2);

/**
 * Katalog zur Sprache: Englisch für en und en-*, sonst Deutsch. Das entspricht dem Rückfall
 * des Hauptkatalogs (erst die Sprache selbst, dann de, dann en). Eine nachgeladene Variante wie
 * Leichte Sprache (de-x-ls, Issue #349) reicht ihre eigenen Texte als `own` herein; sie
 * ersetzen einzeln die deutschen, fehlende Schlüssel bleiben deutsch.
 */
export function commentTexts(
  language: string,
  own: Readonly<Record<string, string>> = {}
): Readonly<Record<string, string>> {
  if (language === "en" || language.startsWith("en-")) return COMMENTS_EN;
  const keys = Object.keys(COMMENTS_DE).filter((key) => own[key] !== undefined);
  if (keys.length === 0) return COMMENTS_DE;
  const merged: Record<string, string> = { ...COMMENTS_DE };
  for (const key of keys) merged[key] = own[key] as string;
  return merged;
}
