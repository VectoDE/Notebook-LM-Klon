// Lokales Test-LLM für den Lasttest (Issue #256). Spricht das Ollama-Protokoll (/api/chat als
// NDJSON-Stream), damit der Chat unter Last ohne echte KI, ohne Netz und ohne Kosten läuft.
// Die Antwort ist fest und nennt eine Belegstelle; gemessen wird der Weg durch den Worker
// (Sitzung, Rate-Limit, Suche, Kontextaufbau, SSE), nicht die Qualität eines Modells.
//
//   node load-test/fake-ollama.mjs [port]   (Standard 11434, nur 127.0.0.1 und ::1)

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const ANSWER = ["Die Suche ", "kombiniert Volltext ", "und Vektoren ", "[1]."];

function handle(req, res) {
  if (req.method === "GET" && (req.url === "/" || req.url === "/api/tags")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "llama3" }] }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "nicht unterstützt" }));
    return;
  }
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const content of ANSWER) {
      const line = { model: "llama3", message: { role: "assistant", content }, done: false };
      res.write(`${JSON.stringify(line)}\n`);
    }
    const last = {
      model: "llama3",
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 40,
      eval_count: ANSWER.length
    };
    res.end(`${JSON.stringify(last)}\n`);
  });
}

function listen(port, host) {
  const server = createServer(handle);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolvePromise(server));
  });
}

/**
 * Startet das Test-LLM nur auf der Loopback-Schnittstelle (IPv4 und, falls vorhanden, IPv6),
 * damit "localhost" in jedem Fall trifft und nichts von außen erreichbar ist.
 */
export async function startFakeOllama(port = 11434) {
  const servers = [await listen(port, "127.0.0.1")];
  try {
    servers.push(await listen(port, "::1"));
  } catch {
    // Kein IPv6 auf diesem Rechner: IPv4 reicht.
  }
  return { close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || 11434);
  await startFakeOllama(port);
  console.log(`Test-LLM (Ollama-Protokoll) auf Port ${port}`);
}
