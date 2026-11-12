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

  it("verlinkt Manifest und ICO-Fallback", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<link rel="icon" href="/favicon.ico"');
  });

  it("Manifest verweist nur auf vorhandene Icons, inklusive maskierbarem Icon", () => {
    const manifest = JSON.parse(readFileSync(resolve(webRoot, "public/manifest.webmanifest"), "utf8"));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) {
      expect(existsSync(resolve(webRoot, "public", icon.src.slice(1)))).toBe(true);
    }
  });

  it.each([
    "favicon.svg",
    "favicon.ico",
    "icon.svg",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "og-image.png"
  ])("liefert public/%s", (file) => {
    expect(existsSync(resolve(webRoot, "public", file))).toBe(true);
  });
});
