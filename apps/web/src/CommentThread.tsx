/**
 * Kommentar-Faden zu einer Quelle oder Notiz mit Erwähnungen (Issue #353).
 *
 * Barrierefreiheit:
 * - Aufklappknopf mit aria-expanded/aria-controls; geladen wird erst beim Öffnen.
 * - Eingabefeld als Combobox (ARIA 1.2) mit Liste der Personen: Pfeiltasten wählen,
 *   Enter oder Tab übernimmt, Escape schließt; Strg/Cmd+Enter sendet.
 * - Ergebnisse (gespeichert, gelöscht) über eine Statusregion, Fehler über role="alert".
 * - Bei anderem Ziel bitte mit key={targetId} neu einhängen (der Faden lädt einmal je Ziel).
 * - Fokus bleibt nachvollziehbar: Bearbeiten setzt ihn ins Feld, Abbrechen und Speichern
 *   zurück auf den Bearbeiten-Knopf, nach dem Löschen auf das Eingabefeld.
 */
import {
  type CommentPerson,
  type CommentTargetType,
  type MentionQuery,
  type NotebookComment,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  resolveMentionIds
} from "@notebook-lm/shared";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import {
  type CommentErrorKind,
  type FetchLike,
  commentErrorKey,
  createComment,
  deleteComment,
  listComments,
  listMembers,
  updateComment
} from "./comments-client.js";
import { commentTexts } from "./translations-comments.js";
import { fill, useTheme } from "./useTheme.js";

export interface CommentThreadProps {
  readonly notebookId: string;
  readonly targetType: CommentTargetType;
  readonly targetId: string;
  /** Titel der Quelle oder Notiz für zugängliche Namen. */
  readonly targetTitle: string;
  readonly fetchFn?: FetchLike | undefined;
  /** Für Tests und Vorschau: Faden direkt geöffnet zeigen. */
  readonly defaultOpen?: boolean | undefined;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/** Texte der Kommentare in der Sprache der Oberfläche (eigener Katalog, siehe translations-comments.ts). */
function useCommentText() {
  const { language } = useTheme();
  const texts = commentTexts(language);
  const t = (key: string): string => texts[key] ?? key;
  const tf = (key: string, vars: Readonly<Record<string, string | number>>): string =>
    fill(t(key), vars);
  return { t, tf, language };
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** Text mit hervorgehobenen Erwähnungen; React maskiert alle Inhalte. */
export function renderCommentBody(body: string, mentions: readonly CommentPerson[]): ReactNode[] {
  const names = mentions
    .map((m) => `@${m.displayName}`)
    .filter((n) => n.length > 1)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [body];
  const parts: ReactNode[] = [];
  let rest = body;
  let key = 0;
  while (rest.length > 0) {
    let hit = -1;
    let name = "";
    for (const candidate of names) {
      const at = rest.indexOf(candidate);
      if (at >= 0 && (hit < 0 || at < hit)) {
        hit = at;
        name = candidate;
      }
    }
    if (hit < 0) {
      parts.push(rest);
      break;
    }
    if (hit > 0) parts.push(rest.slice(0, hit));
    parts.push(
      <strong key={`m${key++}`} className="rn-comment-mention">
        {name}
      </strong>
    );
    rest = rest.slice(hit + name.length);
  }
  return parts;
}

interface MentionFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly members: readonly CommentPerson[];
  readonly disabled: boolean;
  readonly describedBy?: string | undefined;
  readonly fieldRef: RefObject<HTMLTextAreaElement | null>;
  readonly onChange: (value: string, picked?: CommentPerson) => void;
  readonly onSubmit: () => void;
  readonly onEscape?: (() => void) | undefined;
  readonly testId: string;
}

/** Mehrzeiliges Feld mit @-Vorschlägen (Combobox mit Listbox). */
function MentionField({
  id,
  label,
  value,
  members,
  disabled,
  describedBy,
  fieldRef,
  onChange,
  onSubmit,
  onEscape,
  testId
}: MentionFieldProps) {
  const { t, tf } = useCommentText();
  const listId = `${id}-mentions`;
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const candidates = mention ? filterMentionCandidates(members, mention.query) : [];
  const open = mention !== null;

  const update = (text: string, caret: number) => {
    const next = findMentionQuery(text, caret);
    setMention(next);
    setActive(0);
    onChange(text);
  };

  const pick = (person: CommentPerson) => {
    const field = fieldRef.current;
    if (!mention || !field) return;
    const result = insertMention(
      value,
      mention,
      field.selectionStart ?? value.length,
      person.displayName
    );
    setMention(null);
    onChange(result.text, person);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(result.caret, result.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(candidates[active] as CommentPerson);
        return;
      }
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        return;
      }
      onEscape?.();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  const activeId = open && candidates.length > 0 ? `${listId}-${active}` : undefined;

  return (
    <div className="rn-field rn-comment-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={fieldRef}
        className="rn-input rn-comment-input"
        rows={3}
        maxLength={4000}
        value={value}
        readOnly={disabled}
        aria-busy={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        data-testid={testId}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMention(null), 150)}
      />
      <div
        id={listId}
        // biome-ignore lint/a11y/useSemanticElements: Combobox-Muster mit aria-activedescendant; ein natives select bietet keine Vorschläge zu einem Textfeld an
        role="listbox"
        tabIndex={-1}
        aria-label={t("cmtMentionList")}
        className="rn-comment-mentions"
        hidden={!open}
        data-testid={`${testId}-mentions`}
      >
        {candidates.map((person, index) => (
          <div
            key={person.id}
            id={`${listId}-${index}`}
            // biome-ignore lint/a11y/useSemanticElements: Option der Listbox oben, der Fokus bleibt im Textfeld (aria-activedescendant)
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className="rn-comment-mention-option"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(person);
            }}
          >
            {person.displayName}
          </div>
        ))}
        {open && candidates.length === 0 && (
          <p className="rn-comment-mention-none">{t("cmtMentionNone")}</p>
        )}
      </div>
      <span className="rn-visually-hidden" aria-live="polite">
        {open && candidates.length > 0 ? tf("cmtMentionOptions", { n: candidates.length }) : ""}
      </span>
    </div>
  );
}

