import { type Page, expect, test } from "@playwright/test";
import { findLayoutProblems, openPanel } from "./helpers";

/**
 * Runde 2, Übersetzung (Issue #320): Auf Englisch bleiben Kopf, die drei Bereiche und alle
 * Werkzeugansichten ohne deutsche Bedientexte. Geprüft wird jeder Text, den eine Person oder
 * ein Screenreader erhält: Textknoten sowie aria-label, title, placeholder und alt.
 */

/**
 * Erlaubte deutsche Stellen. Jede Zeile hat einen Grund; alles andere ist ein Fehler.
 * Sprachname und Demodaten sind Inhalt, kein Bedientext.
 */
const ALLOWED: readonly { readonly match: string; readonly reason: string }[] = [
  { match: "Deutsch", reason: "Sprachname in der Sprachwahl (steht in der eigenen Sprache)" },
  {
    match: "Dieses Notebook dokumentiert",
    reason: "Demodaten: Zusammenfassung des Notebooks (Inhalt der Quellen)"
  },
  {
    match: "Was bewirkt die WebSocket",
    reason: "Demodaten: Lernkarte (Inhalt der Quellen)"
  },
  { match: "Ermöglicht es Durable Objects", reason: "Demodaten: Lernkarte, Rückseite" },
  { match: "Wie viel Speicher spart", reason: "Demodaten: Lernkarte" },
  { match: "Genau 75%", reason: "Demodaten: Lernkarte, Rückseite" },
  { match: "Welcher SQLite-Mechanismus", reason: "Demodaten: Quizfrage" },
  { match: "Welche Mindestgröße", reason: "Demodaten: Quizfrage" },
  { match: "FTS5 mit BM25", reason: "Demodaten: Antwortoption und Erklärung des Quiz" },
  { match: "D1 nutzt die FTS5", reason: "Demodaten: Erklärung der Quizfrage" },
  { match: "Hybrid Search mit RRF", reason: "Demodaten: Quellenangabe der Lernkarte" },
  { match: "Einführung", reason: "Demodaten: Kapitel des Videos" },
  { match: "Architektur & Performance", reason: "Demodaten: Folienuntertitel" },
  { match: "Titel-Folie mit", reason: "Demodaten: Audiodeskription der Folie" },
  { match: "Folie zu int8", reason: "Demodaten: Audiodeskription der Folie" },
  { match: "Cloudflare Worker dient", reason: "Demodaten: Untertitel und Sprechtext" },
  { match: "Willkommen zum Deep Dive", reason: "Demodaten: Transkript der Hosts" },
  { match: "Genau, und wie D1", reason: "Demodaten: Transkript der Hosts" },
  { match: "Lassen Sie uns direkt", reason: "Demodaten: Transkript der Hosts" }
];

/** Deutsche Wörter und Zeichen, die auf einen unübersetzten Bedientext hinweisen. */
const GERMAN =
  /[äöüÄÖÜß]|\b(und|oder|mit|für|von|zum|zur|eine?n?|ihre[nrms]?|wird|werden|nicht|ist|sind|bei|nach|über|Quellen?|Datei(en)?|Fragen?|Antworten?|Werkzeuge?|hochladen|ablegen|Einstellungen|Vorlesen|Zurück|Weiter|Starten|Abbrechen|Schließen|Kapitel|Untertitel|Abspielen|Pausieren|Einpassen|Baumliste|Richtig|Falsch|Rückseite|Vorderseite|Wiederholung(en)?|Bühne|Inhaber|Betrachter|Bearbeiter|Ansehen|Erkunden|Lernen)\b/;

/** Alle für Menschen und Hilfstechnik lesbaren Texte der Seite, einzeln. */
async function readTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const add = (value: string | null) => {
      const text = (value ?? "").replace(/\s+/g, " ").trim();
      if (text) out.add(text);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      add(n.nodeValue);
    }
    for (const el of document.querySelectorAll("[aria-label],[title],[placeholder],[alt]")) {
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) add(el.getAttribute(attr));
    }
    return [...out];
  });
}

function germanFindings(texts: readonly string[]): string[] {
  return texts.filter((text) => {
    if (ALLOWED.some((a) => text.includes(a.match))) return false;
    return GERMAN.test(text);
  });
}

async function expectEnglish(page: Page, where: string) {
  expect(germanFindings(await readTexts(page)), `deutsche Texte: ${where}`).toEqual([]);
}

/** Zugänglicher Name beginnt mit der sichtbaren Beschriftung (WCAG 2.5.3), auch auf Englisch. */
async function expectLabelInName(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("button[aria-label], a[aria-label]")) {
      const aria = (el.getAttribute("aria-label") ?? "").toLowerCase().trim();
      const visible = Array.from(el.childNodes)
        .map((n) => (n.nodeType === 3 ? n.nodeValue : ((n as Element).textContent ?? "")))
        .join(" ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
      if (/\p{L}/u.test(visible) && !aria.startsWith(visible))
        bad.push(`"${aria}" beginnt nicht mit "${visible}"`);
    }
    return bad;
  });
  expect(problems, `Label im Namen: ${where}`).toEqual([]);
}

