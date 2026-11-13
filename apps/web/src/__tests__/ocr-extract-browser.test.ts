import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_OCR_PATHS, recognizeImageText } from "../workers/ocr-extract.js";

/**
 * Browser-Konfiguration der Texterkennung (#153): selbst gehostete Pfade unter /ocr/, kein
 * blob:-Worker, Deutsch und Englisch, LSTM. Tesseract.js ist hier durch eine Attrappe ersetzt
 * (vi.mock wird vor die Importe gehoben).
 */
const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }));

describe("OCR im Browser ohne fremde CDNs (#153)", () => {
  const terminate = vi.fn(async () => undefined);
  beforeEach(() => {
    createWorker.mockReset();
    terminate.mockClear();
  });

  it("lädt Worker, Kern und Sprachdaten von der eigenen Origin und beendet den Worker", async () => {
    createWorker.mockImplementation(async (_langs, _oem, options) => {
      options.logger({ status: "recognizing text", progress: 0.5 });
      return {
        recognize: async () => ({ data: { text: "Erkannt", confidence: 88 } }),
        terminate
      };
    });
    const seen: number[] = [];
    const text = await recognizeImageText({
      data: new Uint8Array([1]),
      mimeType: "image/png",
      onProgress: (p) => seen.push(p)
    });

    expect(text).toBe("Erkannt");
    expect(seen).toEqual([0, 65, 100]);
    expect(createWorker).toHaveBeenCalledWith(["deu", "eng"], 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      workerBlobURL: false,
      logger: expect.any(Function)
    });
    expect(BROWSER_OCR_PATHS.langPath.startsWith("/")).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("beendet den Worker auch, wenn die Erkennung scheitert", async () => {
    createWorker.mockResolvedValue({
      recognize: async () => {
        throw new Error("Bild kaputt");
      },
      terminate
    });
    await expect(
      recognizeImageText({ data: new Uint8Array([1]), mimeType: "image/png" })
    ).rejects.toThrow("Bild kaputt");
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
