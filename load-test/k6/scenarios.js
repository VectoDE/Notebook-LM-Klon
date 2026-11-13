// k6-Lastprofil für RelationNotes (Issues #352 und #256).
//
// Profile (Umgebungsvariable PROFILE):
//   local  Drei Szenarien mit vielen gleichzeitigen simulierten Nutzern (Standard 200) gegen
//          einen lokal gestarteten Worker (wrangler dev): Besucher, Gäste mit Suche und
//          Gäste, die eine Quelle hochladen, chatten und einen Studio-Job anstoßen. Der Chat
//          läuft gegen ein lokales Test-LLM (load-test/fake-ollama.mjs), nie gegen echte KI.
//   smoke  Kleiner Live-Rauchtest (2-5 VUs, kurz). Nur öffentliche, lesende Endpunkte:
//          keine Konten, keine KI-Aufrufe, kein Schreibzugriff.
//
// Aufruf (siehe docs/load-test.md):
//   k6 run -e BASE_URL=http://127.0.0.1:8787 -e PROFILE=local load-test/k6/scenarios.js
//
// Hinweis zum Rate-Limit: Der Worker begrenzt je Client (IP bzw. Nutzer). Für das lokale Profil
// startet das Skript den Worker mit TRUSTED_PROXY_HEADER=x-forwarded-for; jede VU sendet ihre
// eigene Adresse, damit viele getrennte Nutzer simuliert werden. Antworten mit 429 zählen
// getrennt (rate_limited) und gelten nicht als Fehler.

import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const PROFILE = __ENV.PROFILE || "local";
const PEAK_VUS = Number(__ENV.PEAK_VUS || 200);
const HOLD = __ENV.HOLD || "90s";
// Offizieller Cloudflare-Testtoken (Dummy), passt zum Test-Secret 1x000...AA.
const TURNSTILE_TOKEN = __ENV.TURNSTILE_TOKEN || "XXXX.DUMMY.TOKEN.XXXX";

if (PROFILE !== "local" && PROFILE !== "smoke") {
  throw new Error(`Unbekanntes PROFILE '${PROFILE}' (erlaubt: local, smoke)`);
}

const rateLimited = new Counter("rate_limited");
const guestLoginFailed = new Counter("guest_login_failed");
const unexpectedStatus = new Rate("unexpected_status");
const healthDuration = new Trend("endpoint_health", true);
const demoInfoDuration = new Trend("endpoint_demo_info", true);
const spaDuration = new Trend("endpoint_spa_index", true);
const guestDuration = new Trend("endpoint_guest_login", true);
const providersDuration = new Trend("endpoint_providers", true);
const searchDuration = new Trend("endpoint_search_fts", true);
const jobsDuration = new Trend("endpoint_jobs", true);
const uploadDuration = new Trend("endpoint_source_upload", true);
const chatDuration = new Trend("endpoint_chat", true);
const studioDuration = new Trend("endpoint_studio_enqueue", true);

// 429 ist erwartetes Verhalten des Rate-Limiters und kein Fehler im Sinne von http_req_failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

function ramp(peak) {
  return [
    { duration: "30s", target: Math.max(1, Math.round(peak * 0.25)) },
    { duration: "45s", target: peak },
    { duration: HOLD, target: peak },
    { duration: "15s", target: 0 }
  ];
}

// Anteile an der Spitzenlast: 30 % Besucher, 30 % Gäste mit Suche, 40 % aktive Gäste.
const localScenarios = {
  public_visitors: {
    executor: "ramping-vus",
    exec: "publicVisitor",
    startVUs: 0,
    stages: ramp(Math.max(1, Math.round(PEAK_VUS * 0.3))),
    gracefulRampDown: "10s"
  },
  guest_members: {
    executor: "ramping-vus",
    exec: "guestMember",
    startVUs: 0,
    stages: ramp(Math.max(1, Math.round(PEAK_VUS * 0.3))),
    gracefulRampDown: "10s"
  },
  source_creators: {
    executor: "ramping-vus",
    exec: "sourceCreator",
    startVUs: 0,
    stages: ramp(Math.max(1, Math.round(PEAK_VUS * 0.4))),
    gracefulRampDown: "20s"
  }
};

const smokeScenarios = {
  live_smoke: {
    executor: "constant-vus",
    exec: "publicVisitor",
    vus: Number(__ENV.SMOKE_VUS || 3),
    duration: __ENV.SMOKE_DURATION || "30s"
  }
};

