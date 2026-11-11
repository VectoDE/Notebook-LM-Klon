import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "../..");
const html = readFileSync(resolve(webRoot, "index.html"), "utf8");

describe("Logo und Favicon", () => {
  it("bindet Favicon, Apple-Touch-Icon und theme-color in index.html ein", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('<meta name="theme-color" content="#2563EB"');
  });

  it.each(["favicon.svg", "icon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"])(
    "liefert public/%s",
    (file) => {
      expect(existsSync(resolve(webRoot, "public", file))).toBe(true);
    }
  );
});
