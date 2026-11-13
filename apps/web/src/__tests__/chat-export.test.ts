import { describe, expect, it } from "vitest";
import {
  type ChatExportOptions,
  chatToMarkdown,
  citedNumbers,
  escapeMarkdownHtml
} from "../chat-export.js";

const labels: ChatExportOptions["labels"] = {
  exportedAt: "Exportiert am",
  user: "Sie",
  assistant: "Assistent",
  sources: "Quellen",
  page: "S.",
  aborted: "Generierung abgebrochen.",
  aiLabel: "KI-generiert"
};

const options: ChatExportOptions = {
  title: "Mein <Notebook>",
  date: new Date("2026-11-13T10:00:00Z"),
  labels,
  sourceTitle: (id) => (id === "src_1" ? "Datenschutzrichtlinie" : undefined)
};

describe("Markdown-Export des Chatverlaufs (Issue #243)", () => {
  it("schreibt Fragen, Antworten und nummerierte Quellen mit Seite und Zitat", () => {
    const md = chatToMarkdown(
      [
        { id: "u1", role: "user", content: "Was schützt die DSGVO?" },
        {
          id: "a1",
          role: "assistant",
          content: "Personenbezogene Daten [1], siehe auch [2] und erneut [1].",
          modelUsed: "gemini-2.5-flash",
          citations: [
            { sourceId: "src_1", page: 3, quote: "Die DSGVO schützt personenbezogene Daten." },
            { sourceId: "src_9" }
          ]
        }
      ],
      options
    );
    expect(md).toBe(
      [
        "# Mein &lt;Notebook&gt;",
        "",
        "Exportiert am: 2026-11-13",
        "",
        "## Sie",
        "",
        "Was schützt die DSGVO?",
        "",
        "## Assistent",
        "",
        "Personenbezogene Daten [1], siehe auch [2] und erneut [1].",
        "",
        "**Quellen**",
        "",
        "1. Datenschutzrichtlinie, S. 3: „Die DSGVO schützt personenbezogene Daten.“",
        "2. src_9",
        "",
        "_KI-generiert: gemini-2.5-flash_",
        ""
      ].join("\n")
    );
  });

  it("markiert Abbrüche, überspringt Systemnachrichten und leere Platzhalter", () => {
    const md = chatToMarkdown(
      [
        { id: "s", role: "system", content: "intern" },
        { id: "e", role: "assistant", content: "" },
        { id: "x", role: "assistant", content: "", aborted: true },
        { id: "y", role: "assistant", content: "Teil [3]", citations: [] },
        { id: "z", role: "assistant", content: "Nur [4]" }
      ],
      { ...options, sourceTitle: undefined }
    );
    expect(md).not.toContain("intern");
    expect(md.match(/## Assistent/g)).toHaveLength(3);
    expect(md).toContain("**Quellen**\n\n4. [4]");
    expect(md).toContain("_Generierung abgebrochen._");
    // Zitat ohne Metadaten: Nummer bleibt stehen, nichts wird erfunden
    expect(md).toContain("**Quellen**\n\n3. [3]");
    expect(md).not.toContain("KI-generiert");
  });

  it("nennt die Quelle ohne Titel mit ihrer Kennung und ohne Seite", () => {
    const md = chatToMarkdown(
      [{ id: "a", role: "assistant", content: "A [1]", citations: [{ sourceId: "src_7" }] }],
      { ...options, sourceTitle: undefined }
    );
    expect(md).toContain("1. src_7\n");
  });

  it("Hilfsfunktionen: Zitatnummern und HTML-Maskierung", () => {
    expect(citedNumbers("a [2] b [1] c [2]")).toEqual([1, 2]);
    expect(citedNumbers("ohne")).toEqual([]);
    expect(escapeMarkdownHtml('<img src=x onerror="a"> & "b"')).toBe(
      '&lt;img src=x onerror="a"&gt; &amp; "b"'
    );
  });
});
