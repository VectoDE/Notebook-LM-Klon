import {
  CommentListQuerySchema,
  type CommentPerson,
  type CommentTargetType,
  CreateCommentBodySchema,
  type NotebookComment,
  UpdateCommentBodySchema,
  createProblemDetails
} from "@notebook-lm/shared";
import type { Context, Hono } from "hono";
import { requireAuth, requireNotebookRole } from "./auth-middleware.js";
import type { CoreRepository, DatabaseAdapter } from "./core-repository.js";
import { type NotebookRole, resolveNotebookRole } from "./route-guards.js";

/**
 * Kommentare an Quellen und Notizen mit Erwähnungen (Issue #353).
 *
 * Rechte (Rolle im Notebook, aufgelöst wie bei allen Notebook-Routen):
 * - Lesen (Liste, Mitglieder, eigene Erwähnungen): viewer
 * - Schreiben: editor
 * - Bearbeiten: editor und Verfasser des Kommentars
 * - Löschen: Verfasser oder Eigentümer des Notebooks (owner)
 *
 * Kommentare sind immer an ein Notebook gebunden: Ziel und Kommentar-ID werden gegen das
 * Notebook aus dem Pfad geprüft, damit über fremde IDs nichts gelesen oder geändert wird.
 * Erwähnt werden können nur Personen, die selbst Zugriff auf das Notebook haben.
 */

export interface CommentRoutesDependencies {
  readonly coreRepo: CoreRepository;
}

type CommentsApp = Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

interface CommentRow {
  id: string;
  notebook_id: string;
  target_type: CommentTargetType;
  target_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: number;
  updated_at: number;
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
} as const;

/** Höchstzahl Kommentare je Ziel in einer Antwort. */
export const COMMENT_LIST_LIMIT = 200;
/** Höchstzahl Einträge in der Liste der eigenen Erwähnungen. */
export const MENTION_LIST_LIMIT = 50;

function problem(
  c: Context,
  status: 400 | 403 | 404 | 422,
  title: string,
  detail: string,
  code: string,
  errors?: { field: string; message: string }[]
): Response {
  return c.json(
    createProblemDetails({
      status,
      title,
      detail,
      instance: c.req.path,
      code,
      ...(errors ? { errors } : {})
    }),
    status,
    PROBLEM_HEADERS
  );
}

/** Fehlerform der Zod-Ergebnisse (ohne Zod als direkte Abhängigkeit des Workers). */
interface ValidationIssues {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}

function validationProblem(c: Context, error: ValidationIssues, detail: string): Response {
  const errors = error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "body",
    message: issue.message
  }));
  return problem(c, 422, "Unprocessable Content", detail, "VALIDATION_ERROR", errors);
}

async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function invalidJson(c: Context): Response {
  return problem(c, 400, "Bad Request", "Ungültiges JSON im Request-Body.", "INVALID_JSON");
}

