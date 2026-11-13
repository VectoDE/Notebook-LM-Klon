import { type Page, expect, test } from "@playwright/test";
import { openPanel } from "./helpers";

/**
 * Video-Export (Issue #241) im echten Chromium: Canvas 1920 × 1080 bei 30 fps, MediaRecorder,
 * Ton aus der TTS-Route. Die Route wird hier mit einer erzeugten WAV-Datei (Sinuston) bedient,
 * weil im E2E-Lauf kein Worker und kein Gemini-Schlüssel läuft. Geprüft wird die fertige
 * WebM-Datei: Video- und Opus-Spur im Container, Abmessungen, Dauer, abspielbar mit Ton.
 */

const TTS_ROUTE = "**/api/v1/notebooks/*/video-tts";

/** WAV, 24 kHz, mono, 16 Bit, Sinuston mit 440 Hz. */
function sineWav(seconds: number): Buffer {
  const rate = 24_000;
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), 44 + i * 2);
  }
  return buf;
}

async function openExport(page: Page) {
  await page.goto("/");
  await openPanel(page, "studio");
  await page.getByTestId("btn-open-video-tool").click();
  await expect(page.getByTestId("video-export")).toBeVisible();
}

test.describe("Video-Export", () => {
  test("ohne Gemini-Schlüssel: verständlicher Hinweis, Export ohne Ton bleibt möglich", async ({
    page
  }) => {
    await page.route(TTS_ROUTE, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 409, code: "TTS_KEY_MISSING", title: "Conflict" })
      })
    );
    await openExport(page);
    await page.getByTestId("video-export-audio").click();
    const alert = page.getByTestId("video-export-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toContainText("Gemini-Schlüssel");
    await expect(alert).toContainText("Einstellungen");
    await expect(page.getByTestId("video-export-silent")).toBeEnabled();
  });

  test("mit TTS-Ton: WebM 1920 × 1080 mit Opus-Spur, Dauer stimmt, abspielbar", async ({
    page
  }) => {
    test.setTimeout(150_000);
    let ttsBody = "";
    await page.route(TTS_ROUTE, async (route) => {
      ttsBody = route.request().postData() ?? "";
      await route.fulfill({ status: 200, contentType: "audio/wav", body: sineWav(2) });
    });
    await openExport(page);
    await page.getByTestId("video-export-audio").click();
    const download = page.getByTestId("video-export-download");
    await expect(download).toBeVisible({ timeout: 120_000 });
    await expect(download).toHaveAttribute("data-has-audio", "true");
    expect(JSON.parse(ttsBody)).toMatchObject({ lang: "de" });
    expect(JSON.parse(ttsBody).text).toContain("Cloudflare Worker");

    const href = (await download.getAttribute("href")) ?? "";
    const report = await page.evaluate(async (url) => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const ascii = Array.from(bytes, (b) =>
        b >= 32 && b < 127 ? String.fromCharCode(b) : "."
      ).join("");
      const video = document.createElement("video");
      video.muted = true;
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(`Video nicht ladbar: ${video.error?.code}`));
      });
      // MediaRecorder-WebM hat keine Dauer im Kopf: ans Ende springen, dann ist sie bekannt
      if (!Number.isFinite(video.duration)) {
        await new Promise<void>((resolve) => {
          video.ontimeupdate = () => {
            if (Number.isFinite(video.duration)) resolve();
          };
          video.currentTime = 1e7;
        });
      }
      const duration = video.duration;
      video.currentTime = 0;
      await video.play();
      await new Promise((r) => setTimeout(r, 1500));
      video.pause();
      const media = video as HTMLVideoElement & {
        webkitAudioDecodedByteCount?: number;
        webkitVideoDecodedByteCount?: number;
      };
      return {
        size: bytes.length,
        hasVideoTrack: /V_VP[89]/.test(ascii),
        hasOpusTrack: ascii.includes("A_OPUS"),
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        played: video.currentTime,
        audioBytes: media.webkitAudioDecodedByteCount ?? -1,
        videoBytes: media.webkitVideoDecodedByteCount ?? -1
      };
    }, href);

    expect(report.size).toBeGreaterThan(10_000);
    expect(report.hasVideoTrack).toBe(true);
    expect(report.hasOpusTrack).toBe(true);
    expect([report.width, report.height]).toEqual([1920, 1080]);
    // Storyboard 30 s, Ton 2 s: das Video dauert 30 s (Toleranz für Start und Ende der Aufnahme)
    expect(report.duration).toBeGreaterThan(28.5);
    expect(report.duration).toBeLessThan(32);
    expect(report.played).toBeGreaterThan(0.5);
    expect(report.audioBytes).toBeGreaterThan(0);
    expect(report.videoBytes).toBeGreaterThan(0);
  });
});
