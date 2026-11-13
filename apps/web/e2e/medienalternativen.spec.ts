import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { DESIGNS, chooseDesign, openPanel } from "./helpers";

/**
 * Medienalternativen (Issue #350): Untertitel und Transkript für alle Medien,
 * Audiodeskription der Video-Übersicht (Text und Vorlesen), Gebärdensprach-Option und
 * automatisierte Prüfung mit axe sowie dem Accessibility-Tree.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Ersetzt die Web Speech API: merkt sich jede Äußerung, Ende erst auf Zuruf. */
async function stubSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spoken: { text: string; lang: string }[] = [];
    let current: { onend: (() => void) | null } | null = null;
    class Utterance {
      text: string;
      lang = "";
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak(u: Utterance) {
          spoken.push({ text: u.text, lang: u.lang });
          current = u;
        },
        cancel() {
          current = null;
        }
      }
    });
    Object.assign(window, {
      __spoken: spoken,
      __finishSpeech: () => {
        const u = current;
        current = null;
        u?.onend?.();
      }
    });
  });
}

async function openVideo(page: Page): Promise<void> {
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-video-tool").click();
  await expect(page.getByTestId("video-overview-player")).toBeVisible();
}

async function downloadText(page: Page, testId: string): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(testId).click()
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf-8") };
}

test.describe("Video-Übersicht: Untertitel, Transkript, Audiodeskription", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Untertitel kommen aus dem Sprechertext und laufen mit der Zeit", async ({ page }) => {
    await page.goto("/");
    await openVideo(page);
    const overlay = page.getByTestId("subtitles-overlay");
    await expect(overlay).toHaveText("Cloudflare Worker dient als einheitlicher Einstiegspunkt.");
    await expect(overlay).toHaveAttribute("lang", "de");
    await page.getByTestId("chapter-btn-ch_2").click();
    await expect(overlay).toHaveText(
      "int8 Quantisierung spart 75 Prozent Speicherplatz bei hoher Genauigkeit."
    );
  });

  test("Transkript: Abschnitte mit Sprung, Bildbeschreibung und drei Downloads", async ({
    page
  }) => {
    await page.goto("/");
    await openVideo(page);
    const toggle = page.getByTestId("toggle-transcript-button");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("Transkript ausblenden");

    const transcript = page.getByTestId("video-transcript");
    await expect(transcript.getByRole("heading", { name: "Transkript" })).toBeVisible();
    await expect(transcript.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("transcript-item-sl_1")).toHaveAttribute("aria-current", "time");
    await expect(page.getByTestId("transcript-item-sl_1")).toContainText(
      "Cloudflare Worker dient als einheitlicher Einstiegspunkt."
    );
    await expect(page.getByTestId("transcript-item-sl_1")).toContainText(
      "Bild: Titel-Folie mit Cloudflare Edge Stack Überblick."
    );

    // Zeit als Knopf: springt an die Stelle
    await transcript.getByRole("button", { name: "0:15 – an diese Stelle springen" }).click();
    await expect(page.getByTestId("video-time")).toHaveText("0:15 / 0:30");
    await expect(page.getByTestId("transcript-item-sl_2")).toHaveAttribute("aria-current", "time");

    const txt = await downloadText(page, "transcript-download-txt");
    expect(txt.name).toMatch(/_transkript\.txt$/);
    expect(txt.text).toContain("Cloudflare Edge Stack Video Overview – Transkript");
    expect(txt.text).toContain("[0:15–0:30] Kapitel: Edge & Vektoren");
    expect(txt.text).toContain("Bild: Folie zu int8 Quantisierung und Hybrid Search.");

    const captions = await downloadText(page, "transcript-download-captions");
    expect(captions.text.startsWith("WEBVTT - Cloudflare Edge Stack Video Overview\n\n")).toBe(
      true
    );
    expect(captions.text).toContain(
      "00:00:00.000 --> 00:00:15.000\nCloudflare Worker dient als einheitlicher Einstiegspunkt."
    );

    const descriptions = await downloadText(page, "transcript-download-descriptions");
    expect(descriptions.name).toMatch(/_audiodeskription\.vtt$/);
    expect(descriptions.text).toContain("00:00:15.000 --> 00:00:30.000");
    expect(descriptions.text).toContain(
      "Punkte auf der Folie: 75% RAM Ersparnis; BM25 Ranking; RRF Fusion."
    );
  });

  test("Audiodeskription als Text (Live-Region) und vorgelesen mit Pause", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");
    await openVideo(page);

    await page.getByTestId("toggle-ad-button").click();
    const visible = page.getByTestId("video-ad-text");
    await expect(visible).toContainText("Bildbeschreibung: Titel-Folie mit Cloudflare Edge Stack");
    await expect(page.getByTestId("a11y-live-region")).toContainText("Audiodeskription an");

    // Vorlesen: gleiche Beschreibung, deutsche Stimme
    const speech = page.getByTestId("toggle-ad-speech-button");
    await speech.click();
    await expect(speech).toHaveAttribute("aria-pressed", "true");
    const first = await page.evaluate(
      () => (window as unknown as { __spoken: { text: string; lang: string }[] }).__spoken[0]
    );
    expect(first?.lang).toBe("de-DE");
    expect(first?.text).toContain("Titel-Folie mit Cloudflare Edge Stack Überblick.");
    await page.evaluate(() =>
      (window as unknown as { __finishSpeech: () => void }).__finishSpeech()
    );

    // Beim Folienwechsel hält das Video an, liest vor und läuft danach weiter
    const play = page.getByTestId("play-pause-button");
    await play.click();
    await expect(play).toHaveText("Pausieren");
    await page.getByTestId("chapter-btn-ch_2").click();
    await expect(play).toHaveText("Abspielen");
    const second = await page.evaluate(
      () => (window as unknown as { __spoken: { text: string }[] }).__spoken.at(-1)?.text
    );
    expect(second).toContain("Folie zu int8 Quantisierung");
    await page.evaluate(() =>
      (window as unknown as { __finishSpeech: () => void }).__finishSpeech()
    );
    await expect(play).toHaveText("Pausieren");
    await play.click();

    // Audiodeskription aus schaltet auch das Vorlesen aus
    await page.getByTestId("toggle-ad-button").click();
    await expect(speech).toHaveAttribute("aria-pressed", "false");
    await expect(visible).toHaveCount(0);
  });

  test("Gebärdensprache: ohne Video offen als nicht verfügbar erklärt", async ({ page }) => {
    await page.goto("/");
    await openVideo(page);
    await expect(page.getByTestId("toggle-sign-language-button")).toHaveCount(0);
    await expect(page.getByTestId("sign-language-unavailable")).toContainText(
      "noch kein Video in Deutscher Gebärdensprache hinterlegt"
    );
  });

  test("Englische Oberfläche, Inhalte behalten lang=de", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rn_language", "en"));
    await page.goto("/");
    await openVideo(page);
    await page.getByRole("button", { name: "Show transcript" }).click();
    const transcript = page.getByTestId("video-transcript");
    await expect(transcript.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(transcript.getByRole("button", { name: "Transcript (.txt)" })).toBeVisible();
    await expect(
      transcript.getByRole("button", { name: "0:00 – jump to this point" })
    ).toBeVisible();
    await expect(page.getByTestId("transcript-item-sl_1")).toContainText("Visual:");
    await expect(
      page.getByTestId("transcript-item-sl_1").locator('span[lang="de"]').first()
    ).toHaveText("Cloudflare Worker dient als einheitlicher Einstiegspunkt.");
    await expect(page.getByTestId("sign-language-unavailable")).toContainText(
      "no German Sign Language video is available"
    );
  });
});

