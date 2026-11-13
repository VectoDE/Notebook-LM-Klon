import { describe, expect, it, vi } from "vitest";
import {
  type FetchLike,
  commentErrorKey,
  createComment,
  deleteComment,
  errorKindForStatus,
  listComments,
  listMembers,
  updateComment
} from "../comments-client.js";

const target = { notebookId: "nb 1", targetType: "source" as const, targetId: "src/1" };

function respond(status: number, body?: unknown): FetchLike {
  return vi.fn(async () =>
    body === undefined ? new Response(null, { status }) : Response.json(body, { status })
  );
}

describe("comments-client (Issue #353)", () => {
  it("lists comments with encoded notebook id and query", async () => {
    const fetchFn = respond(200, { comments: [{ id: "c1" }] });
    const result = await listComments(fetchFn, target);
    expect(result).toEqual({ ok: true, value: [{ id: "c1" }] });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/v1/notebooks/nb%201/comments?targetType=source&targetId=src%2F1",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it("lists members", async () => {
    const result = await listMembers(
      respond(200, { members: [{ id: "a", displayName: "A" }] }),
      "nb"
    );
    expect(result).toEqual({ ok: true, value: [{ id: "a", displayName: "A" }] });
  });

  it("creates and updates comments with JSON bodies", async () => {
    const fetchFn = respond(201, { id: "c1" });
    expect(await createComment(fetchFn, target, "Hallo", ["a"])).toEqual({
      ok: true,
      value: { id: "c1" }
    });
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      targetType: "source",
      targetId: "src/1",
      body: "Hallo",
      mentions: ["a"]
    });

    const patch = respond(200, { id: "c1", body: "Neu" });
    expect(await updateComment(patch, "nb", "c 1", "Neu", [])).toEqual({
      ok: true,
      value: { id: "c1", body: "Neu" }
    });
    expect(patch).toHaveBeenCalledWith(
      "/api/v1/notebooks/nb/comments/c%201",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("deletes comments", async () => {
    expect(await deleteComment(respond(204), "nb", "c1")).toEqual({ ok: true, value: true });
  });

  it("maps HTTP errors, network errors and broken bodies to error kinds", async () => {
    expect(await listMembers(respond(401, {}), "nb")).toEqual({
      ok: false,
      error: "unauthorized",
      status: 401
    });
    const offline: FetchLike = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await listMembers(offline, "nb")).toEqual({ ok: false, error: "network", status: 0 });
    const broken: FetchLike = vi.fn(async () => new Response("kein json", { status: 200 }));
    expect(await listComments(broken, target)).toEqual({ ok: false, error: "server", status: 200 });
  });

  it("knows every status class and has a translation key per error kind", () => {
    expect([401, 403, 404, 400, 422, 429, 500, 503].map((s) => errorKindForStatus(s))).toEqual([
      "unauthorized",
      "forbidden",
      "not-found",
      "invalid",
      "invalid",
      "rate-limited",
      "server",
      "server"
    ]);
    for (const kind of [
      "unauthorized",
      "forbidden",
      "not-found",
      "invalid",
      "rate-limited",
      "network",
      "server"
    ] as const) {
      expect(commentErrorKey(kind)).toMatch(/^cmtErr/);
    }
  });
});
