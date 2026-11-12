import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SignInDialog } from "../SignInDialog.js";
import { AREA_DE, AREA_EN } from "../translations-areas.js";
import { TURNSTILE_TEST_SITE_KEY } from "../turnstile-client.js";
import { ThemeProvider } from "../useTheme.js";

function render(props: Parameters<typeof SignInDialog>[0]): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement(SignInDialog, props))
  );
}

describe("SignInDialog (Issue #233)", () => {
  it("renders nothing while closed", () => {
    expect(render({ isOpen: false, onClose: vi.fn() })).toBe("");
  });

  it("shows a visible alert and no widget when the site key is missing", () => {
    const html = render({ isOpen: true, onClose: vi.fn(), siteKey: { status: "missing" } });
    expect(html).toContain('data-testid="sign-in-no-site-key"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Anmelden ist gerade nicht möglich");
    expect(html).toContain("Turnstile-Site-Key fehlt");
    expect(html).not.toContain('data-testid="turnstile-widget"');
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="btn-sign-in-guest"/);
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="btn-sign-in-magic"/);
  });

  it("marks the official test key clearly as test mode", () => {
    const html = render({
      isOpen: true,
      onClose: vi.fn(),
      siteKey: { status: "configured", siteKey: TURNSTILE_TEST_SITE_KEY, isTestKey: true }
    });
    expect(html).toContain('data-testid="sign-in-test-key"');
    expect(html).toContain("Testmodus");
    expect(html).toContain('data-testid="turnstile-widget"');
    expect(html).toContain("Bot-Prüfung wird geladen");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain('for="sign-in-email-input"');
  });

  it("hides the test notice for a real key and keeps buttons unavailable until a token exists", () => {
    const html = render({
      isOpen: true,
      onClose: vi.fn(),
      siteKey: { status: "configured", siteKey: "0x4AAA-real", isTestKey: false }
    });
    expect(html).not.toContain("Testmodus");
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="btn-sign-in-guest"/);
  });

  it("uses the development test key by default in the test build", () => {
    const html = render({ isOpen: true, onClose: vi.fn() });
    expect(html).toContain('data-testid="sign-in-test-key"');
  });

  it("has every sign-in text in German and English", () => {
    const keys = Object.keys(AREA_DE).filter((key) => key.startsWith("signIn"));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(AREA_EN[key], key).toBeTruthy();
      expect(AREA_EN[key], key).not.toBe(AREA_DE[key]);
    }
  });
});