test.describe("Gebärdensprach-Option mit hinterlegtem Video (Prüfseite)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Bild im Bild, mit Untertitelspur, folgt Start, Pause und Sprung", async ({ page }) => {
    await page.goto("/e2e/fixtures/sign-language.html");
    const toggle = page.getByTestId("toggle-sign-language-button");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("sign-language-unavailable")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    const video = page.getByTestId("sign-language-video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute(
      "aria-label",
      "Gebärdensprachvideo, läuft zeitgleich zur Übersicht"
    );
    await expect(video).toHaveAttribute("data-sign-language", "gsg");
    const track = await video.evaluate(async (el) => {
      const t = el.querySelector("track");
      const src = t?.getAttribute("src") ?? "";
      return {
        kind: t?.getAttribute("kind"),
        blob: src.startsWith("blob:"),
        body: src ? await (await fetch(src)).text() : ""
      };
    });
    expect(track.kind).toBe("captions");
    expect(track.blob).toBe(true);
    expect(track.body.startsWith("WEBVTT")).toBe(true);

    // Liegt innerhalb der Bildfläche (Bild im Bild)
    const inside = await page.evaluate(() => {
      const v = document
        .querySelector("[data-testid='sign-language-video']")
        ?.getBoundingClientRect();
      const s = document.querySelector(".rn-video-screen")?.getBoundingClientRect();
      return Boolean(v && s && v.left >= s.left && v.right <= s.right && v.bottom <= s.bottom);
    });
    expect(inside).toBe(true);

    await page.getByTestId("play-pause-button").click();
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
    await page.getByTestId("play-pause-button").click();
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
    await page.getByTestId("chapter-btn-ch_2").click();
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime)))
      .toBe(15);

    const results = await new AxeBuilder({ page })
      .include("[data-testid='video-overview-player']")
      .withTags(AXE_TAGS)
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("Audio-Übersicht und Bühne: Transkript", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Audio-Player zeigt das Transkript der Hosts und lädt WebVTT mit Stimmen", async ({
    page
  }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-audio-tool").click();
    await page.getByTestId("btn-audio-transcript").click();
    const transcript = page.getByTestId("audio-transcript");
    await expect(transcript.getByRole("listitem")).toHaveCount(3);
    await expect(transcript).toContainText("Host Lea: Willkommen zum Deep Dive!");
    const vtt = await downloadText(page, "transcript-download-captions");
    expect(vtt.text).toContain("<v Host Lea>Willkommen zum Deep Dive!");
    expect(vtt.text).toContain("00:00:05.000 --> 00:00:12.000\n<v Host Jonas>");
  });

  test("Bühne bietet das Transkript als Text und WebVTT an", async ({ page }) => {
    await page.goto("/");
    await openPanel(page, "studio");
    await page.getByTestId("btn-open-deep-dive-stage").click();
    const txt = await downloadText(page, "btn-stage-transcript-txt");
    expect(txt.text).toContain("[0:05] Host Jonas: Genau, und wie D1");
    const vtt = await downloadText(page, "btn-stage-transcript-vtt");
    expect(vtt.text.startsWith("WEBVTT")).toBe(true);
  });
});

