import { defineConfig, devices } from "@playwright/test";

/**
 * Browser- und Geräte-Matrix (Issue #255, Vorgabe F351). Jeder Eintrag läuft in der CI als
 * eigener Matrix-Job (`e2e-matrix` in .github/workflows/ci.yml). Die Kanäle `chrome-beta` und
 * `msedge-beta` prüfen kommende Versionen; Firefox und WebKit sind die von Playwright
 * mitgelieferten Fassungen. Nichts wird übersprungen: jede Spec ist nur den Projekten
 * zugeordnet, für die sie gilt.
 */
const DESKTOP_MATRIX = [
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
  { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  { name: "chrome-beta", use: { ...devices["Desktop Chrome"], channel: "chrome-beta" } },
  { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  { name: "msedge-beta", use: { ...devices["Desktop Edge"], channel: "msedge-beta" } },
  // Nur im nächtlichen, nicht blockierenden Workflow e2e-matrix-nightly.yml (Issue #431).
  { name: "msedge-dev", use: { ...devices["Desktop Edge"], channel: "msedge-dev" } }
] as const;

const TOUCH_MATRIX = [
  { name: "phone-android", use: { ...devices["Pixel 7"] } },
  { name: "phone-android-landscape", use: { ...devices["Pixel 7 landscape"] } },
  { name: "phone-ios", use: { ...devices["iPhone 13"] } },
  { name: "phone-ios-landscape", use: { ...devices["iPhone 13 landscape"] } },
  { name: "tablet-ios", use: { ...devices["iPad Pro 11"] } },
  { name: "tablet-ios-landscape", use: { ...devices["iPad Pro 11 landscape"] } },
  { name: "tablet-android", use: { ...devices["Galaxy Tab S4"] } },
  { name: "tablet-android-landscape", use: { ...devices["Galaxy Tab S4 landscape"] } }
] as const;

/**
 * E2E-Prüfungen der Web-App (Zoom 200 %, mobiler Kopf, Bewegung, Schriftgrößen) sowie
 * eine Browser-Matrix für Desktop-Browser, Kanäle und Touch-Geräte.
 * Aufruf: pnpm --filter @notebook-lm/web test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  // Node-build tests run with playwright.node.config.ts (test:e2e:node).
  testIgnore: ["node/**"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    // Vollständige E2E-Suite: nur Chromium (der e2e-Job in ci.yml).
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["node/**", /browser-touch\.spec\.ts/]
    },
    ...DESKTOP_MATRIX.map(({ name, use }) => ({
      name,
      use,
      testMatch: /browser-(matrix|zoom)\.spec\.ts/
    })),
    ...TOUCH_MATRIX.map(({ name, use }) => ({
      name,
      use,
      testMatch: /browser-(matrix|touch)\.spec\.ts/
    }))
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
