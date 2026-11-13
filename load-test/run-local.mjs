// Startet den Worker lokal (wrangler dev, lokale D1/R2/Durable Objects) und fährt das k6-Lastprofil.
//
//   node load-test/run-local.mjs [--out docs/load-test] [--peak 200] [--hold 90s]
//
// Voraussetzungen: pnpm install, pnpm build (Web-Assets), k6 im PATH oder K6_BIN.
// Es werden ausschließlich offizielle Cloudflare-Testschlüssel für Turnstile verwendet. Das
// Session-Salz wird bei jedem Lauf zufällig erzeugt und nirgends gespeichert. Für den Chat
// startet der Runner ein lokales Test-LLM (fake-ollama.mjs, nur Loopback), keine echte KI.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFakeOllama } from "./fake-ollama.mjs";

const TURNSTILE_TEST_SECRET_ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
const PORT = process.env.LOAD_TEST_PORT || "8787";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const workerDir = join(root, "apps", "worker");
const k6Bin = process.env.K6_BIN || "k6";
const wranglerBin = join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outDir = resolve(root, argument("out", "load-test/results"));
const peak = argument("peak", "200");
const hold = argument("hold", "90s");
mkdirSync(outDir, { recursive: true });

const persistDir = mkdtempSync(join(tmpdir(), "nlk-loadtest-"));
const workerEnv = { ...process.env, CI: "1", NO_COLOR: "1" };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} endete mit Status ${result.status}`);
  }
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // Worker startet noch
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Worker wurde nicht rechtzeitig erreichbar");
}

// Vorprüfung: ein Gast fragt einmal im Chat. Bricht ab, bevor 200 Nutzer losgeschickt werden,
// wenn der Weg Worker -> Test-LLM nicht funktioniert.
async function preflightChat() {
  const headers = { "content-type": "application/json", origin: BASE_URL };
  const login = await fetch(`${BASE_URL}/api/v1/auth/guest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", locale: "de" })
  });
  const { demoNotebookId } = await login.json();
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  let res;
  let body;
  try {
    res = await fetch(`${BASE_URL}/api/v1/notebooks/${demoNotebookId}/chat`, {
      method: "POST",
      headers: { ...headers, cookie, accept: "text/event-stream" },
      body: JSON.stringify({ message: "Vorprüfung", model: "llama3", maxChunks: 5 }),
      signal: AbortSignal.timeout(20_000)
    });
    body = await res.text();
  } catch (error) {
    throw new Error(`Vorprüfung Chat: ${error} (Test-LLM-Aufrufe ${fakeLlm.requests()})`);
  }
  console.log(`Vorprüfung Chat: Status ${res.status}, Test-LLM-Aufrufe ${fakeLlm.requests()}`);
  console.log(body.slice(0, 600));
  if (res.status !== 200 || !body.includes("event: token")) {
    throw new Error("Vorprüfung Chat fehlgeschlagen");
  }
}

let worker;
let fakeLlm;
let exitCode = 1;
try {
  fakeLlm = await startFakeOllama(Number(process.env.FAKE_OLLAMA_PORT || 11434));
  run(
    process.execPath,
    [wranglerBin, "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistDir],
    { cwd: workerDir, env: workerEnv }
  );

  const salt = randomBytes(32).toString("hex");
  worker = spawn(
    process.execPath,
    [
      wranglerBin,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      PORT,
      "--persist-to",
      persistDir,
      "--var",
      `SESSION_SALT_SECRET:${salt}`,
      "--var",
      `TURNSTILE_SECRET_KEY:${TURNSTILE_TEST_SECRET_ALWAYS_PASSES}`,
      "--var",
      "TRUSTED_PROXY_HEADER:x-forwarded-for",
      "--var",
      `APP_ORIGIN:${BASE_URL}`
    ],
    { cwd: workerDir, env: workerEnv, stdio: ["ignore", "pipe", "pipe"] }
  );
  // Worker-Ausgabe landet im Report-Ordner (Artefakt), damit Fehler unter Last nachvollziehbar sind.
  // Das zufällige Session-Salz wird vor dem Schreiben entfernt.
  const workerLog = createWriteStream(join(outDir, "worker.log"));
  const redact = (chunk) => workerLog.write(String(chunk).replaceAll(salt, "[entfernt]"));
  worker.stdout.on("data", redact);
  worker.stderr.on("data", redact);
  await waitForHealth(120_000);
  await preflightChat();

  const k6Version =
    spawnSync(k6Bin, ["version"], { encoding: "utf8" }).stdout?.trim() ?? "unbekannt";

  run(k6Bin, ["run", "load-test/k6/scenarios.js"], {
    cwd: root,
    env: {
      ...process.env,
      BASE_URL,
      PROFILE: "local",
      PEAK_VUS: peak,
      HOLD: hold,
      REPORT_DIR: outDir,
      K6_VERSION: k6Version,
      K6_WEB_DASHBOARD: "true",
      K6_WEB_DASHBOARD_PORT: "-1",
      K6_WEB_DASHBOARD_EXPORT: join(outDir, "report-local-k6.html")
    }
  });
  run(process.execPath, [
    join(root, "load-test", "render-report.mjs"),
    join(outDir, "summary-local.json"),
    join(outDir, "report-local.html")
  ]);
  exitCode = 0;
} catch (error) {
  console.error(String(error));
} finally {
  if (worker?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(worker.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      worker.kill("SIGTERM");
    }
  }
  await fakeLlm?.close();
  rmSync(persistDir, { recursive: true, force: true });
}
process.exit(exitCode);
