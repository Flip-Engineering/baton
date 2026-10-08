"use strict";
/* UI682 hosted gate abort-expiry case. Exercises the 5-second
   AbortController expiry in the exact b2f6 scheduleEventsRetry
   path: the harness holds one probe with no headers until the
   client aborts, then serves a healthy held-open EventSource.
   Requires playwright-core plus a Chrome binary. */

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const { resolve } = require("node:path");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const STATIC_ROOT = resolve(arg("--static-root", "bend2/ui/orchestra"));
const FIXTURE_PATH = resolve(arg("--fixture", "bend2/ui/orchestra/fixtures/fixture-events-recovery.json"));
const HARNESS = resolve(arg("--harness", "gate/ui682-hosted/harness.cjs"));
const OUT = resolve(arg("--out", "ui682-gate-out"));
const EXPECTED_PLAYWRIGHT = arg("--expect-playwright", "1.64.0");
const CANDIDATE = arg("--candidate", "b2f6fcd80915e74df186287ed9ff557af81f8c08");
const CANDIDATE_TREE = arg("--candidate-tree", "48eeaf57737da6e9d710416df74c804546f1fe05");
mkdirSync(OUT, { recursive: true });

const ABORT_LOW_MS = 4500;
const ABORT_HIGH_MS = 10000;

function httpJson(port, path) {
  return new Promise((resolvePromise, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolvePromise(JSON.parse(raw)));
    }).on("error", reject);
  });
}

function httpText(port, path) {
  return new Promise((resolvePromise, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => resolvePromise(raw));
    }).on("error", reject);
  });
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const hello = fixture.script.find((s) => s.step === 2).respond.frames[0];
  const transition = fixture.script.find((s) => s.step === 2).respond.frames[2];
  const checks = [];
  const check = (id, pass, detail) => {
    checks.push({ id, pass: Boolean(pass), detail });
    console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${detail}`);
  };

  const child = spawn(process.execPath,
    [HARNESS, "--fixture", FIXTURE_PATH, "--static-root", STATIC_ROOT, "--port", "0", "--initial-mode", "hangonce"],
    { stdio: ["ignore", "pipe", "pipe"] });
  const serverLog = [];
  child.stdout.on("data", (c) => serverLog.push(String(c)));
  child.stderr.on("data", (c) => serverLog.push(`STDERR ${c}`));
  const port = await waitFor(async () => {
    const line = serverLog.join("").split("\n").find((l) => l.includes('"listening"'));
    return line ? JSON.parse(line).port : null;
  }, 15000, "harness listening");
  const base = `http://127.0.0.1:${port}`;

  const servedApp = await httpText(port, "/app.js");
  const servedHash = createHash("sha256").update(servedApp).digest("hex");
  const treeAppHash = createHash("sha256").update(readFileSync(resolve(STATIC_ROOT, "app.js"))).digest("hex");
  check("abort-served-bytes-match-tree", servedHash === treeAppHash, `served app.js sha256 ${servedHash}`);
  check("abort-probe-budget-binding", servedApp.includes("const PROBE_BUDGET_MS = 5000;"), "budget present in served app.js");

  const { chromium } = require("playwright-core");
  const installedPlaywright = require("playwright-core/package.json").version;
  check("abort-playwright-pinned", installedPlaywright === EXPECTED_PLAYWRIGHT, `installed ${installedPlaywright}, expected ${EXPECTED_PLAYWRIGHT}`);
  const executablePath = process.env.CHROME_PATH || undefined;
  const browser = await chromium.launch({
    executablePath,
    channel: executablePath ? undefined : "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => consoleLines.push(`pageerror ${e.message}`));

  const text = (id) => page.locator(`#${id}`).textContent();
  await page.goto(`${base}/?api=${encodeURIComponent(base)}&subject=${encodeURIComponent(fixture.subject)}`);

  await waitFor(async () => (await text("conn-state")).trim() === "live" ? true : null, 30000, "conn live after abort");
  await new Promise((r) => setTimeout(r, 1000));
  const log = await httpJson(port, "/harness/log");
  const notice = ((await text("notice")) || "").trim();

  const [a1, a2, a3] = [log.eventsAttempts[0] || {}, log.eventsAttempts[1] || {}, log.eventsAttempts[2] || {}];
  check("abort-transient-first", a1.kind === "eventsource" && a1.status === 503 && a1.error === "owner-election-in-progress",
    JSON.stringify({ kind: a1.kind, status: a1.status, error: a1.error }));
  check("abort-probe-hung", a2.kind === "probe" && a2.hung === true && a2.status === undefined
    && a2.closedBy === "client" && a2.headersSentOnClose === false,
    JSON.stringify({ kind: a2.kind, hung: a2.hung, closedBy: a2.closedBy, headersSentOnClose: a2.headersSentOnClose }));
  const elapsed = a2.hangElapsedMs;
  check("abort-elapsed-bounded", typeof elapsed === "number" && elapsed >= ABORT_LOW_MS && elapsed <= ABORT_HIGH_MS,
    `server-measured abort latency ${elapsed}ms within [${ABORT_LOW_MS}, ${ABORT_HIGH_MS}]`);
  check("abort-attempt-order", log.eventsAttempts.length === 3
    && a3.kind === "eventsource" && a3.status === 200 && !a3.closedAt,
    log.eventsAttempts.map((a) => (a.hung ? `${a.kind}:hung` : `${a.kind}:${a.status}`)).join(","));
  check("abort-hello-contract", ((await text("contract-state")) || "").includes("want 1 / got 1"), await text("contract-state"));
  check("abort-hello-cursor", ((await text("cursor-state")) || "").trim() === transition.id, `cursor ${(await text("cursor-state")).trim()}`);
  check("abort-hello-generation", ((await text("generation-state")) || "").trim() === hello.data.generation, await text("generation-state"));
  check("abort-no-terminal", ((await text("conn-state")) || "").trim() === "live" && notice === "",
    JSON.stringify({ conn: ((await text("conn-state")) || "").trim(), notice }));
  check("abort-zero-snapshot", log.snapshotCount === 1, `snapshotCount ${log.snapshotCount}`);

  await browser.close();
  child.kill("SIGTERM");

  const results = {
    case: "abort-expiry",
    candidate: CANDIDATE,
    candidateTree: CANDIDATE_TREE,
    playwright: installedPlaywright,
    abortBudgetMs: 5000,
    abortBoundsMs: [ABORT_LOW_MS, ABORT_HIGH_MS],
    servedAppSha256: servedHash,
    checks,
    console: consoleLines,
    serverLog: serverLog.join(""),
  };
  writeFileSync(resolve(OUT, "results-abort.json"), JSON.stringify(results, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`CHECKS ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`DRIVER ERROR ${e && e.stack ? e.stack : e}`);
  process.exitCode = 2;
});
