import { describe, expect, it } from "vitest";
import { spokenTranscriptFile } from "../media-downloads.js";

const lines = [
  { id: "l1", startMs: 0, endMs: 5000, speakerName: "Host Lea", text: "Willkommen zum Deep Dive!" },
  { id: "l2", startMs: 5000, endMs: 9000, speakerName: "Host Jonas", text: "Genau." }
];

describe("spokenTranscriptFile (Issue #350)", () => {
  it("liefert das Transkript als Text mit Sprechern", () => {
    const file = spokenTranscriptFile("txt", "Demo", lines, "de");
    expect(file.filename).toBe("Demo_transkript.txt");
    expect(file.mimeType).toBe("text/plain;charset=utf-8");
    expect(file.content).toContain("Host Lea");
    expect(file.content).toContain("Willkommen zum Deep Dive!");
  });

  it("liefert WebVTT mit Stimmen-Tags", () => {
    const file = spokenTranscriptFile("vtt", "Demo", lines, "de");
    expect(file.filename).toBe("Demo_untertitel.vtt");
    expect(file.mimeType).toBe("text/vtt");
    expect(file.content.startsWith("WEBVTT")).toBe(true);
    expect(file.content).toContain("<v Host Jonas>Genau.");
  });
});
