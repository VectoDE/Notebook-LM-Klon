import { describe, expect, it } from "vitest";
import {
  FreeTextGradeSchema,
  type MixedQuizItem,
  MixedQuizItemSchema,
  MixedQuizPayloadSchema,
  QUIZ_COUNT_DEFAULT,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
  QUIZ_ITEM_TYPES,
  clampQuizCount,
  evaluateMixedQuiz,
  evaluateQuizItem,
  planQuizItemTypes
} from "../quiz-mixed.js";

const mc: MixedQuizItem = {
  id: "q1",
  type: "multiple-choice",
  question: "Welche Datenbank nutzt der Worker?",
  options: ["D1", "Postgres", "Redis"],
  correctAnswerIndex: 0,
  explanation: "D1 ist die SQLite-Datenbank von Cloudflare.",
  sourceCitation: "D1 ist SQLite am Edge"
};
const tf: MixedQuizItem = {
  id: "q2",
  type: "true-false",
  question: "R2 erhebt Egress-Gebühren.",
  correctAnswer: false,
  explanation: "R2 verzichtet auf Egress-Gebühren."
};
const match: MixedQuizItem = {
  id: "q3",
  type: "matching",
  question: "Ordnen Sie Dienst und Zweck zu.",
  pairs: [
    { left: "D1", right: "Relationale Daten" },
    { left: "R2", right: "Objekte" },
    { left: "KV", right: "Schlüssel-Wert" },
    { left: "Vectorize", right: "Vektoren" }
  ],
  explanation: "Jeder Dienst hat eine Aufgabe."
};
const free: MixedQuizItem = {
  id: "q4",
  type: "free-text",
  question: "Wozu dient Hibernation bei Durable Objects?",
  referenceAnswer: "Inaktive WebSockets werden aus dem Speicher entladen.",
  explanation: "Spart Kosten bei vielen offenen Verbindungen."
};

const grade = {
  verdict: "partial" as const,
  score: 0.5,
  reasoning: "Speicher genannt, WebSockets fehlen.",
  sourceCitation: "Hibernation entlädt inaktive WebSockets aus dem RAM",
  sourceId: "src_1",
  page: 3
};

describe("Quiz-Anzahl (Issue #242)", () => {
  it("begrenzt auf 5 bis 20 und nimmt sonst 10", () => {
    expect([QUIZ_COUNT_MIN, QUIZ_COUNT_DEFAULT, QUIZ_COUNT_MAX]).toEqual([5, 10, 20]);
    expect(clampQuizCount()).toBe(10);
    expect(clampQuizCount(null)).toBe(10);
    expect(clampQuizCount(Number.NaN)).toBe(10);
    expect(clampQuizCount(Number.POSITIVE_INFINITY)).toBe(10);
    expect(clampQuizCount(1)).toBe(5);
    expect(clampQuizCount(12.4)).toBe(12);
    expect(clampQuizCount(99)).toBe(20);
  });

  it("verteilt alle vier Fragetypen gleichmäßig", () => {
    const plan = planQuizItemTypes(10);
    expect(plan).toHaveLength(10);
    for (const type of QUIZ_ITEM_TYPES) {
      expect(plan.filter((entry) => entry === type).length).toBeGreaterThanOrEqual(2);
    }
    expect(planQuizItemTypes()).toHaveLength(10);
    expect(planQuizItemTypes(3)).toEqual([
      "multiple-choice",
      "true-false",
      "matching",
      "free-text",
      "multiple-choice"
    ]);
  });
});

describe("Schemas für gemischte Quizze", () => {
  it("akzeptiert alle vier Typen und prüft die Grenzen", () => {
    for (const item of [mc, tf, match, free]) {
      expect(MixedQuizItemSchema.safeParse(item).success).toBe(true);
    }
    expect(
      MixedQuizItemSchema.safeParse({ ...mc, correctAnswerIndex: 3 }).success,
      "Index außerhalb der Optionen"
    ).toBe(false);
    expect(
      MixedQuizItemSchema.safeParse({
        ...match,
        pairs: [
          { left: "D1", right: "a" },
          { left: "D1", right: "b" }
        ]
      }).success,
      "doppelte linke Begriffe"
    ).toBe(false);
    expect(MixedQuizPayloadSchema.safeParse({ items: [mc, tf, match, free] }).success).toBe(false);
    expect(
      MixedQuizPayloadSchema.safeParse({ items: [mc, tf, match, free, { ...mc, id: "q5" }] })
        .success
    ).toBe(true);
    expect(FreeTextGradeSchema.safeParse(grade).success).toBe(true);
    expect(FreeTextGradeSchema.safeParse({ ...grade, sourceCitation: "" }).success).toBe(false);
  });
});

