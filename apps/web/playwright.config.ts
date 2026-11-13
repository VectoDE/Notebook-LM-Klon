import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-Prüfungen der Web-App (Zoom 200 %, mobiler Kopf, Bewegung, Schriftgrößen) sowie
 * eine Browser-Matrix für Firefox, WebKit und Touch-Geräte.
 * Aufruf: pnpm --filter @notebook-lm/web test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Browser- und Touch-Matrix (Issue #255): eigene Prüfungen in Firefox, WebKit
    // (Safari-Engine) und auf zwei Touch-Geräten
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /browser-matrix\.spec\.ts/
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /browser-matrix\.spec\.ts/
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testMatch: /browser-matrix\.spec\.ts/
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
      testMatch: /browser-matrix\.spec\.ts/
    }
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
