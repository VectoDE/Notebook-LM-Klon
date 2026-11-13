import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the Node build (#330): web app and API from `node apps/worker/dist/node-server.js`
 * on one port, as in the Docker image. Needs `pnpm build` first (web app + Node bundle).
 * Call: pnpm --filter @notebook-lm/web test:e2e:node
 */
const PORT = 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// Official Cloudflare Turnstile TEST secret (always passes). Never valid in production.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
// Test-only values, generated per run is not needed: the data directory is thrown away.
const TEST_SALT = "e2e-only-session-salt-0123456789abcdef0123";
const TEST_KEK = "e2e-only-kek-0123456789abcdef0123456789abcd";

export default defineConfig({
  testDir: "./e2e/node",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure"
  },
  projects: [{ name: "chromium-node", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../worker/dist/node-server.js",
    url: `${ORIGIN}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      APP_ORIGIN: ORIGIN,
      APP_PROFILE: "demo",
      DATA_DIR: mkdtempSync(join(tmpdir(), "nlk-e2e-node-")),
      STATIC_DIR: resolve(import.meta.dirname, "dist"),
      SESSION_SALT_SECRET: TEST_SALT,
      KEK_V1: TEST_KEK,
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET
    }
  }
});
