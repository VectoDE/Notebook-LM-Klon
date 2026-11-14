import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  OCR_LANGUAGES,
  type OcrLogMessage,
  type OcrRecognizer,
  OcrUnreadableError,
  createTesseractRecognizer,
  ocrProgressFromLog,
  recognizeImageText
} from "../workers/ocr-extract.js";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** Sprachdaten aus node_modules in einen gemeinsamen Ordner, ganz ohne Netz. */
const webRequire = createRequire(new URL("../../package.json", import.meta.url));
const langDir = mkdtempSync(path.join(tmpdir(), "ocr-lang-"));
for (const lang of OCR_LANGUAGES) {
  const pkg = path.dirname(webRequire.resolve(`@tesseract.js-data/${lang}/package.json`));
  copyFileSync(
    path.join(pkg, "4.0.0_best_int", `${lang}.traineddata.gz`),
    path.join(langDir, `${lang}.traineddata.gz`)
  );
}
afterAll(() => rmSync(langDir, { recursive: true, force: true }));

const fakeRecognizer =
  (result: { text: string; confidence: number }, logs: OcrLogMessage[] = []): OcrRecognizer =>
  async (_image, onLog) => {
    for (const log of logs) onLog(log);
    return result;
  };

describe("OCR-Fortschritt (#153)", () => {
  it("bildet die Tesseract-Phasen auf 0–100 % ab", () => {
    expect(ocrProgressFromLog({ status: "loading tesseract core", progress: 1 })).toBe(10);
    expect(ocrProgressFromLog({ status: "loading language traineddata", progress: 0.5 })).toBe(20);
    expect(ocrProgressFromLog({ status: "recognizing text", progress: 0 })).toBe(30);
    expect(ocrProgressFromLog({ status: "recognizing text", progress: 1 })).toBe(100);
    // Ungültige Werte werden begrenzt
    expect(ocrProgressFromLog({ status: "recognizing text", progress: 7 })).toBe(100);
    expect(ocrProgressFromLog({ status: "initializing api", progress: Number.NaN })).toBe(0);
    expect(ocrProgressFromLog({ status: "initializing api", progress: -1 })).toBe(0);
  });

  it("meldet Fortschritt nur steigend und endet bei 100 %", async () => {
    const seen: number[] = [];
    const text = await recognizeImageText({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      onProgress: (p) => seen.push(p),
      recognize: fakeRecognizer({ text: "Hallo Welt \nzweite Zeile ", confidence: 91 }, [
        { status: "loading tesseract core", progress: 1 },
        { status: "loading language traineddata", progress: 1 },
        { status: "recognizing text", progress: 0.5 },
        { status: "recognizing text", progress: 0.4 },
        { status: "recognizing text", progress: 0.9 }
      ])
    });
    expect(text).toBe("Hallo Welt\nzweite Zeile");
    expect(seen).toEqual([0, 10, 30, 65, 93, 100]);
  });

  it("sendet 100 % nicht doppelt und kommt ohne Fortschritts-Callback aus", async () => {
    const seen: number[] = [];
    await recognizeImageText({
      data: new Uint8Array([1]),
      mimeType: "IMAGE/JPEG",
      onProgress: (p) => seen.push(p),
      recognize: fakeRecognizer({ text: "Text", confidence: 80 }, [
        { status: "recognizing text", progress: 1 }
      ])
    });
    expect(seen).toEqual([0, 100]);
    await expect(
      recognizeImageText({
        data: new Uint8Array([1]),
        mimeType: "image/webp",
        recognize: fakeRecognizer({ text: "Text", confidence: 80 }, [
          { status: "recognizing text", progress: 1 }
        ])
      })
    ).resolves.toBe("Text");
  });

  it("lehnt leere, unsichere oder nicht unterstützte Bilder ab", async () => {
    const base = { data: new Uint8Array([1]), mimeType: "image/png" };
    await expect(
      recognizeImageText({ ...base, recognize: fakeRecognizer({ text: "  \n ", confidence: 95 }) })
    ).rejects.toBeInstanceOf(OcrUnreadableError);
    await expect(
      recognizeImageText({ ...base, recognize: fakeRecognizer({ text: "x#~", confidence: 12 }) })
    ).rejects.toThrow(/kein lesbarer Text/);
    await expect(
      recognizeImageText({
        ...base,
        data: new Uint8Array(),
        recognize: fakeRecognizer({ text: "", confidence: 0 })
      })
    ).rejects.toThrow(/leer/);
    await expect(
      recognizeImageText({
        ...base,
        mimeType: "image/gif",
        recognize: fakeRecognizer({ text: "", confidence: 0 })
      })
    ).rejects.toThrow(/nicht unterstützt/);
  });
});

describe("Echte Texterkennung mit Tesseract.js (Node, lokale Sprachdaten DE/EN) (#153)", () => {
  const recognize = createTesseractRecognizer({ langPath: langDir, cachePath: langDir });

  it("erkennt den Text eines PNG-Bildes und meldet Fortschritt bis 100 %", async () => {
    const seen: number[] = [];
    const text = await recognizeImageText({
      data: fixture("ocr-text.png"),
      mimeType: "image/png",
      onProgress: (p) => seen.push(p),
      recognize
    });
    expect(text).toMatch(/Quellen lesen im Browser/);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
    // Zwischenstände aus dem Laden von Kern und Sprachdaten bzw. der Erkennung
    expect(seen.length).toBeGreaterThan(2);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] as number).toBeGreaterThan(seen[i - 1] as number);
    }
  }, 120_000);

  it("meldet ein leeres Bild als unlesbar", async () => {
    await expect(
      recognizeImageText({ data: fixture("ocr-blank.png"), mimeType: "image/png", recognize })
    ).rejects.toBeInstanceOf(OcrUnreadableError);
  }, 120_000);
});