describe("Quiz-Auswertung", () => {
  it("bewertet Multiple Choice und Richtig/Falsch", () => {
    expect(evaluateQuizItem(mc, { type: "multiple-choice", selectedIndex: 0 }).status).toBe(
      "correct"
    );
    expect(evaluateQuizItem(mc, { type: "multiple-choice", selectedIndex: 2 })).toEqual({
      itemId: "q1",
      type: "multiple-choice",
      status: "incorrect",
      score: 0
    });
    expect(evaluateQuizItem(tf, { type: "true-false", value: false }).score).toBe(1);
    expect(evaluateQuizItem(tf, { type: "true-false", value: true }).status).toBe("incorrect");
  });

  it("vergibt bei der Zuordnung Teilpunkte je Paar", () => {
    const all = evaluateQuizItem(match, {
      type: "matching",
      matches: {
        D1: "Relationale Daten",
        R2: "Objekte",
        KV: "Schlüssel-Wert",
        Vectorize: "Vektoren"
      }
    });
    expect(all.status).toBe("correct");
    const half = evaluateQuizItem(match, {
      type: "matching",
      matches: { D1: "Relationale Daten", R2: "Objekte", KV: "Vektoren" }
    });
    expect(half).toMatchObject({ status: "partial", score: 0.5 });
    expect(evaluateQuizItem(match, { type: "matching", matches: {} }).status).toBe("incorrect");
  });

  it("Freitext: leer zählt als unbeantwortet, ohne Bewertung offen, sonst mit Begründung und Quelle", () => {
    expect(evaluateQuizItem(free, { type: "free-text", text: "   " }).status).toBe("unanswered");
    expect(evaluateQuizItem(free, { type: "free-text", text: "Spart RAM" })).toEqual({
      itemId: "q4",
      type: "free-text",
      status: "pending",
      score: null
    });
    expect(evaluateQuizItem(free, { type: "free-text", text: "Spart RAM", grade })).toEqual({
      itemId: "q4",
      type: "free-text",
      status: "partial",
      score: 0.5,
      reasoning: grade.reasoning,
      sourceCitation: grade.sourceCitation
    });
  });

  it("fehlende oder unpassende Antworten", () => {
    expect(evaluateQuizItem(mc, undefined).status).toBe("unanswered");
    expect(evaluateQuizItem(mc, { type: "true-false", value: true })).toMatchObject({
      status: "incorrect",
      score: 0
    });
  });

  it("rechnet das Gesamtergebnis über alle Fragen", () => {
    const items = [mc, tf, match, free];
    const pending = evaluateMixedQuiz(items, {
      q1: { type: "multiple-choice", selectedIndex: 0 },
      q2: { type: "true-false", value: true },
      q3: { type: "matching", matches: { D1: "Relationale Daten", R2: "Objekte" } },
      q4: { type: "free-text", text: "Spart RAM" }
    });
    expect(pending).toMatchObject({
      totalItems: 4,
      answeredCount: 4,
      pendingCount: 1,
      points: 1.5,
      scorePercentage: 38,
      isComplete: false
    });

    const done = evaluateMixedQuiz(items, {
      q1: { type: "multiple-choice", selectedIndex: 0 },
      q2: { type: "true-false", value: false },
      q4: { type: "free-text", text: "Spart RAM", grade }
    });
    expect(done).toMatchObject({
      answeredCount: 3,
      pendingCount: 0,
      points: 2.5,
      isComplete: false
    });

    expect(evaluateMixedQuiz([], {})).toMatchObject({ scorePercentage: 0, isComplete: false });
    const complete = evaluateMixedQuiz([tf], { q2: { type: "true-false", value: false } });
    expect(complete).toMatchObject({ isComplete: true, scorePercentage: 100 });
  });
});