export const options = {
  // Der Gast-Cookie muss über alle Iterationen einer VU erhalten bleiben (k6 leert ihn sonst).
  noCookiesReset: true,
  scenarios: PROFILE === "smoke" ? smokeScenarios : localScenarios,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    unexpected_status: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    checks: ["rate>0.99"],
    // Je Ablauf (Issue #256). Der Upload zählt seine vier Schritte einzeln.
    "http_req_duration{endpoint:guest_login}": ["p(95)<1000"],
    "http_req_duration{endpoint:search_fts}": ["p(95)<800"],
    "http_req_duration{endpoint:source_upload}": ["p(95)<1000"],
    "http_req_duration{endpoint:chat}": ["p(95)<2000"],
    "http_req_duration{endpoint:studio_enqueue}": ["p(95)<800"]
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"]
};

function clientHeaders() {
  // Eigene Adresse je VU (nur wirksam, wenn der Worker TRUSTED_PROXY_HEADER=x-forwarded-for hat).
  const headers = { accept: "application/json" };
  if (PROFILE === "local") {
    headers["x-forwarded-for"] = `10.${(__VU >> 8) & 255}.${__VU & 255}.7`;
  }
  return headers;
}

function track(res, trend, ok) {
  trend.add(res.timings.duration);
  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }
  unexpectedStatus.add(!ok);
}

export function publicVisitor() {
  const headers = clientHeaders();

  const health = http.get(`${BASE_URL}/api/v1/health`, { headers, tags: { endpoint: "health" } });
  const healthOk = check(health, {
    "health: 200": (r) => r.status === 200 || r.status === 429,
    "health: status ok": (r) => r.status === 429 || r.json("status") === "ok"
  });
  track(health, healthDuration, healthOk);
  sleep(0.5 + Math.random());

  const info = http.get(`${BASE_URL}/api/v1/demo/info`, {
    headers,
    tags: { endpoint: "demo_info" }
  });
  const infoOk = check(info, {
    "demo/info: 200": (r) => r.status === 200 || r.status === 429,
    "demo/info: Notebooks vorhanden": (r) =>
      r.status === 429 || (Array.isArray(r.json("notebooks")) && r.json("notebooks").length > 0)
  });
  track(info, demoInfoDuration, infoOk);
  sleep(0.5 + Math.random());

  const spa = http.get(`${BASE_URL}/`, {
    headers: { ...headers, accept: "text/html" },
    tags: { endpoint: "spa_index" }
  });
  const spaOk = check(spa, {
    "SPA: 200 und HTML": (r) =>
      r.status === 429 || (r.status === 200 && String(r.headers["Content-Type"]).includes("html"))
  });
  track(spa, spaDuration, spaOk);
  sleep(1 + Math.random());
}

// Pro VU einmalig: Gastzugang (offizielle Turnstile-Testschlüssel) und Zielnotebook ermitteln.
const memberState = { ready: false, failed: false, notebookId: "" };

