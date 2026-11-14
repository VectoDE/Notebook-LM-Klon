import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourcesPanel } from "../SourcesPanel.js";
import { SourceUploadError } from "../source-upload-client.js";
import {
  createPendingSource,
  markSourceFailed,
  markSourceReady,
  uploadErrorKey
} from "../source-uploads.js";
import { TRANSLATIONS } from "../useTheme.js";
import type { WorkspaceSource } from "../workspace-types.js";

const file = new File(["Die Elbe fließt durch Dresden."], "elbe.txt", { type: "text/plain" });

describe("Zustände einer hochgeladenen Quelle", () => {
  it("legt eine Platzhalter-Quelle an, die noch nicht im Chat ausgewählt ist", () => {
    expect(createPendingSource(file, "tmp_1")).toEqual({
      id: "tmp_1",
      title: "elbe",
      originalName: "elbe.txt",
      mimeType: "text/plain",
      byteSize: file.size,
      isSelected: false,
      status: "processing"
    });
  });

  it("übernimmt nach dem Upload die Server-ID, den Volltext und wählt die Quelle aus", () => {
    const list: WorkspaceSource[] = [createPendingSource(file, "tmp_1")];
    const next = markSourceReady(list, "tmp_1", {
      sourceId: "src_server",
      mimeType: "text/plain",
      chunksCount: 1,
      text: "Die Elbe fließt durch Dresden."
    });
    expect(next).toEqual([
      {
        id: "src_server",
        title: "elbe",
        originalName: "elbe.txt",
        mimeType: "text/plain",
        byteSize: file.size,
        isSelected: true,
        status: "ready",
        chunksCount: 1,
        rawText: "Die Elbe fließt durch Dresden."
      }
    ]);
  });

  it("markiert einen Fehlschlag, die Quelle bleibt sichtbar und abgewählt", () => {
    const list: WorkspaceSource[] = [createPendingSource(file, "tmp_1")];
    const next = markSourceFailed(list, "tmp_1", "errorAuth");
    expect(next[0]).toMatchObject({ id: "tmp_1", status: "error", errorKey: "errorAuth" });
    expect(next[0]?.isSelected).toBe(false);
  });

  it("ordnet Fehler einem Text im Sprachkatalog zu", () => {
    expect(uploadErrorKey(new SourceUploadError("x", 0, "UNSUPPORTED_TYPE"))).toBe("srcErrorType");
    expect(uploadErrorKey(new SourceUploadError("x", 0, "NO_TEXT"))).toBe("srcErrorEmpty");
    expect(uploadErrorKey(new SourceUploadError("x", 0, "NETWORK_ERROR"))).toBe("errorNetwork");
    expect(uploadErrorKey(new SourceUploadError("x", 401, "UNAUTHORIZED"))).toBe("errorAuth");
    expect(uploadErrorKey(new SourceUploadError("x", 415, "MAGIC_BYTES_MISMATCH"))).toBe(
      "srcErrorType"
    );
    expect(uploadErrorKey(new SourceUploadError("x", 413, "FILE_TOO_LARGE"))).toBe("srcErrorSize");
    expect(uploadErrorKey(new Error("Parser kaputt"))).toBe("srcErrorRead");
    for (const key of ["srcErrorType", "srcErrorEmpty", "srcErrorSize", "srcErrorRead"]) {
      expect(TRANSLATIONS.de[key], key).toBeTruthy();
      expect(TRANSLATIONS.en[key], key).toBeTruthy();
    }
  });
});

describe("SourcesPanel zeigt den Verarbeitungsstand", () => {
  const sources: WorkspaceSource[] = [
    { ...createPendingSource(file, "tmp_1") },
    { ...createPendingSource(new File(["x"], "foto.md"), "tmp_2"), status: "error", errorKey: "srcErrorEmpty" }
  ];

  it("meldet Verarbeitung und Fehler sichtbar und für Screenreader, ohne Auswahl im Chat", () => {
    const html = renderToStaticMarkup(createElement(SourcesPanel, { sources }));
    expect(html).toContain('data-testid="source-status-tmp_1"');
    expect(html).toContain(TRANSLATIONS.de.srcStatusProcessing);
    expect(html).toContain('data-testid="source-status-tmp_2"');
    expect(html).toContain(TRANSLATIONS.de.srcErrorEmpty);
    // Noch nicht bereite Quellen lassen sich nicht für den Chat auswählen
    expect(html).toMatch(/disabled=""[^>]*data-testid="source-checkbox-tmp_1"/);
    expect(html).toMatch(/disabled=""[^>]*data-testid="source-checkbox-tmp_2"/);
    expect(html).toMatch(/role="status"[^>]*data-testid="source-status-tmp_1"/);
  });

  it("bereite Quellen zeigen keinen Status", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: [{ ...createPendingSource(file, "src_ok"), status: "ready", isSelected: true }]
      })
    );
    expect(html).not.toContain('data-testid="source-status-src_ok"');
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="source-checkbox-src_ok"/);
  });
});