for (const width of [1440, 390]) {
  test.describe(`${width} px, Englisch`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });

    test("Kopf und Bereiche ohne deutsche Bedientexte", async ({ page }) => {
      await expectEnglish(page, "Kopf");
      for (const panel of ["sources", "chat", "studio"] as const) {
        await openPanel(page, panel);
        await expectEnglish(page, `Bereich ${panel}`);
        await expectLabelInName(page, `Bereich ${panel}`);
      }
      expect(await findLayoutProblems(page)).toEqual([]);
    });

    test("Quellen: Link-Dialog, Inspektor, Suche ohne Treffer", async ({ page }) => {
      await openPanel(page, "sources");
      await page.getByTestId("sources-filter-input").fill("zzz");
      await expect(page.getByTestId("no-sources-message")).toContainText(
        "No source matches “zzz”. Check the spelling or clear the filter."
      );
      await page.getByTestId("sources-filter-input").fill("");
      await page.getByTestId("btn-open-url-dialog").click();
      await expect(
        page.getByRole("dialog", { name: "Import web link or Google Docs" })
      ).toBeVisible();
      await expectEnglish(page, "Link-Dialog");
      await page.keyboard.press("Escape");
      await page
        .getByTestId("sources-list")
        .locator("[data-testid^='btn-inspect-source-']")
        .first()
        .click();
      await expect(page.getByTestId("source-inspector-drawer")).toBeVisible();
      await expectEnglish(page, "Quell-Inspektor");
      await expectLabelInName(page, "Quellen");
    });

    test("Chat: Fehlerfreie Texte, Vorschlagsfrage und Eingabe auf Englisch", async ({ page }) => {
      await openPanel(page, "chat");
      await expect(page.getByTestId("prompt-chips-container")).toContainText(
        "Summarize the key findings"
      );
      await expect(page.getByTestId("chat-input-field")).toHaveAttribute(
        "placeholder",
        "Ask a question about your sources …"
      );
      await expect(page.getByRole("button", { name: /^Read aloud/ }).first()).toBeVisible();
      await expectEnglish(page, "Chat");
      await expectLabelInName(page, "Chat");
    });

    test("Studio: jede Werkzeugansicht auf Englisch", async ({ page }) => {
      await openPanel(page, "studio");
      await expect(page.getByTestId("studio-panel")).toContainText("7 tools from your sources");

      const tools: readonly [string, string][] = [
        ["btn-open-audio-tool", "Audio Overview"],
        ["btn-open-video-tool", "Video Overview"],
        ["btn-open-mindmap-tool", "Mindmap"],
        ["btn-open-flashcards-tool", "Flashcards"],
        ["btn-open-quiz-tool", "Quiz"]
      ];
      for (const [button, name] of tools) {
        await page.getByTestId(button).click();
        await expect(page.getByTestId("studio-tool-view")).toBeVisible();
        await expectEnglish(page, name);
        await expectLabelInName(page, name);
        await page.getByTestId("btn-back-to-studio-overview").click();
      }
    });

    test("Quiz: Antwort, Erklärung und Auswertung auf Englisch", async ({ page }) => {
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-quiz-tool").click();
      await page.locator(".rn-quiz-option").first().click();
      await expect(page.getByTestId("quiz-explanation-box")).toContainText("Explanation:");
      await expectEnglish(page, "Quiz mit Antwort");
      for (let i = 0; i < 5; i++) {
        const next = page.getByRole("button", { name: "Next", exact: true });
        if (!(await next.isVisible())) break;
        await next.click();
      }
      await page.getByRole("button", { name: "Finish quiz" }).click();
      await expect(page.getByTestId("quiz-summary-card")).toContainText("Quiz results");
      await expectEnglish(page, "Quiz-Auswertung");
    });

    test("Lernkarten: Aufdecken, Bewerten, Ansage auf Englisch", async ({ page }) => {
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-flashcards-tool").click();
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await expectEnglish(page, "Lernkarte aufgedeckt");
      await page.getByRole("button", { name: /^Good/ }).click();
      await expect(page.getByTestId("a11y-flashcard-announcement")).toContainText(
        "Card rated Good. Next review:"
      );
      await expectEnglish(page, "Lernkarte bewertet");
    });

    test("Audio: Zwischenfrage und Bühne auf Englisch", async ({ page }) => {
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-audio-tool").click();
      await page.getByTestId("btn-audio-interject").click();
      await expect(page.getByTestId("interject-dialog")).toBeVisible();
      await expectEnglish(page, "Zwischenfrage");
      await expectLabelInName(page, "Zwischenfrage");
      await page.keyboard.press("Escape");
      await page.getByTestId("btn-back-to-studio-overview").click();
      await page.getByTestId("btn-open-deep-dive-stage").click();
      await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
      await expectEnglish(page, "Bühne");
      await expectLabelInName(page, "Bühne");
    });

    test("Mindmap: beide Ansichten auf Englisch", async ({ page }) => {
      await openPanel(page, "studio");
      await page.getByTestId("btn-open-mindmap-tool").click();
      for (const tab of ["Graphic", "Tree list"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expectEnglish(page, `Mindmap ${tab}`);
      }
    });
  });
}

test("Deutsch bleibt unverändert: Bereiche tragen deutsche Bedientexte", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await openPanel(page, "sources");
  await expect(page.getByTestId("sources-panel")).toContainText("Datei hochladen");
  await openPanel(page, "studio");
  await expect(page.getByTestId("studio-panel")).toContainText("7 Werkzeuge aus Ihren Quellen");
});
