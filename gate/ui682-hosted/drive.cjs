"use strict";
/* UI682 hosted gate driver. Loads the exact b2f6 orchestra page in
   headless Chromium against the scripted harness and checks the
   fixture assertions. Requires playwright-core plus a Chrome binary. */

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
mkdirSync(OUT, { recursive: true });

const TERMINAL_NOTICE =
  "Live stream unavailable: the shared owner subscription is not installed yet (#676). The snapshot still updates on Reconnect.";

function httpJson(method, port, path, body) {
  return new Promise((resolvePromise, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => resolvePromise(JSON.parse(raw)));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
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

  const child = spawn(process.execPath, [HARNESS, "--fixture", FIXTURE_PATH, "--static-root", STATIC_ROOT, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
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
  check("served-bytes-match-tree", servedHash === treeAppHash, `served app.js sha256 ${servedHash}`);

  const bindings = [
    "const PROBE_BUDGET_MS = 5000;",
    "signal: ctrl.signal",
    'if (probe.status === 503)',
    'body.error === "native-owner-subscription-unavailable"',
    "probe.body.cancel()",
    "connectEvents();",
  ];
  for (const snippet of bindings) {
    check(`probe-binding:${snippet.slice(0, 28)}`, servedApp.includes(snippet), "present in served app.js");
  }

  const { chromium } = require("playwright-core");
  const executablePath = process.env.CHROME_PATH || undefined;
  const browser = await chromium.launch({
    executablePath,
    channel: executablePath ? undefined : "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => consoleLines.push(`pageerror ${e.message}`));

  const text = (id) => page.locator(`#${id}`).textContent();
  await page.goto(`${base}/?api=${encodeURIComponent(base)}&subject=${encodeURIComponent(fixture.subject)}`);

  await waitFor(async () => (await text("conn-state")).trim() === "live" ? true : null, 25000, "conn live");
  await new Promise((r) => setTimeout(r, 1000));
  const phase1 = await httpJson("GET", port, "/harness/log");
  const notice1 = ((await text("notice")) || "").trim();

  check("hello-contract", ((await text("contract-state")) || "").includes("want 1 / got 1"), await text("contract-state"));
  check("hello-cursor", ((await text("cursor-state")) || "").trim() === transition.id, `cursor ${(await text("cursor-state")).trim()}`);
  check("hello-generation", ((await text("generation-state")) || "").trim() === hello.data.generation, await text("generation-state"));
  check("hello-notice-cleared", notice1 === "", JSON.stringify(notice1));
  const transitionsText = (await page.locator("#transitions").textContent()) || "";
  check("transition-frame", transitionsText.includes(transition.data.session) && transitionsText.includes(transition.data.kind), transitionsText.slice(0, 160));

  const a1 = phase1.eventsAttempts[0] || {};
  check("transient-first-503", a1.status === 503 && a1.error === "owner-election-in-progress", JSON.stringify({ status: a1.status, error: a1.error }));
  check("transient-non-terminal", phase1.eventsAttempts.length > 1, `${phase1.eventsAttempts.length} attempts followed`);
  const a2 = phase1.eventsAttempts[1] || {};
  const heldMs = a2.closedAt ? Date.parse(a2.closedAt) - Date.parse(a2.headersSentAt) : null;
  check("probe-cancel-resume", a2.kind === "probe" && a2.status === 200 && a2.closedBy === "client" && heldMs !== null && heldMs < 5000,
    JSON.stringify({ kind: a2.kind, status: a2.status, heldMs }));
  const a3 = phase1.eventsAttempts[2] || {};
  check("held-open-200", a3.kind === "eventsource" && a3.status === 200 && !a3.closedAt, JSON.stringify({ kind: a3.kind, status: a3.status }));
  check("combined-count", phase1.eventsAttempts.length === 3, phase1.eventsAttempts.map((a) => `${a.kind}:${a.status}`).join(","));
  check("events-url-binding", a1.subject === fixture.subject && (a1.since || "").length > 0, JSON.stringify({ subject: a1.subject, since: a1.since }));
  check("zero-snapshot-recovery", phase1.snapshotCount === 1, `snapshotCount ${phase1.snapshotCount}`);

  await httpJson("POST", port, "/harness/mode", { mode: "terminal" });
  const beforeTerminal = (await httpJson("GET", port, "/harness/log")).eventsAttempts.length;
  const snapshotsBefore = (await httpJson("GET", port, "/harness/log")).snapshotCount;
  await page.locator("#reconnect").click();
  await waitFor(async () => (await text("conn-state")).trim() === "unavailable" ? true : null, 25000, "conn unavailable");
  const notice2 = ((await text("notice")) || "").trim();
  check("terminal-notice", notice2 === TERMINAL_NOTICE, JSON.stringify(notice2));
  await new Promise((r) => setTimeout(r, 3500));
  const phase2 = await httpJson("GET", port, "/harness/log");
  const terminalAttempts = phase2.eventsAttempts.slice(beforeTerminal);
  check("terminal-exact-503", terminalAttempts.length >= 1 && terminalAttempts.some((a) => a.status === 503 && a.error === "native-owner-subscription-unavailable"),
    terminalAttempts.map((a) => `${a.kind}:${a.status}`).join(","));
  const terminalBound = terminalAttempts.find((a) => (a.since || "") === transition.id);
  check("terminal-binding", Boolean(terminalBound) && terminalBound.generation === hello.data.generation,
    JSON.stringify({ since: terminalBound && terminalBound.since, generation: terminalBound && terminalBound.generation }));
  const grew = phase2.eventsAttempts.length;
  await new Promise((r) => setTimeout(r, 1000));
  const phase2b = await httpJson("GET", port, "/harness/log");
  check("terminal-no-polling", phase2b.eventsAttempts.length === grew && terminalAttempts.length <= 2,
    `events attempts stable at ${grew}`);
  check("terminal-one-snapshot", phase2.snapshotCount === snapshotsBefore + 1, `snapshotCount ${phase2.snapshotCount}`);

  await browser.close();
  child.kill("SIGTERM");

  const versions = {
    node: process.version,
    chrome: process.env.CHROME_VERSION || "see workflow versions.txt",
    playwright: require("playwright-core/package.json").version,
  };
  const results = { fixture: { hello, transition }, servedAppSha256: servedHash, checks, console: consoleLines, serverLog: serverLog.join("") };
  writeFileSync(resolve(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(resolve(OUT, "versions.json"), JSON.stringify(versions, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`CHECKS ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`DRIVER ERROR ${e && e.stack ? e.stack : e}`);
  process.exitCode = 2;
});
