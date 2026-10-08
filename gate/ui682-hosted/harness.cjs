"use strict";
/* UI682 hosted fixture harness. Serves the exact b2f6 orchestra static
   files plus a scripted /orchestra/snapshot and /orchestra/events pair
   driven by fixture-events-recovery.json. No dependencies. */

const { readFileSync, existsSync } = require("node:fs");
const http = require("node:http");
const { resolve, sep } = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const FIXTURE_PATH = arg("--fixture", "bend2/ui/orchestra/fixtures/fixture-events-recovery.json");
const STATIC_ROOT = resolve(arg("--static-root", "bend2/ui/orchestra"));
const PORT = Number(arg("--port", "0"));

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const step1 = fixture.script.find((s) => s.step === 1).respond;
const step2 = fixture.script.find((s) => s.step === 2).respond;

const STATIC_TYPES = new Map([
  ["/", "text/html; charset=utf-8"],
  ["/index.html", "text/html; charset=utf-8"],
  ["/app.js", "text/javascript; charset=utf-8"],
  ["/styles.css", "text/css; charset=utf-8"],
]);

const INITIAL_MODE = arg("--initial-mode", "recovery");
if (!["recovery", "terminal", "hangonce"].includes(INITIAL_MODE)) {
  process.stderr.write(`bad --initial-mode ${INITIAL_MODE}\n`);
  process.exitCode = 2;
  return;
}

const log = {
  fixture: FIXTURE_PATH,
  snapshotCount: 0,
  snapshotCursor: "fixture-events-0-boot",
  mode: INITIAL_MODE,
  eventsAttempts: [],
};

function say(kind, fields) {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), kind, ...fields }) + "\n");
}

function snapshotBody(query) {
  return {
    contractVersion: 1,
    cursor: log.snapshotCursor,
    capturedAt: new Date().toISOString(),
    subject: query.get("subject") || fixture.subject,
    selection: {
      mode: "subtree",
      rule: "parent-owner-member-routes-v1",
      reader: "fixture-reader",
      scope: [fixture.subject],
      gap: false,
    },
    players: [],
    ensembles: [],
    transitions: [],
    tasks: {},
    providers: {},
  };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (!STATIC_TYPES.has(pathname)) {
    res.writeHead(404).end();
    return;
  }
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = resolve(STATIC_ROOT, file);
  if (candidate !== resolve(STATIC_ROOT, file) || !candidate.startsWith(STATIC_ROOT + sep) || !existsSync(candidate)) {
    res.writeHead(404).end();
    return;
  }
  const data = readFileSync(candidate);
  res.writeHead(200, {
    "content-type": STATIC_TYPES.get(pathname),
    "cache-control": "no-store",
    "content-length": data.length,
  });
  res.end(data);
}

function writeFrame(res, frame) {
  res.write(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/harness/log") {
    return sendJson(res, 200, log);
  }
  if (req.method === "POST" && url.pathname === "/harness/mode") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try {
        const mode = JSON.parse(raw).mode;
        if (!["recovery", "terminal", "hangonce"].includes(mode)) return sendJson(res, 400, { error: "bad-mode" });
        log.mode = mode;
        say("mode", { mode });
        return sendJson(res, 200, { mode });
      } catch {
        return sendJson(res, 400, { error: "bad-json" });
      }
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/orchestra/snapshot") {
    log.snapshotCount += 1;
    say("snapshot", { count: log.snapshotCount, query: url.search });
    return sendJson(res, 200, snapshotBody(url.searchParams));
  }
  if (req.method === "GET" && url.pathname === "/orchestra/events") {
    const accept = req.headers.accept || "";
    const kind = accept.includes("text/event-stream") ? "eventsource" : "probe";
    const attempt = {
      seq: log.eventsAttempts.length + 1,
      kind,
      accept,
      query: url.search,
      subject: url.searchParams.get("subject"),
      since: url.searchParams.get("since"),
      generation: url.searchParams.get("generation"),
      mode: log.mode,
      headersSentAt: new Date().toISOString(),
    };
    log.eventsAttempts.push(attempt);
    if (log.mode === "terminal") {
      attempt.status = 503;
      attempt.error = "native-owner-subscription-unavailable";
      say("events", { ...attempt });
      return sendJson(res, 503, { error: "native-owner-subscription-unavailable" });
    }
    if (log.mode === "hangonce") {
      const modeSeq = log.eventsAttempts.filter((a) => a.mode === "hangonce").length;
      if (modeSeq === 1) {
        attempt.status = step1.status;
        attempt.error = step1.body.error;
        say("events", { ...attempt });
        return sendJson(res, step1.status, step1.body);
      }
      if (modeSeq === 2) {
        attempt.hung = true;
        attempt.headersSentAt = null;
        attempt.closedBy = null;
        attempt.headersSentOnClose = null;
        attempt.hangElapsedMs = null;
        const start = process.hrtime.bigint();
        say("events", { ...attempt, note: "holding without headers until client aborts" });
        req.on("close", () => {
          attempt.closedAt = new Date().toISOString();
          attempt.closedBy = "client";
          attempt.headersSentOnClose = res.headersSent;
          attempt.hangElapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
          say("events-closed", { seq: attempt.seq, hangElapsedMs: attempt.hangElapsedMs, headersSent: attempt.headersSentOnClose });
        });
        return;
      }
    }
    if (attempt.seq === 1) {
      attempt.status = step1.status;
      attempt.error = step1.body.error;
      say("events", { ...attempt });
      return sendJson(res, step1.status, step1.body);
    }
    attempt.status = step2.status;
    attempt.frames = step2.frames.map((f) => f.id);
    attempt.closedBy = null;
    log.snapshotCursor = step2.frames[step2.frames.length - 1].id;
    say("events", { ...attempt });
    res.writeHead(step2.status, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
    });
    for (const frame of step2.frames) writeFrame(res, frame);
    req.on("close", () => {
      attempt.closedAt = new Date().toISOString();
      attempt.closedBy = "client";
      say("events-closed", { seq: attempt.seq, closedAt: attempt.closedAt });
    });
    return;
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end();
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), kind: "listening", port: addr.port }) + "\n");
});
