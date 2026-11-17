/**
 * Kommentare an Quellen und Notizen (Issue #353): Aufrufe gegen den Worker.
 *
 * Jeder Aufruf liefert ein Ergebnis statt zu werfen, damit die Oberfläche Fehlerzustände
 * (nicht angemeldet, keine Rechte, Ratenbegrenzung, Netzfehler) gezielt anzeigen kann.
 */
import type { CommentPerson, CommentTargetType, NotebookComment } from "@notebook-lm/shared";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Fehlerarten, die die Oberfläche unterscheidet. */
export type CommentErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "rate-limited"
  | "network"
  | "server";

export type CommentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CommentErrorKind; readonly status: number };

export interface CommentTarget {
  readonly notebookId: string;
  readonly targetType: CommentTargetType;
  readonly targetId: string;
}

/** HTTP-Status in eine Fehlerart. */
export function errorKindForStatus(status: number): CommentErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 400 || status === 422) return "invalid";
  if (status === 429) return "rate-limited";
  return "server";
}

const nbPath = (notebookId: string) => `/api/v1/notebooks/${encodeURIComponent(notebookId)}`;

async function request<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>
): Promise<CommentResult<T>> {
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: "same-origin", ...init });
  } catch {
    return { ok: false, error: "network", status: 0 };
  }
  if (!res.ok) return { ok: false, error: errorKindForStatus(res.status), status: res.status };
  try {
    return { ok: true, value: await read(res) };
  } catch {
    return { ok: false, error: "server", status: res.status };
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  };
}

export function listComments(
  fetchFn: FetchLike,
  target: CommentTarget
): Promise<CommentResult<NotebookComment[]>> {
  const query = new URLSearchParams({ targetType: target.targetType, targetId: target.targetId });
  return request(
    fetchFn,
    `${nbPath(target.notebookId)}/comments?${query.toString()}`,
    { headers: { accept: "application/json" } },
    async (res) => ((await res.json()) as { comments: NotebookComment[] }).comments
  );
}

export function listMembers(
  fetchFn: FetchLike,
  notebookId: string
): Promise<CommentResult<CommentPerson[]>> {
  return request(
    fetchFn,
    `${nbPath(notebookId)}/members`,
    { headers: { accept: "application/json" } },
    async (res) => ((await res.json()) as { members: CommentPerson[] }).members
  );
}

export function createComment(
  fetchFn: FetchLike,
  target: CommentTarget,
  body: string,
  mentions: readonly string[]
): Promise<CommentResult<NotebookComment>> {
  return request(
    fetchFn,
    `${nbPath(target.notebookId)}/comments`,
    jsonInit("POST", { targetType: target.targetType, targetId: target.targetId, body, mentions }),
    async (res) => (await res.json()) as NotebookComment
  );
}

export function updateComment(
  fetchFn: FetchLike,
  notebookId: string,
  commentId: string,
  body: string,
  mentions: readonly string[]
): Promise<CommentResult<NotebookComment>> {
  return request(
    fetchFn,
    `${nbPath(notebookId)}/comments/${encodeURIComponent(commentId)}`,
    jsonInit("PATCH", { body, mentions }),
    async (res) => (await res.json()) as NotebookComment
  );
}

export function deleteComment(
  fetchFn: FetchLike,
  notebookId: string,
  commentId: string
): Promise<CommentResult<true>> {
  return request(
    fetchFn,
    `${nbPath(notebookId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
    async () => true as const
  );
}

/** Übersetzungsschlüssel für eine Fehlerart. */
export function commentErrorKey(kind: CommentErrorKind): string {
  const keys: Record<CommentErrorKind, string> = {
    unauthorized: "cmtErrUnauthorized",
    forbidden: "cmtErrForbidden",
    "not-found": "cmtErrNotFound",
    invalid: "cmtErrInvalid",
    "rate-limited": "cmtErrRateLimited",
    network: "cmtErrNetwork",
    server: "cmtErrServer"
  };
  return keys[kind];
}