function loginAsGuest(headers) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/guest`,
    JSON.stringify({ turnstileToken: TURNSTILE_TOKEN, locale: "de" }),
    {
      headers: { ...headers, "content-type": "application/json", origin: BASE_URL },
      tags: { endpoint: "guest_login" }
    }
  );
  guestDuration.add(res.timings.duration);
  const ok = check(res, { "guest: 201": (r) => r.status === 201 });
  if (!ok) {
    guestLoginFailed.add(1);
    unexpectedStatus.add(true);
    return false;
  }
  unexpectedStatus.add(false);
  const demoNotebooks = http.get(`${BASE_URL}/api/v1/demo/info`, { headers });
  const list = demoNotebooks.status === 200 ? demoNotebooks.json("notebooks") : [];
  memberState.notebookId = Array.isArray(list) && list.length > 0 ? list[0].id : "";
  return memberState.notebookId !== "";
}

export function guestMember() {
  const headers = clientHeaders();
  if (!memberState.ready && !memberState.failed) {
    memberState.ready = loginAsGuest(headers);
    memberState.failed = !memberState.ready;
  }
  if (memberState.failed) {
    sleep(2);
    return;
  }

  const providers = http.get(`${BASE_URL}/api/v1/providers`, {
    headers,
    tags: { endpoint: "providers" }
  });
  const providersOk = check(providers, {
    "providers: 200": (r) => r.status === 200 || r.status === 429,
    "providers: Katalog": (r) => r.status === 429 || Array.isArray(r.json("providers"))
  });
  track(providers, providersDuration, providersOk);
  sleep(0.8 + Math.random());

  const search = http.post(
    `${BASE_URL}/api/v1/notebooks/${memberState.notebookId}/search`,
    JSON.stringify({ query: "Quelle Zitat", mode: "fts", limit: 5 }),
    {
      headers: { ...headers, "content-type": "application/json", origin: BASE_URL },
      tags: { endpoint: "search_fts" }
    }
  );
  const searchOk = check(search, {
    "search(fts): 200": (r) => r.status === 200 || r.status === 429
  });
  track(search, searchDuration, searchOk);
  sleep(0.8 + Math.random());

  const jobs = http.get(`${BASE_URL}/api/v1/jobs?notebookId=${memberState.notebookId}`, {
    headers,
    tags: { endpoint: "jobs" }
  });
  const jobsOk = check(jobs, { "jobs: 200": (r) => r.status === 200 || r.status === 429 });
  track(jobs, jobsDuration, jobsOk);
  sleep(0.8 + Math.random());
}

// Aktive Gäste: eigener Gastzugang mit eigenem Notizbuch (demoNotebookId), dann je Durchlauf
// Suche, Chat und Studio-Job, in den ersten drei Durchläufen zusätzlich ein Quellen-Upload.
// Pausen von 6 bis 10 Sekunden halten jeden Nutzer unter den Limits (Upload 10/min, Chat 20/min).
const creatorState = { ready: false, failed: false, notebookId: "", round: 0 };

const SOURCE_TEXT =
  "RelationNotes speichert Quellen in D1 und R2. Die Suche kombiniert Volltext und Vektoren. " +
  "Antworten im Chat nennen die Stellen der Quelle, auf denen sie beruhen. ";

function jsonParams(headers, endpoint, extra) {
  return {
    headers: { ...headers, "content-type": "application/json", origin: BASE_URL, ...extra },
    tags: { endpoint }
  };
}

function loginCreator(headers) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/guest`,
    JSON.stringify({ turnstileToken: TURNSTILE_TOKEN, locale: "de" }),
    jsonParams(headers, "guest_login")
  );
  guestDuration.add(res.timings.duration);
  const ok = check(res, {
    "guest(aktiv): 201 mit Notizbuch": (r) => r.status === 201 && Boolean(r.json("demoNotebookId"))
  });
  unexpectedStatus.add(!ok);
  if (!ok) {
    guestLoginFailed.add(1);
    return false;
  }
  creatorState.notebookId = res.json("demoNotebookId");
  return true;
}

function uploadSource(headers) {
  const content = `${SOURCE_TEXT.repeat(12)}Lasttest VU ${__VU}, Durchlauf ${creatorState.round}.`;
  const steps = [];
  const init = http.post(
    `${BASE_URL}/api/v1/notebooks/${creatorState.notebookId}/sources`,
    JSON.stringify({
      filename: `lasttest-${__VU}-${creatorState.round}.txt`,
      mimeType: "text/plain",
      byteSize: content.length
    }),
    jsonParams(headers, "source_upload")
  );
  steps.push(init);
  let ok = check(init, { "upload: 201 angelegt": (r) => r.status === 201 });
  if (ok) {
    const sourceId = init.json("sourceId");
    const put = http.put(
      `${BASE_URL}/api/v1/sources/${sourceId}/upload`,
      content,
      jsonParams(headers, "source_upload", { "content-type": "text/plain" })
    );
    steps.push(put);
    ok = check(put, { "upload: 200 Datei gespeichert": (r) => r.status === 200 });
    if (ok) {
      const done = http.post(
        `${BASE_URL}/api/v1/sources/${sourceId}/upload/complete`,
        "{}",
        jsonParams(headers, "source_upload")
      );
      steps.push(done);
      ok = check(done, { "upload: 200 geprüft und bereit": (r) => r.status === 200 });
    }
    if (ok) {
      const chunks = http.post(
        `${BASE_URL}/api/v1/sources/${sourceId}/chunks`,
        JSON.stringify({ chunks: [{ chunkIndex: 0, text: content }], markReady: true }),
        jsonParams(headers, "source_upload")
      );
      steps.push(chunks);
      ok = check(chunks, { "upload: 200 Chunks gespeichert": (r) => r.status === 200 });
    }
  }
  for (const res of steps) uploadDuration.add(res.timings.duration);
  if (steps[steps.length - 1].status === 429) rateLimited.add(1);
  else unexpectedStatus.add(!ok);
}

function chatOnce(headers) {
  const res = http.post(
    `${BASE_URL}/api/v1/notebooks/${creatorState.notebookId}/chat`,
    JSON.stringify({ message: "Wie arbeitet die Suche?", model: "llama3", maxChunks: 5 }),
    jsonParams(headers, "chat", { accept: "text/event-stream" })
  );
  const ok = check(res, {
    "chat: 200 als Stream": (r) => r.status === 429 || r.status === 200,
    "chat: Antwort-Token im Stream": (r) =>
      r.status === 429 || (typeof r.body === "string" && r.body.includes("event: token"))
  });
  track(res, chatDuration, ok);
}

