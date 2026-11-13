import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-Prüfungen der Web-App (Zoom 200 %, mobiler Kopf, Bewegung, Schriftgrößen).
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
    {
      name: "chromium",
      testIgnore: /einwilligung\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      // Einwilligung (Issues #260, #261): eigener Server mit Test-Container-ID,
      // damit Banner und Tag Manager geprüft werden können. Anfragen an Google werden
      // im Test abgefangen und nie ins Netz geschickt.
      name: "einwilligung",
      testMatch: /einwilligung\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" }
    }
  ],
  webServer: [
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_GTM_ID: "GTM-TEST0001" }
    }
  ]
});