/** Personen mit Zugriff auf das Notebook: Workspace-Mitglieder und direkte Freigaben. */
export async function listNotebookMembers(
  db: DatabaseAdapter,
  notebookId: string
): Promise<CommentPerson[]> {
  const rows = await db.query<{ id: string; display_name: string }>(
    `SELECT u.id AS id, u.display_name AS display_name
       FROM users u
      WHERE u.deleted_at IS NULL
        AND (
          u.id IN (SELECT wm.user_id FROM workspace_members wm
                     JOIN notebooks n ON n.workspace_id = wm.workspace_id
                    WHERE n.id = ?)
          OR u.id IN (SELECT ns.user_id FROM notebook_shares ns
                       WHERE ns.notebook_id = ? AND ns.user_id IS NOT NULL)
        )
      ORDER BY u.display_name COLLATE NOCASE, u.id`,
    [notebookId, notebookId]
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

async function targetExists(
  db: DatabaseAdapter,
  notebookId: string,
  targetType: CommentTargetType,
  targetId: string
): Promise<boolean> {
  const table = targetType === "source" ? "sources" : "notes";
  const row = await db.queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ? AND notebook_id = ?`,
    [targetId, notebookId]
  );
  return row !== null;
}

async function loadMentions(
  db: DatabaseAdapter,
  commentIds: readonly string[]
): Promise<Map<string, CommentPerson[]>> {
  const byComment = new Map<string, CommentPerson[]>();
  if (commentIds.length === 0) return byComment;
  const placeholders = commentIds.map(() => "?").join(", ");
  const rows = await db.query<{ comment_id: string; id: string; display_name: string }>(
    `SELECT m.comment_id AS comment_id, u.id AS id, u.display_name AS display_name
       FROM comment_mentions m JOIN users u ON u.id = m.user_id
      WHERE m.comment_id IN (${placeholders}) AND u.deleted_at IS NULL
      ORDER BY u.display_name COLLATE NOCASE, u.id`,
    [...commentIds]
  );
  for (const row of rows) {
    const list = byComment.get(row.comment_id) ?? [];
    list.push({ id: row.id, displayName: row.display_name });
    byComment.set(row.comment_id, list);
  }
  return byComment;
}

const COMMENT_SELECT = `SELECT c.id, c.notebook_id, c.target_type, c.target_id, c.author_id,
         u.display_name AS author_name, c.body, c.created_at, c.updated_at
    FROM comments c LEFT JOIN users u ON u.id = c.author_id AND u.deleted_at IS NULL`;

function toDto(
  row: CommentRow,
  mentions: Map<string, CommentPerson[]>,
  viewerId: string,
  viewerRole: NotebookRole
): NotebookComment {
  const isAuthor = row.author_id === viewerId;
  return {
    id: row.id,
    notebookId: row.notebook_id,
    targetType: row.target_type,
    targetId: row.target_id,
    author: { id: row.author_id, displayName: row.author_name ?? "" },
    body: row.body,
    mentions: mentions.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edited: row.updated_at > row.created_at,
    canEdit: isAuthor && viewerRole !== "viewer",
    canDelete: isAuthor || viewerRole === "owner"
  };
}

async function loadComment(
  db: DatabaseAdapter,
  notebookId: string,
  commentId: string
): Promise<CommentRow | null> {
  return db.queryOne<CommentRow>(`${COMMENT_SELECT} WHERE c.id = ? AND c.notebook_id = ?`, [
    commentId,
    notebookId
  ]);
}

/** Prüft, dass jede erwähnte Person Zugriff auf das Notebook hat; liefert die fremden IDs. */
async function findInvalidMentions(
  db: DatabaseAdapter,
  notebookId: string,
  mentionIds: readonly string[]
): Promise<string[]> {
  if (mentionIds.length === 0) return [];
  const members = new Set((await listNotebookMembers(db, notebookId)).map((m) => m.id));
  return mentionIds.filter((id) => !members.has(id));
}

async function replaceMentions(
  db: DatabaseAdapter,
  commentId: string,
  mentionIds: readonly string[]
): Promise<void> {
  await db.run("DELETE FROM comment_mentions WHERE comment_id = ?", [commentId]);
  for (const userId of mentionIds) {
    await db.run("INSERT INTO comment_mentions (comment_id, user_id) VALUES (?, ?)", [
      commentId,
      userId
    ]);
  }
}

function invalidMentionsProblem(c: Context, invalid: readonly string[]): Response {
  return problem(
    c,
    422,
    "Unprocessable Content",
    "Erwähnt werden können nur Personen mit Zugriff auf dieses Notebook.",
    "INVALID_MENTION",
    invalid.map((id) => ({ field: "mentions", message: `Keine Person mit Zugriff: ${id}` }))
  );
}

function commentNotFound(c: Context): Response {
  return problem(c, 404, "Not Found", "Kommentar wurde nicht gefunden.", "COMMENT_NOT_FOUND");
}

async function respondWithComment(
  c: Context,
  db: DatabaseAdapter,
  notebookId: string,
  commentId: string,
  viewerId: string,
  role: NotebookRole,
  status: 200 | 201
): Promise<Response> {
  const row = (await loadComment(db, notebookId, commentId)) as CommentRow;
  const mentions = await loadMentions(db, [row.id]);
  return c.json(toDto(row, mentions, viewerId, role), status, JSON_HEADERS);
}

export function registerCommentRoutes(app: CommentsApp, deps: CommentRoutesDependencies): void {
  const { coreRepo } = deps;
  const db = coreRepo.db;
  const auth = requireAuth();
  const viewer = requireNotebookRole(coreRepo, "viewer", "id");
  const editor = requireNotebookRole(coreRepo, "editor", "id");

  /** Rolle des angemeldeten Nutzers; die Guards davor stellen sicher, dass es eine gibt. */
  const roleOf = async (notebookId: string, userId: string) =>
    (await resolveNotebookRole(coreRepo, notebookId, userId)) as NotebookRole;

  app.get("/api/v1/notebooks/:id/members", auth, viewer, async (c) => {
    const members = await listNotebookMembers(db, c.req.param("id"));
    return c.json({ members }, 200, JSON_HEADERS);
  });

  app.get("/api/v1/notebooks/:id/comments", auth, viewer, async (c) => {
    const notebookId = c.req.param("id");
    const user = c.get("sessionUser") as { id: string };
    const parsed = CommentListQuerySchema.safeParse({
      targetType: c.req.query("targetType"),
      targetId: c.req.query("targetId")
    });
    if (!parsed.success) {
      return validationProblem(c, parsed.error, "Ungültige Parameter für die Kommentarliste.");
    }
    const { targetType, targetId } = parsed.data;
    const rows = await db.query<CommentRow>(
      `${COMMENT_SELECT}
        WHERE c.notebook_id = ? AND c.target_type = ? AND c.target_id = ?
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT ${COMMENT_LIST_LIMIT}`,
      [notebookId, targetType, targetId]
    );
    const mentions = await loadMentions(
      db,
      rows.map((r) => r.id)
    );
    const role = await roleOf(notebookId, user.id);
    return c.json(
      { comments: rows.map((row) => toDto(row, mentions, user.id, role)) },
      200,
      JSON_HEADERS
    );
  });

  app.get("/api/v1/notebooks/:id/mentions", auth, viewer, async (c) => {
    const notebookId = c.req.param("id");
    const user = c.get("sessionUser") as { id: string };
    const rows = await db.query<CommentRow>(
      `${COMMENT_SELECT}
        JOIN comment_mentions cm ON cm.comment_id = c.id
        WHERE c.notebook_id = ? AND cm.user_id = ?
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${MENTION_LIST_LIMIT}`,
      [notebookId, user.id]
    );
    const mentions = await loadMentions(
      db,
      rows.map((r) => r.id)
    );
    const role = await roleOf(notebookId, user.id);
    return c.json(
      { comments: rows.map((row) => toDto(row, mentions, user.id, role)) },
      200,
      JSON_HEADERS
    );
  });

  app.post("/api/v1/notebooks/:id/comments", auth, editor, async (c) => {
    const notebookId = c.req.param("id");
    const user = c.get("sessionUser") as { id: string };
    const raw = await readJson(c);
    if (!raw.ok) return invalidJson(c);
    const parsed = CreateCommentBodySchema.safeParse(raw.value);
    if (!parsed.success) {
      return validationProblem(c, parsed.error, "Validierungsfehler beim Kommentar.");
    }
    const { targetType, targetId, body, mentions } = parsed.data;
    if (!(await targetExists(db, notebookId, targetType, targetId))) {
      return problem(
        c,
        404,
        "Not Found",
        targetType === "source" ? "Quelle wurde nicht gefunden." : "Notiz wurde nicht gefunden.",
        "COMMENT_TARGET_NOT_FOUND"
      );
    }
    const invalid = await findInvalidMentions(db, notebookId, mentions);
    if (invalid.length > 0) return invalidMentionsProblem(c, invalid);

    const id = `cmt_${crypto.randomUUID()}`;
    const now = Date.now();
    await db.run(
      `INSERT INTO comments (id, notebook_id, target_type, target_id, author_id, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, notebookId, targetType, targetId, user.id, body, now, now]
    );
    await replaceMentions(db, id, mentions);
    const role = await roleOf(notebookId, user.id);
    return respondWithComment(c, db, notebookId, id, user.id, role, 201);
  });

  app.patch("/api/v1/notebooks/:id/comments/:commentId", auth, editor, async (c) => {
    const notebookId = c.req.param("id");
    const commentId = c.req.param("commentId");
    const user = c.get("sessionUser") as { id: string };
    const existing = await loadComment(db, notebookId, commentId);
    if (!existing) return commentNotFound(c);
    if (existing.author_id !== user.id) {
      return problem(
        c,
        403,
        "Forbidden",
        "Nur die Verfasserin oder der Verfasser darf den Kommentar bearbeiten.",
        "NOT_COMMENT_AUTHOR"
      );
    }
    const raw = await readJson(c);
    if (!raw.ok) return invalidJson(c);
    const parsed = UpdateCommentBodySchema.safeParse(raw.value);
    if (!parsed.success) {
      return validationProblem(c, parsed.error, "Validierungsfehler beim Kommentar.");
    }
    const { body, mentions } = parsed.data;
    const invalid = await findInvalidMentions(db, notebookId, mentions);
    if (invalid.length > 0) return invalidMentionsProblem(c, invalid);

    // Mindestens eine Millisekunde nach dem Anlegen, damit "bearbeitet" sicher erkannt wird.
    const now = Math.max(Date.now(), existing.created_at + 1);
    await db.run("UPDATE comments SET body = ?, updated_at = ? WHERE id = ?", [
      body,
      now,
      commentId
    ]);
    await replaceMentions(db, commentId, mentions);
    const role = await roleOf(notebookId, user.id);
    return respondWithComment(c, db, notebookId, commentId, user.id, role, 200);
  });

  app.delete("/api/v1/notebooks/:id/comments/:commentId", auth, viewer, async (c) => {
    const notebookId = c.req.param("id");
    const commentId = c.req.param("commentId");
    const user = c.get("sessionUser") as { id: string };
    const existing = await loadComment(db, notebookId, commentId);
    if (!existing) return commentNotFound(c);
    const role = await roleOf(notebookId, user.id);
    if (existing.author_id !== user.id && role !== "owner") {
      return problem(
        c,
        403,
        "Forbidden",
        "Löschen dürfen nur Verfasser und Eigentümer des Notebooks.",
        "NOT_COMMENT_AUTHOR"
      );
    }
    await db.run("DELETE FROM comments WHERE id = ?", [commentId]);
    return c.body(null, 204);
  });
}
