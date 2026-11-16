/**
 * Smoke-Check nach einem Deploy (Issue #264).
 *
 * Prüft gegen eine laufende Instanz, ohne Daten anzulegen:
 * 1. GET /api/v1/health antwortet 200 mit status "ok" (D1, R2, Durable Objects erreichbar).
 * 2. GET / liefert die Web-Oberfläche (HTML).
 * 3. Gastzugang: POST /api/v1/auth/guest ohne Turnstile-Token wird mit 403
 *    BOT_VERIFICATION_REQUIRED abgelehnt. Ein 503 hieße: SESSION_SALT_SECRET oder
 *    TURNSTILE_SECRET_KEY fehlen, die Anmeldung wäre für alle gesperrt.
 * 4. Chat: POST /api/v1/notebooks/<id>/chat ohne Sitzung antwortet 401 als
 *    RFC-9457-Problem (Route erreichbar, Zugriffsschutz aktiv).
 *
 * Eine echte Gastanmeldung mit Chat-Antwort braucht ein Turnstile-Token aus dem Browser
 * und bleibt deshalb ein manueller Schritt nach dem Deploy.
 */

export interface SmokeStepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SmokeCheckResult {
  readonly ok: boolean;
  readonly steps: readonly SmokeStepResult[];
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function step(
  name: string,
  run: () => Promise<{ ok: boolean; detail: string }>
): Promise<SmokeStepResult> {
  try {
    const { ok, detail } = await run();
    return { name, ok, detail };
  } catch (err) {
    return { name, ok: false, detail: `Anfrage fehlgeschlagen: ${(err as Error).message}` };
  }
}

/** Normalisiert die Basis-URL (ohne abschließenden Schrägstrich) und lehnt Unsinn ab. */
export function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw || raw.trim() === "") {
    throw new Error("Basis-URL fehlt. Aufruf: smoke-check <https://…>");
  }
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Nicht unterstütztes Protokoll: ${url.protocol}`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export async function runSmokeCheck(
  rawBaseUrl: string,
  fetchFn: FetchFn = fetch
): Promise<SmokeCheckResult> {
  const base = normalizeBaseUrl(rawBaseUrl);
  const origin = new URL(base).origin;
  const jsonHeaders = { "content-type": "application/json", origin };

  const steps: SmokeStepResult[] = [];

  steps.push(
    await step("health", async () => {
      const res = await fetchFn(`${base}/api/v1/health`);
      const body = await readJson(res);
      return {
        ok: res.status === 200 && body.status === "ok",
        detail: `Status ${res.status}, status=${String(body.status)}, version=${String(body.version)}`
      };
    })
  );

  steps.push(
    await step("web", async () => {
      const res = await fetchFn(`${base}/`);
      const type = res.headers.get("content-type") ?? "";
      const html = await res.text();
      return {
        ok: res.status === 200 && type.includes("text/html") && html.includes('<div id="root"'),
        detail: `Status ${res.status}, content-type=${type}`
      };
    })
  );

  steps.push(
    await step("gastzugang", async () => {
      const res = await fetchFn(`${base}/api/v1/auth/guest`, {
        method: "POST",
        headers: jsonHeaders,
        body: "{}"
      });
      const body = await readJson(res);
      return {
        ok: res.status === 403 && body.code === "BOT_VERIFICATION_REQUIRED",
        detail: `Status ${res.status}, code=${String(body.code)}`
      };
    })
  );

  steps.push(
    await step("chat", async () => {
      const res = await fetchFn(`${base}/api/v1/notebooks/smoke-check/chat`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ message: "Smoke-Check" })
      });
      const type = res.headers.get("content-type") ?? "";
      return {
        ok: res.status === 401 && type.includes("application/problem+json"),
        detail: `Status ${res.status}, content-type=${type}`
      };
    })
  );

  return { ok: steps.every((s) => s.ok), steps };
}

export function formatSmokeReport(result: SmokeCheckResult): string {
  const lines = result.steps.map((s) => `${s.ok ? "OK  " : "FEHL"} ${s.name}: ${s.detail}`);
  lines.push(result.ok ? "Smoke-Check bestanden." : "Smoke-Check fehlgeschlagen.");
  return lines.join("\n");
}

/* v8 ignore start */
if (process.argv[1]?.endsWith("smoke-check.ts")) {
  runSmokeCheck(process.argv[2] ?? process.env.DEPLOY_URL ?? "")
    .then((result) => {
      console.log(formatSmokeReport(result));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
/* v8 ignore stop */
