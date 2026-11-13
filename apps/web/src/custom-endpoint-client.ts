/**
 * Browser-Client für den eigenen OpenAI-kompatiblen Endpunkt (BYOM, Issue #247).
 * Der API-Schlüssel wird nur beim Speichern gesendet und nie zurückgelesen.
 */

export interface CustomEndpointState {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly baseUrl: string | null;
  readonly chatModel: string | null;
  readonly embedModel: string | null;
  readonly hasKey: boolean;
}

export interface CustomEndpointInput {
  readonly baseUrl: string;
  readonly chatModel: string;
  readonly embedModel?: string | undefined;
  readonly apiKey?: string | undefined;
}

export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly message?: string | undefined;
  readonly models?: readonly string[] | undefined;
}

/** Fehler mit Status und Code aus einer Problem-Details-Antwort. */
export class EndpointApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Ergebnis eines fehlgeschlagenen Verbindungstests, falls die Antwort eines enthielt. */
  readonly result: ConnectionTestResult | undefined;
  constructor(message: string, status: number, code?: string, result?: ConnectionTestResult) {
    super(message);
    this.name = "EndpointApiError";
    this.status = status;
    this.code = code;
    this.result = result;
  }
}

const BASE = "/api/v1/providers/custom";
const JSON_HEADERS = { "content-type": "application/json" } as const;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function send(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: "same-origin", ...init });
  } catch {
    throw new EndpointApiError("network", 0);
  }
  const body = await readJson(res);
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`;
    const code = typeof body.code === "string" ? body.code : undefined;
    const result =
      typeof body.ok === "boolean" ? (body as unknown as ConnectionTestResult) : undefined;
    throw new EndpointApiError(detail, res.status, code, result);
  }
  return body;
}

export async function loadCustomEndpoint(
  fetchFn: typeof fetch = fetch
): Promise<CustomEndpointState> {
  return (await send(fetchFn, BASE, { method: "GET" })) as unknown as CustomEndpointState;
}

/** Speichert Adresse und Modelle, danach (falls angegeben) den Schlüssel. */
export async function saveCustomEndpoint(
  input: CustomEndpointInput,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const embedModel = input.embedModel?.trim();
  await send(fetchFn, BASE, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      baseUrl: input.baseUrl.trim(),
      chatModel: input.chatModel.trim(),
      ...(embedModel ? { embedModel } : {})
    })
  });
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    await send(fetchFn, "/api/v1/keys/custom", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ apiKey })
    });
  }
}

export async function deleteCustomEndpoint(fetchFn: typeof fetch = fetch): Promise<void> {
  await send(fetchFn, BASE, { method: "DELETE" });
}

/**
 * Verbindungstest. Ein fehlgeschlagener Test (422 mit `ok: false`) ist ein Ergebnis, kein Fehler.
 */
export async function testCustomEndpoint(
  fetchFn: typeof fetch = fetch
): Promise<ConnectionTestResult> {
  try {
    return (await send(fetchFn, `${BASE}/test`, {
      method: "POST"
    })) as unknown as ConnectionTestResult;
  } catch (err) {
    const e = err as EndpointApiError;
    if (e.result) return e.result;
    throw err;
  }
}