test.describe("axe in allen vier Designs (WCAG 2.2 A/AA)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const design of DESIGNS) {
    for (const mode of ["light", "dark"] as const) {
      test(`${design}/${mode}: Video mit Transkript und Audiodeskription, Audio mit Transkript, Bühne`, async ({
        page
      }) => {
        await stubSpeech(page);
        await page.goto("/");
        await chooseDesign(page, design, mode);
        await openVideo(page);
        await page.getByTestId("toggle-ad-button").click();
        await page.getByTestId("toggle-transcript-button").click();
        await expect(page.getByTestId("video-transcript")).toBeVisible();
        const video = await new AxeBuilder({ page })
          .include("[data-testid='video-overview-player']")
          .withTags(AXE_TAGS)
          .analyze();
        expect(video.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

        await page.getByTestId("btn-back-to-studio-overview").click();
        await page.getByTestId("btn-open-audio-tool").click();
        await page.getByTestId("btn-audio-transcript").click();
        await expect(page.getByTestId("audio-transcript")).toBeVisible();
        const audio = await new AxeBuilder({ page })
          .include(".audio-player-container")
          .withTags(AXE_TAGS)
          .analyze();
        expect(audio.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

        await page.getByTestId("btn-back-to-studio-overview").click();
        await page.getByTestId("btn-open-deep-dive-stage").click();
        await expect(page.getByTestId("deep-dive-stage")).toBeVisible();
        const stage = await new AxeBuilder({ page })
          .include("[data-testid='deep-dive-stage']")
          .withTags(AXE_TAGS)
          .analyze();
        expect(stage.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  }
});

test.describe("Screenreader-Sicht (Accessibility-Tree)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Video: Bedienelemente, Transkript und Bildbeschreibung im Baum", async ({ page }) => {
    await stubSpeech(page);
    await page.goto("/");
    await openVideo(page);
    await page.getByTestId("toggle-ad-button").click();
    await page.getByTestId("toggle-transcript-button").click();
    const player = page.getByTestId("video-overview-player");
    await expect(player).toMatchAriaSnapshot(`
      - button "Untertitel" [pressed]
      - button "Audiodeskription" [pressed]
      - button "Vorlesen"
      - button "Transkript ausblenden" [expanded]
    `);
    await expect(page.getByTestId("video-transcript")).toMatchAriaSnapshot(`
      - region "Transkript":
        - heading "Transkript" [level=3]
        - button "Transkript (.txt)"
        - button "Untertitel (.vtt)"
        - button "Audiodeskription (.vtt)"
        - list "Abschnitte des Transkripts":
          - listitem:
            - button "0:00 – an diese Stelle springen"
            - paragraph: Einführung
            - paragraph: Cloudflare Worker dient als einheitlicher Einstiegspunkt.
            - paragraph: /Bild. Titel-Folie mit Cloudflare Edge Stack Überblick/
          - listitem:
            - button "0:15 – an diese Stelle springen"
            - paragraph: Edge & Vektoren
            - paragraph: int8 Quantisierung spart 75 Prozent Speicherplatz bei hoher Genauigkeit.
            - paragraph: /Bild. Folie zu int8 Quantisierung/
    `);
    await expect(page.getByTestId("video-ad-text")).toMatchAriaSnapshot(
      "- paragraph: /Bildbeschreibung. Titel-Folie mit Cloudflare Edge Stack Überblick/"
    );
  });
});
