import { describe, expect, it } from "vitest";
import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_MENTIONS_MAX,
  CreateCommentBodySchema,
  NotebookCommentSchema,
  UpdateCommentBodySchema,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  resolveMentionIds
} from "../index.js";

const people = [
  { id: "a", displayName: "Alice Adler" },
  { id: "b", displayName: "Bob Berg" },
  { id: "c", displayName: "Carla Bauer" },
  { id: "x", displayName: "" }
];

describe("Kommentar-Schemas (Issue #353)", () => {
  it("trims the body, deduplicates mentions and defaults them to an empty list", () => {
    const parsed = CreateCommentBodySchema.parse({
      targetType: "note",
      targetId: " n1 ",
      body: "  Hallo  ",
      mentions: ["a", "a", "b"]
    });
    expect(parsed).toEqual({
      targetType: "note",
      targetId: "n1",
      body: "Hallo",
      mentions: ["a", "b"]
    });
    expect(UpdateCommentBodySchema.parse({ body: "x" }).mentions).toEqual([]);
  });

  it("rejects empty, too long and control-character bodies and too many mentions", () => {
    const base = { targetType: "source", targetId: "s" };
    expect(CreateCommentBodySchema.safeParse({ ...base, body: " " }).success).toBe(false);
    expect(
      CreateCommentBodySchema.safeParse({ ...base, body: "a".repeat(COMMENT_BODY_MAX_LENGTH + 1) })
        .success
    ).toBe(false);
    expect(CreateCommentBodySchema.safeParse({ ...base, body: "a\u0007b" }).success).toBe(false);
    expect(CreateCommentBodySchema.safeParse({ ...base, body: "a\r\n\tb" }).success).toBe(true);
    const tooMany = Array.from({ length: COMMENT_MENTIONS_MAX + 1 }, (_, i) => `u${i}`);
    expect(
      CreateCommentBodySchema.safeParse({ ...base, body: "x", mentions: tooMany }).success
    ).toBe(false);
  });

  it("describes the comment DTO", () => {
    expect(
      NotebookCommentSchema.safeParse({
        id: "c",
        notebookId: "n",
        targetType: "source",
        targetId: "s",
        author: { id: "a", displayName: "A" },
        body: "x",
        mentions: [],
        createdAt: 1,
        updatedAt: 1,
        edited: false,
        canEdit: true,
        canDelete: true
      }).success
    ).toBe(true);
  });
});

describe("Erwähnungs-Eingabe", () => {
  it("finds a mention at the start or after whitespace, but not inside e-mail addresses", () => {
    expect(findMentionQuery("@Al", 3)).toEqual({ start: 0, query: "Al" });
    expect(findMentionQuery("Hallo @Bob B", 12)).toEqual({ start: 6, query: "Bob B" });
    expect(findMentionQuery("mail an bob@example.org", 23)).toBeNull();
    expect(findMentionQuery("kein Zeichen", 12)).toBeNull();
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(findMentionQuery("@Bob\nweiter", 11)).toBeNull();
    expect(findMentionQuery(`@${"x".repeat(41)}`, 42)).toBeNull();
    expect(findMentionQuery("@Al", 99)).toEqual({ start: 0, query: "Al" });
    expect(findMentionQuery("@Al", -5)).toBeNull();
  });

  it("ranks names that start with the query before names that contain it", () => {
    expect(filterMentionCandidates(people, "b").map((p) => p.id)).toEqual(["b", "c"]);
    expect(filterMentionCandidates(people, "").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(filterMentionCandidates(people, "", "a").map((p) => p.id)).toEqual(["b", "c"]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, displayName: `P ${i}` }));
    expect(filterMentionCandidates(many, "p")).toHaveLength(8);
  });

  it("inserts the chosen name and moves the caret behind it", () => {
    const text = "Hallo @Bo und mehr";
    const mention = { start: 6, query: "Bo" };
    expect(insertMention(text, mention, 9, "Bob Berg")).toEqual({
      text: "Hallo @Bob Berg  und mehr",
      caret: 16
    });
  });

  it("keeps only mentions whose name is still in the text", () => {
    expect(resolveMentionIds("Hi @Alice Adler und @Bob Berg @Alice Adler", people)).toEqual([
      "a",
      "b"
    ]);
    expect(resolveMentionIds("Hi Alice", people)).toEqual([]);
    expect(resolveMentionIds("@", people)).toEqual([]);
  });
});
