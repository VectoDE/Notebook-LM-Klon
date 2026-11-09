import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  CHUNKS_FTS5_BM25_SEARCH_SQL,
  CHUNKS_FTS5_SCHEMA_SQL,
  buildSafeFts5MatchQuery
} from "../fts5-probe.js";

describe("D1 / SQLite FTS5 Virtual Table, Sync Triggers & BM25 Ranking", () => {
  it("sanitizes arbitrary search queries into safe FTS5 match expressions", () => {
    expect(buildSafeFts5MatchQuery("DSGVO & KI-Verordnung (EU AI Act)!")).toBe(
      '"DSGVO" "KI" "Verordnung" "EU" "AI" "Act"'
    );
    expect(buildSafeFts5MatchQuery("   ---   ")).toBe("");
  });

  it("creates FTS5 virtual table, syncs INSERT/UPDATE/DELETE triggers, and ranks via bm25()", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(CHUNKS_FTS5_SCHEMA_SQL);

    const insertStmt = db.prepare(
      "INSERT INTO chunks_probe (id, notebook_id, text) VALUES (?, ?, ?)"
    );

    insertStmt.run(
      "chunk-1",
      "nb-1",
      "RelationFlow bietet DSGVO-konforme KI-Workspaces mit EU-Hosting und Rollenmodell."
    );
    insertStmt.run(
      "chunk-2",
      "nb-1",
      "DSGVO-konforme KI-Workspaces in RelationFlow unterstützen Multi-Modell-Routing und DSGVO-Export."
    );
    insertStmt.run(
      "chunk-3",
      "nb-1",
      "Cloudflare Durable Objects speichern den int8-Vektor-Cache im Arbeitsspeicher."
    );

    const matchQuery = buildSafeFts5MatchQuery("DSGVO RelationFlow");
    const searchStmt = db.prepare(CHUNKS_FTS5_BM25_SEARCH_SQL);
    const results = searchStmt.all(matchQuery, "nb-1", 10) as {
      id: string;
      text: string;
      rank: number;
    }[];

    expect(results).toHaveLength(2);
    // chunk-2 mentions DSGVO twice, so bm25() assigns a more negative (better) rank score
    expect(results[0]?.id).toBe("chunk-2");
    expect(results[1]?.id).toBe("chunk-1");
    expect(results[0]?.rank).toBeLessThan(results[1]?.rank ?? 0);

    // Verify UPDATE trigger syncs FTS5 index
    db.prepare("UPDATE chunks_probe SET text = ? WHERE id = ?").run(
      "Aktualisierter Text über WebAuthn Passkeys ohne das frühere Schlagwort.",
      "chunk-1"
    );
    const afterUpdate = searchStmt.all(matchQuery, "nb-1", 10) as { id: string }[];
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]?.id).toBe("chunk-2");

    // Verify DELETE trigger removes entry from FTS5 index
    db.prepare("DELETE FROM chunks_probe WHERE id = ?").run("chunk-2");
    const afterDelete = searchStmt.all(matchQuery, "nb-1", 10) as { id: string }[];
    expect(afterDelete).toHaveLength(0);

    db.close();
  });
});