export function CommentThread({
  notebookId,
  targetType,
  targetId,
  targetTitle,
  fetchFn = defaultFetch,
  defaultOpen = false
}: CommentThreadProps) {
  const { t, tf, language } = useCommentText();
  const baseId = useId();
  const regionId = `${baseId}-region`;
  const hintId = `${baseId}-hint`;
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<CommentErrorKind | null>(null);
  const [comments, setComments] = useState<NotebookComment[]>([]);
  const [members, setMembers] = useState<CommentPerson[]>([]);
  const [draft, setDraft] = useState("");
  const [draftPicked, setDraftPicked] = useState<CommentPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<CommentErrorKind | null>(null);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editPicked, setEditPicked] = useState<CommentPerson[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const target = { notebookId, targetType, targetId };

  const load = useCallback(async () => {
    setState("loading");
    setLoadError(null);
    const t0 = { notebookId, targetType, targetId };
    const [list, people] = await Promise.all([
      listComments(fetchFn, t0),
      listMembers(fetchFn, notebookId)
    ]);
    if (!list.ok) {
      setLoadError(list.error);
      setState("error");
      return;
    }
    setComments(list.value);
    setMembers(people.ok ? people.value : []);
    setState("ready");
  }, [fetchFn, notebookId, targetType, targetId]);

  useEffect(() => {
    if (open && state === "idle") void load();
  }, [open, state, load]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (confirmDeleteId) confirmRef.current?.focus();
  }, [confirmDeleteId]);

  const formatTime = (ms: number) =>
    new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(ms);

  const submit = async () => {
    const body = draft.trim();
    if (body.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await createComment(fetchFn, target, body, resolveMentionIds(body, draftPicked));
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setComments((list) => [...list, result.value]);
    setDraft("");
    setDraftPicked([]);
    setStatus(t("cmtAdded"));
    composerRef.current?.focus();
  };

  const startEdit = (comment: NotebookComment) => {
    setEditingId(comment.id);
    setEditText(comment.body);
    setEditPicked(comment.mentions);
    setConfirmDeleteId(null);
    setActionError(null);
  };

  const endEdit = (commentId: string) => {
    setEditingId(null);
    requestAnimationFrame(() => editButtons.current.get(commentId)?.focus());
  };

  const saveEdit = async (comment: NotebookComment) => {
    const body = editText.trim();
    if (body.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await updateComment(
      fetchFn,
      notebookId,
      comment.id,
      body,
      resolveMentionIds(body, editPicked)
    );
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setComments((list) => list.map((c) => (c.id === comment.id ? result.value : c)));
    setStatus(t("cmtUpdated"));
    endEdit(comment.id);
  };

  const remove = async (comment: NotebookComment) => {
    setBusy(true);
    setActionError(null);
    const result = await deleteComment(fetchFn, notebookId, comment.id);
    setBusy(false);
    setConfirmDeleteId(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setComments((list) => list.filter((c) => c.id !== comment.id));
    setStatus(t("cmtDeleted"));
    composerRef.current?.focus();
  };

  const authorName = (comment: NotebookComment) =>
    comment.author.displayName || t("cmtUnknownAuthor");

  return (
    <div className="rn-comments" data-testid={`comments-${targetType}-${targetId}`}>
      <button
        type="button"
        className="rn-btn rn-btn--ghost rn-btn--compact rn-comments-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        data-testid="btn-toggle-comments"
        onClick={() => setOpen((v) => !v)}
      >
        {t(open ? "cmtToggleHide" : "cmtToggleShow")}
        {state === "ready" && comments.length > 0 ? ` (${comments.length})` : ""}
      </button>

      <section
        id={regionId}
        hidden={!open}
        aria-label={tf("cmtListLabel", { title: targetTitle })}
        className="rn-comments-region"
      >
        <output className="rn-visually-hidden" data-testid="comments-status">
          {status}
        </output>

        {state === "loading" && (
          <p className="rn-comments-note" data-testid="comments-loading">
            {t("cmtLoading")}
          </p>
        )}

        {state === "error" && loadError && (
          <div role="alert" className="rn-comments-error" data-testid="comments-load-error">
            <p>{t(commentErrorKey(loadError))}</p>
            {loadError !== "unauthorized" && loadError !== "not-found" && (
              <button
                type="button"
                className="rn-btn rn-btn--secondary rn-btn--compact"
                onClick={() => void load()}
              >
                {t("cmtRetry")}
              </button>
            )}
          </div>
        )}

        {state === "ready" && (
          <>
            {comments.length === 0 ? (
              <p className="rn-comments-note" data-testid="comments-empty">
                {t("cmtEmpty")}
              </p>
            ) : (
              <ol className="rn-comment-list" data-testid="comment-list">
                {comments.map((comment) => (
                  <li key={comment.id} className="rn-comment" data-testid={`comment-${comment.id}`}>
                    <article aria-label={authorName(comment)}>
                      <header className="rn-comment-head">
                        <span className="rn-comment-author">{authorName(comment)}</span>{" "}
                        <time dateTime={new Date(comment.createdAt).toISOString()}>
                          {formatTime(comment.createdAt)}
                        </time>
                        {comment.edited && (
                          <span className="rn-comment-edited"> · {t("cmtEdited")}</span>
                        )}
                      </header>

                      {editingId === comment.id ? (
                        <form
                          className="rn-comment-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveEdit(comment);
                          }}
                        >
                          <MentionField
                            id={`${baseId}-edit-${comment.id}`}
                            label={t("cmtEditLabel")}
                            value={editText}
                            members={members}
                            disabled={busy}
                            describedBy={hintId}
                            fieldRef={editRef}
                            testId="comment-edit-input"
                            onChange={(text, picked) => {
                              setEditText(text);
                              if (picked) setEditPicked((list) => [...list, picked]);
                            }}
                            onSubmit={() => void saveEdit(comment)}
                            onEscape={() => endEdit(comment.id)}
                          />
                          <div className="rn-comment-actions">
                            <button
                              type="submit"
                              className="rn-btn rn-btn--primary rn-btn--compact"
                              disabled={busy || editText.trim().length === 0}
                              data-testid="btn-save-comment"
                            >
                              {t("cmtSave")}
                            </button>
                            <button
                              type="button"
                              className="rn-btn rn-btn--ghost rn-btn--compact"
                              onClick={() => endEdit(comment.id)}
                            >
                              {t("cmtCancel")}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="rn-comment-body">
                          {renderCommentBody(comment.body, comment.mentions)}
                        </p>
                      )}

                      {comment.mentions.length > 0 && editingId !== comment.id && (
                        <p className="rn-visually-hidden">
                          {tf("cmtMentionsOf", {
                            names: comment.mentions.map((m) => m.displayName).join(", ")
                          })}
                        </p>
                      )}

                      {editingId !== comment.id && (comment.canEdit || comment.canDelete) && (
                        <div className="rn-comment-actions">
                          {comment.canEdit && (
                            <button
                              type="button"
                              ref={(el) => {
                                if (el) editButtons.current.set(comment.id, el);
                                else editButtons.current.delete(comment.id);
                              }}
                              className="rn-btn rn-btn--ghost rn-btn--compact"
                              aria-label={tf("cmtEditAria", { name: authorName(comment) })}
                              data-testid={`btn-edit-comment-${comment.id}`}
                              onClick={() => startEdit(comment)}
                            >
                              {t("cmtEdit")}
                            </button>
                          )}
                          {comment.canDelete && confirmDeleteId !== comment.id && (
                            <button
                              type="button"
                              className="rn-btn rn-btn--ghost rn-btn--compact"
                              aria-label={tf("cmtDeleteAria", { name: authorName(comment) })}
                              data-testid={`btn-delete-comment-${comment.id}`}
                              onClick={() => setConfirmDeleteId(comment.id)}
                            >
                              {t("cmtDelete")}
                            </button>
                          )}
                          {confirmDeleteId === comment.id && (
                            <span className="rn-comment-confirm">
                              <span id={`${baseId}-confirm-${comment.id}`}>
                                {t("cmtDeleteConfirm")}
                              </span>
                              <button
                                type="button"
                                ref={confirmRef}
                                aria-describedby={`${baseId}-confirm-${comment.id}`}
                                className="rn-btn rn-btn--danger rn-btn--compact"
                                disabled={busy}
                                data-testid={`btn-confirm-delete-${comment.id}`}
                                onClick={() => void remove(comment)}
                              >
                                {t("cmtDelete")}
                              </button>
                              <button
                                type="button"
                                className="rn-btn rn-btn--ghost rn-btn--compact"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                {t("cmtCancel")}
                              </button>
                            </span>
                          )}
                        </div>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            )}

            <form
              className="rn-comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <MentionField
                id={`${baseId}-new`}
                label={t("cmtFieldLabel")}
                value={draft}
                members={members}
                disabled={busy}
                describedBy={hintId}
                fieldRef={composerRef}
                testId="comment-input"
                onChange={(text, picked) => {
                  setDraft(text);
                  if (picked) setDraftPicked((list) => [...list, picked]);
                }}
                onSubmit={() => void submit()}
              />
              <p id={hintId} className="rn-comments-hint">
                {t("cmtFieldHint")}
              </p>
              <button
                type="submit"
                className="rn-btn rn-btn--primary rn-btn--compact"
                disabled={busy || draft.trim().length === 0}
                data-testid="btn-send-comment"
              >
                {busy ? t("cmtSending") : t("cmtSend")}
              </button>
            </form>
          </>
        )}

        {actionError && (
          <p role="alert" className="rn-comments-error" data-testid="comments-action-error">
            {t(commentErrorKey(actionError))}
          </p>
        )}
      </section>
    </div>
  );
}
