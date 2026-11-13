import { expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/**
 * Audio-Übersicht (Issue #240) im echten Browser mit einer Sprachausgabe-Attrappe: Headless
 * Chromium hat keine Stimmen, deshalb ersetzt ein Init-Skript speechSynthesis. Die Attrappe
 * protokolliert jede Äußerung (Text, Stimme, Tonhöhe) und beendet sie per Testbefehl.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Utterance = {
      text: string;
      lang: string;
      voice: { name: string } | null;
      pitch: number;
      rate: number;
      onend: (() => void) | null;
      onerror: ((e: { error: string }) => void) | null;
    };
    const voices = [
      { name: "Anna", lang: "de-DE", voiceURI: "Anna", default: true },
      { name: "Markus", lang: "de-DE", voiceURI: "Markus", default: false },
      { name: "Samantha", lang: "en-US", voiceURI: "Samantha", default: false }
    ];
    const log: Array<{ text: string; voice: string | null; pitch: number; lang: string }> = [];
    let current: Utterance | null = null;
    const synth = {
      speak(u: Utterance) {
        current = u;
        log.push({ text: u.text, voice: u.voice?.name ?? null, pitch: u.pitch, lang: u.lang });
      },
      cancel() {
        const u = current;
        current = null;
        u?.onerror?.({ error: "interrupted" });
      },
      pause() {},
      resume() {},
      getVoices: () => voices,
      addEventListener() {},
      removeEventListener() {}
    };
    class FakeUtterance {
      lang = "";
      voice = null;
      pitch = 1;
      rate = 1;
      onend = null;
      onerror = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
      configurable: true
    });
    (window as unknown as Record<string, unknown>).__speech = {
      log,
      finish: () => {
        const u = current;
        current = null;
        u?.onend?.();
      }
    };
  });
});

test("Skript kurz erstellen, mit zwei Stimmen abspielen, per Tastatur steuern", async ({
  page
}) => {
  await page.goto("/");
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-audio-tool").click();
  const overview = page.getByTestId("audio-overview");
  await expect(overview).toBeVisible();

  await page.getByTestId("audio-overview-length-short").check();
  await page.getByTestId("audio-overview-generate").click();
  const transcript = page.getByTestId("audio-overview-transcript");
  await expect(transcript.locator("li").first()).toBeVisible();
  await expect(page.getByTestId("audio-overview-citations")).toContainText("[1]");
  await expect(page.getByTestId("audio-overview-fallback")).toHaveCount(0);

  // Abspielen: erster Beitrag (Host) ist aktiv
  await page.getByTestId("audio-overview-toggle").click();
  await expect(page.getByTestId("audio-overview-state")).toHaveAttribute("data-state", "playing");
  await expect(transcript.locator('li[aria-current="true"]')).toHaveAttribute(
    "data-turn-index",
    "0"
  );

  // Äußerung endet: Transkript folgt, Expertin spricht mit anderer Stimme
  await page.evaluate(() =>
    (window as unknown as { __speech: { finish(): void } }).__speech.finish()
  );
  await expect(transcript.locator('li[aria-current="true"]')).toHaveAttribute(
    "data-turn-index",
    "1"
  );
  const log = await page.evaluate(
    () => (window as unknown as { __speech: { log: Array<{ voice: string | null }> } }).__speech.log
  );
  expect(log[0]?.voice).toBe("Anna");
  expect(log[1]?.voice).toBe("Markus");

  // Tastatur: Pfeil rechts springt weiter, Leertaste pausiert, Escape stoppt
  await transcript.focus();
  await page.keyboard.press("ArrowRight");
  await expect(transcript.locator('li[aria-current="true"]')).toHaveAttribute(
    "data-turn-index",
    "2"
  );
  await page.keyboard.press("ArrowLeft");
  await expect(transcript.locator('li[aria-current="true"]')).toHaveAttribute(
    "data-turn-index",
    "1"
  );
  await page.keyboard.press(" ");
  await expect(page.getByTestId("audio-overview-state")).toHaveAttribute("data-state", "paused");
  await page.keyboard.press("k");
  await expect(page.getByTestId("audio-overview-state")).toHaveAttribute("data-state", "playing");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("audio-overview-state")).toHaveAttribute("data-state", "idle");
  await expect(transcript.locator('li[aria-current="true"]')).toHaveCount(0);
});

test("nur eine Stimme für die Sprache: Hinweis erscheint", async ({ page }) => {
  await page.addInitScript(() => {
    const synth = window.speechSynthesis as unknown as { getVoices: () => unknown[] };
    synth.getVoices = () => [{ name: "Anna", lang: "de-DE", voiceURI: "Anna", default: true }];
  });
  await page.goto("/");
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-audio-tool").click();
  await expect(page.getByTestId("audio-overview-fallback")).toContainText("nur eine Stimme");
});
