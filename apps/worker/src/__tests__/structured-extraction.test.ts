import type {
  LlmJsonOptions,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmStreamChunk
} from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import {
  STRUCTURED_JSON_SCHEMAS,
  buildStructuredMessages,
  extractDataTable,
  extractInfographicFacts,
  extractTimeline
} from "../structured-extraction.js";

/** Provider-Mock: liefert je Aufruf die nächste Rohantwort und nutzt den validator. */
class MockJsonProvider implements LlmProvider {
  readonly id = "mock";
  readonly name = "Mock";
  readonly isLocal = true;
  readonly trainingPolicy = "air-gapped-local" as const;
  readonly calls: {
    schema: unknown;
    options: LlmJsonOptions<unknown> | undefined;
    messages: readonly LlmMessage[];
  }[] = [];
  constructor(private readonly answer: unknown) {}
  async chat(): Promise<LlmResponse> {
    return { text: "", model: "mock" };
  }
  async *chatStream(): AsyncIterable<LlmStreamChunk> {}
  async embed(): Promise<Float32Array[]> {
    return [];
  }
  async generateJson<T>(
    messages: readonly LlmMessage[],
    schema?: Record<string, unknown>,
    options?: LlmJsonOptions<T>
  ): Promise<T> {
    this.calls.push({ schema, options: options as LlmJsonOptions<unknown>, messages });
    return options?.validator ? options.validator(this.answer) : (this.answer as T);
  }
}

const SOURCES = [
  {
    id: "s1",
    title: "Bericht",
    text: "Am 01.03.2024 startete der Betrieb. Die Kosten liegen bei 1.200 EUR pro Monat."
  },
  { id: "s2", title: "Leer", text: "  " }
];

describe("KI-Extraktion: Timeline, Tabelle, Infografik (Issue #239)", () => {
  it("Timeline: Schema, Temperatur 0, Zitat- und Datumsprüfung", async () => {
    const provider = new MockJsonProvider({
      events: [
        {
          date: "01.03.2024",
          event: "Betriebsstart",
          sourceId: "s1",
          quote: "Am 01.03.2024 startete der Betrieb."
        },
        {
          date: "2019",
          event: "Erfunden",
          sourceId: "s1",
          quote: "Am 01.03.2024 startete der Betrieb."
        }
      ]
    });
    const result = await extractTimeline(provider, SOURCES, { model: "m", apiKey: "k" });
    expect(result.entries.map((e) => [e.date, e.event, e.status])).toEqual([
      ["01.03.2024", "Betriebsstart", "suggested"]
    ]);
    expect(result.dropped).toEqual([{ index: 1, reason: "valueNotInQuote" }]);
    const call = provider.calls[0];
    expect(call?.schema).toBe(STRUCTURED_JSON_SCHEMAS.timeline);
    expect(call?.options).toMatchObject({ model: "m", apiKey: "k", temperature: 0 });
    expect(call?.messages[1]?.content).not.toContain("s2");
  });

  it("Datentabelle und Kennzahlen", async () => {
    const table = await extractDataTable(
      new MockJsonProvider({
        columns: ["Posten", "Betrag"],
        rows: [
          {
            cells: ["Kosten", "1.200 EUR"],
            sourceId: "s1",
            quote: "Die Kosten liegen bei 1.200 EUR pro Monat."
          }
        ]
      }),
      SOURCES
    );
    expect(table.table.columns).toEqual(["Posten", "Betrag"]);
    expect(table.table.rows[0]?.cells).toEqual(["Kosten", "1.200 EUR"]);

    const facts = await extractInfographicFacts(
      new MockJsonProvider({
        facts: [
          {
            label: "Kosten pro Monat",
            value: "1.200 EUR",
            sourceId: "s1",
            quote: "1.200 EUR pro Monat"
          }
        ]
      }),
      SOURCES,
      { language: "en" }
    );
    expect(facts.facts.map((f) => f.value)).toEqual(["1.200 EUR"]);
  });

  it("ohne nutzbare Quellen kein Modellaufruf", async () => {
    const provider = new MockJsonProvider({});
    const none = [{ id: "x", title: "x", text: "" }];
    expect(await extractTimeline(provider, none)).toEqual({ entries: [], dropped: [] });
    expect(await extractDataTable(provider, none)).toEqual({
      table: { columns: ["–"], rows: [] },
      dropped: []
    });
    expect(await extractInfographicFacts(provider, none)).toEqual({ facts: [], dropped: [] });
    expect(provider.calls).toHaveLength(0);
  });

  it("ungültige KI-Antwort wird mit verständlicher Meldung abgelehnt", async () => {
    await expect(extractTimeline(new MockJsonProvider({ events: 1 }), SOURCES)).rejects.toThrow(
      "Die KI-Antwort entspricht nicht dem Schema für „timeline“."
    );
    await expect(extractDataTable(new MockJsonProvider(null), SOURCES)).rejects.toThrow("„table“");
  });

  it("Prompt je Werkzeug und Sprache, entschärft und gekürzt", () => {
    const de = buildStructuredMessages("table", SOURCES);
    expect(de[0]?.content).toContain("Datentabelle");
    expect(de[0]?.content).toContain("Erfinde nichts");
    const en = buildStructuredMessages(
      "infographic",
      [{ id: "a", title: "<t>", text: "y".repeat(30) }],
      { language: "en", maxCharsPerSource: 5 }
    );
    expect(en[0]?.content).toContain("key figures");
    expect(en[1]?.content).toBe(`<source id="a" title="&lt;t&gt;">\n${"y".repeat(5)}\n</source>`);
    expect(buildStructuredMessages("timeline", SOURCES, { language: "en" })[0]?.content).toContain(
      "date-event pairs"
    );
  });
});