function studioJob(headers) {
  const res = http.post(
    `${BASE_URL}/api/v1/jobs/enqueue`,
    JSON.stringify({ notebookId: creatorState.notebookId, kind: "mindmap" }),
    jsonParams(headers, "studio_enqueue")
  );
  const ok = check(res, {
    "studio: 201 Job eingereiht": (r) => r.status === 201 || r.status === 429
  });
  track(res, studioDuration, ok);
}

export function sourceCreator() {
  const headers = clientHeaders();
  if (!creatorState.ready && !creatorState.failed) {
    creatorState.ready = loginCreator(headers);
    creatorState.failed = !creatorState.ready;
  }
  if (creatorState.failed) {
    sleep(2);
    return;
  }
  if (creatorState.round < 3) {
    uploadSource(headers);
    sleep(1 + Math.random());
  }
  const search = http.post(
    `${BASE_URL}/api/v1/notebooks/${creatorState.notebookId}/search`,
    JSON.stringify({ query: "Volltext Vektoren", mode: "fts", limit: 5 }),
    jsonParams(headers, "search_fts")
  );
  const searchOk = check(search, {
    "search(eigenes Notizbuch): 200": (r) => r.status === 200 || r.status === 429
  });
  track(search, searchDuration, searchOk);
  sleep(1 + Math.random());
  chatOnce(headers);
  sleep(1 + Math.random());
  studioJob(headers);
  creatorState.round += 1;
  sleep(3 + Math.random() * 3);
}

function metricValue(data, name, key) {
  const metric = data.metrics[name];
  return metric?.values?.[key];
}

export function handleSummary(data) {
  const outDir = __ENV.REPORT_DIR || "load-test/results";
  const duration = metricValue(data, "http_req_duration", "med");
  const summary = {
    profile: PROFILE,
    baseUrl: PROFILE === "smoke" ? BASE_URL : "lokal",
    generatedAt: new Date().toISOString(),
    k6Version: __ENV.K6_VERSION || "unbekannt",
    requests: metricValue(data, "http_reqs", "count"),
    requestsPerSecond: metricValue(data, "http_reqs", "rate"),
    failedRate: metricValue(data, "http_req_failed", "rate"),
    unexpectedStatusRate: metricValue(data, "unexpected_status", "rate"),
    rateLimited: metricValue(data, "rate_limited", "count") ?? 0,
    guestLoginFailed: metricValue(data, "guest_login_failed", "count") ?? 0,
    checksPassRate: metricValue(data, "checks", "rate"),
    checks: Object.fromEntries(
      (data.root_group?.checks || []).map((c) => [c.name, { passes: c.passes, fails: c.fails }])
    ),
    peakVus: metricValue(data, "vus_max", "max"),
    durationMs: {
      avg: metricValue(data, "http_req_duration", "avg"),
      p50: duration,
      p90: metricValue(data, "http_req_duration", "p(90)"),
      p95: metricValue(data, "http_req_duration", "p(95)"),
      p99: metricValue(data, "http_req_duration", "p(99)"),
      max: metricValue(data, "http_req_duration", "max")
    },
    perEndpointP95Ms: Object.fromEntries(
      Object.keys(data.metrics)
        .filter((name) => name.startsWith("endpoint_"))
        .map((name) => [name.replace("endpoint_", ""), metricValue(data, name, "p(95)")])
    ),
    thresholdsPassed: Object.values(data.metrics).every((m) =>
      Object.values(m.thresholds || {}).every((t) => t.ok)
    )
  };
  const checkLines = (data.root_group?.checks || []).map(
    (c) => `  ${c.name}: ${c.passes} ok, ${c.fails} fehlgeschlagen`
  );
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
  const text = [
    `Profil: ${summary.profile}  VUs (Spitze): ${summary.peakVus}`,
    `Anfragen: ${summary.requests}  RPS: ${round(summary.requestsPerSecond)}`,
    `Fehlerquote: ${round(summary.failedRate * 100)} %  Unerwartete Status: ${round(summary.unexpectedStatusRate * 100)} %  429: ${summary.rateLimited}`,
    `Latenz ms  p50: ${round(summary.durationMs.p50)}  p95: ${round(summary.durationMs.p95)}  p99: ${round(summary.durationMs.p99)}  max: ${round(summary.durationMs.max)}`,
    `Schwellenwerte: ${summary.thresholdsPassed ? "erfüllt" : "VERLETZT"}`,
    "Checks:",
    ...checkLines,
    ""
  ].join("\n");
  return {
    stdout: text,
    [`${outDir}/summary-${PROFILE}.json`]: JSON.stringify({ summary, raw: data }, null, 2)
  };
}
