import { type Page, type Route, expect, test } from "@playwright/test";
import { findLayoutProblems } from "./helpers.js";

/**
 * Kommentare an Quellen mit Erwähnungen (Issue #353), nur mit Tastatur bedient.
 * Der Worker wird durch einen Speicher im Test ersetzt; die Rechte- und Validierungslogik
 * des echten Workers prüft apps/worker/src/__tests__/comments-routes.test.ts.
 */

interface StoredComment {
  id: string;
  notebookId: string;
  targetType: string;
  targetId: string;
  author: { id: string; displayName: string };
  body: string;
  mentions: { id: string; displayName: string }[];
  createdAt: number;
  updatedAt: number;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const MEMBERS = [
  { id: "u_me", displayName: "Tim Hansen" },
  { id: "u_bob", displayName: "Bob Berg" },
  { id: "u_bea", displayName: "Bea Brandt" }
];

async function mockCommentsApi(page: Page) {
  const store: StoredComment[] = [];
  const posted: Record<string, unknown>[] = [];
  let seq = 0;
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/v1/notebooks/*/members", (route) =>
    json(route, 200, { members: MEMBERS })
  );
  await page.route("**/api/v1/notebooks/*/comments**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const parts = url.pathname.split("/");
    const notebookId = parts[4] as string;
    const commentId = parts[6];
    if (req.method() === "GET") {
      const targetId = url.searchParams.get("targetId");
      return json(route, 200, { comments: store.filter((c) => c.targetId === targetId) });
    }
    const body = (req.postDataJSON() ?? {}) as {
      body?: string;
      mentions?: string[];
      targetType?: string;
      targetId?: string;
    };
    const mentions = (body.mentions ?? []).map((id) => MEMBERS.find((m) => m.id === id));
    if (req.method() === "POST") {
      posted.push(body);
      const now = Date.now();
      const comment: StoredComment = {
        id: `cmt_${++seq}`,
        notebookId,
        targetType: body.targetType as string,
        targetId: body.targetId as string,
        author: MEMBERS[0] as StoredComment["author"],
        body: body.body as string,
        mentions: mentions as StoredComment["mentions"],
        createdAt: now,
        updatedAt: now,
        edited: false,
        canEdit: true,
        canDelete: true
      };
      store.push(comment);
      return json(route, 201, comment);
    }
    const index = store.findIndex((c) => c.id === commentId);
    const existing = store[index] as StoredComment;
    if (req.method() === "PATCH") {
      Object.assign(existing, {
        body: body.body,
        mentions,
        edited: true,
        updatedAt: existing.createdAt + 1000
      });
      return json(route, 200, existing);
    }
    store.splice(index, 1);
    return route.fulfill({ status: 204 });
  });
  return { store, posted };
}

async function openSourceComments(page: Page) {
  await page.getByTestId("btn-inspect-source-src_1").click();
  const thread = page.getByTestId("comments-source-src_1");
  const toggle = thread.getByTestId("btn-toggle-comments");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return thread;
}

test.describe("Kommentare an Quellen (Issue #353)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("schreibt, erwähnt, bearbeitet und löscht nur mit der Tastatur", async ({ page }) => {
    const api = await mockCommentsApi(page);
    await page.goto("/");
    const thread = await openSourceComments(page);
    await expect(thread.getByTestId("comments-empty")).toHaveText("Noch keine Kommentare.");

    const input = thread.getByTestId("comment-input");
    await expect(input).toHaveAccessibleName("Kommentar schreiben");
    await expect(input).toHaveAttribute("role", "combobox");
    await input.focus();
    await page.keyboard.type("Bitte gegenlesen, @B");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const options = thread.getByTestId("comment-input-mentions").getByRole("option");
    await expect(options).toHaveText(["Bob Berg", "Bea Brandt"]);
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    const activeId = await options.nth(1).getAttribute("id");
    await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("Bitte gegenlesen, @Bea Brandt ");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.type("danke.");
    await page.keyboard.press("Control+Enter");

    const item = thread.getByTestId("comment-cmt_1");
    await expect(item).toContainText("Bitte gegenlesen, @Bea Brandt danke.");
    await expect(item.locator(".rn-comment-mention")).toHaveText("@Bea Brandt");
    await expect(thread.getByTestId("comments-status")).toHaveText("Kommentar gespeichert.");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    expect(api.posted[0]).toEqual({
      targetType: "source",
      targetId: "src_1",
      body: "Bitte gegenlesen, @Bea Brandt danke.",
      mentions: ["u_bea"]
    });

    // Bearbeiten: Fokus ins Feld, Speichern führt zurück auf den Knopf
    const edit = thread.getByTestId("btn-edit-comment-cmt_1");
    await expect(edit).toHaveAccessibleName("Kommentar von Tim Hansen bearbeiten");
    await edit.focus();
    await page.keyboard.press("Enter");
    const editInput = thread.getByTestId("comment-edit-input");
    await expect(editInput).toBeFocused();
    await editInput.fill("Erledigt.");
    await page.keyboard.press("Control+Enter");
    await expect(item).toContainText("Erledigt.");
    await expect(item).toContainText("bearbeitet");
    await expect(edit).toBeFocused();

    // Escape bricht das Bearbeiten ab
    await page.keyboard.press("Enter");
    await expect(editInput).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editInput).toHaveCount(0);
    await expect(edit).toBeFocused();

    // Löschen mit Rückfrage
    await thread.getByTestId("btn-delete-comment-cmt_1").focus();
    await page.keyboard.press("Enter");
    const confirm = thread.getByTestId("btn-confirm-delete-cmt_1");
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAccessibleDescription("Diesen Kommentar endgültig löschen?");
    await page.keyboard.press("Enter");
    await expect(thread.getByTestId("comments-status")).toHaveText("Kommentar gelöscht.");
    await expect(thread.getByTestId("comments-empty")).toBeVisible();
    await expect(input).toBeFocused();
    expect(api.store).toHaveLength(0);

    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("Escape schließt nur die Vorschläge, Erwähnungen ohne Treffer werden angesagt", async ({
    page
  }) => {
    await mockCommentsApi(page);
    await page.goto("/");
    const thread = await openSourceComments(page);
    const input = thread.getByTestId("comment-input");
    await input.focus();
    await page.keyboard.type("@zz");
    await expect(thread.getByText("Keine passende Person mit Zugriff.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveValue("@zz");
    await expect(page.getByTestId("source-inspector-drawer")).toBeVisible();
  });

  test("zeigt ohne Anmeldung einen klaren Hinweis statt eines Eingabefelds", async ({ page }) => {
    await page.route("**/api/v1/notebooks/*/comments**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 401, title: "Unauthorized", detail: "x" })
      })
    );
    await page.route("**/api/v1/notebooks/*/members", (route) => route.fulfill({ status: 401 }));
    await page.goto("/");
    const thread = await openSourceComments(page);
    await expect(thread.getByTestId("comments-load-error")).toHaveText(
      "Bitte melden Sie sich an, um Kommentare zu lesen und zu schreiben."
    );
    await expect(thread.getByTestId("comment-input")).toHaveCount(0);
  });

  test("meldet fehlende Schreibrechte und behält den Text (Englisch)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.route("**/api/v1/notebooks/*/members", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"members":[]}' })
    );
    await page.route("**/api/v1/notebooks/*/comments**", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "application/json", body: '{"comments":[]}' })
        : route.fulfill({ status: 403, contentType: "application/problem+json", body: "{}" })
    );
    await page.goto("/");
    await page.getByTestId("btn-inspect-source-src_1").click();
    const thread = page.getByTestId("comments-source-src_1");
    await thread.getByRole("button", { name: "Show comments" }).click();
    const input = thread.getByRole("combobox", { name: "Write a comment" });
    await input.fill("Looks good");
    await thread.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(thread.getByTestId("comments-action-error")).toContainText(
      "You lack the rights for this in this notebook."
    );
    await expect(input).toHaveValue("Looks good");
  });
});
