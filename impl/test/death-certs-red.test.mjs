// death-certs-red.test.mjs — #225 (wave-g, attempt 04e62c4a-56bd-4fe5-9b6f-ea7365e2ba95
// row-death-certs). RED-FIRST pin suite: terminal events carry the death cert.
//
// Contract (closed in the row brief):
//   1. lifecycle.process_closed and lifecycle.crashed ledger events carry, when the fact
//      exists: exitCode, signal (the close tuple), the member's route tuple, and — when the
//      adapter observed one — the provider cause class (HTTP status class of the last failed
//      request).
//   2. A bounded stderr/stdout TAIL rides the terminal event: last 4KiB each, redaction class
//      per the existing SECRET_SHAPED_TEXT discipline; never unbounded, never a new event kind.
//   3. No clocks, no retries, no behavior change: enrichment only. Terminal semantics byte-stable.
//
// Three distinguishable kills must be nameable from the terminal event:
//   DC1 SIGKILL      -> deathCert.signal === 'SIGKILL' (+ bounded redacted tails)
//   DC2 exit 137     -> deathCert.exitCode === 137
//   DC3 provider 429 -> deathCert.providerCauseClass === '4xx' / providerCauseStatus === 429
//   DC4 the coordinator ledger fold retains the death cert AND the member route tuple
//       (harnessRequested/harnessResolved/taskId/runId/routeKey) on the folded terminal events.
//
// Harness: the REAL ClaudeSessionCli against a per-run temp fixture script (written below),
// zero quota, no vendor CLI, no fixture edits — the fixture lives in the suite's own tmp root
// and is removed with it. The fixture emits a secret-shaped stderr token so the redaction
// class is pinned, not just the byte bound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { createDriver } from '../src/index.mjs';
import { createBrief } from '../src/messages.mjs';

const TAIL_BYTES = 4 * 1024; // 4KiB each, per contract item 2
const SECRET_SHAPED = 'sk-dc-secret0123456789abcdef'; // must never ride a tail unredacted

// ---------------------------------------------------------------------------
// Fixture: a scriptable fake `claude` (stream-json NDJSON on stdout), mode by argv.
//   hold        — emits one assistant frame + stderr marker, then stays alive (SIGKILL target)
//   exit137     — emits init/assistant + stderr marker, then exits 137 after a 30ms settle
//   provider429 — emits init + a failed result frame carrying api_error_status:429, then
//                 exits 137 (adapter-surfaced provider cause + exit facts in one death)
// Every mode writes the secret-shaped token to stderr so the redaction class is exercised.
// ---------------------------------------------------------------------------
const FIXTURE_SOURCE = [
  "const mode = process.argv[2] ?? 'hold';",
  "const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');",
  "function emitInit() { send({ type: 'system', subtype: 'init', session_id: 'dc-fixture', model: 'dc-fake-model', claude_code_version: '2.1.211-fake' }); }",
  "if (mode === 'hold') {",
  "  send({ type: 'assistant', message: { content: [{ type: 'text', text: 'dc-hold-frame' }] } });",
  "  process.stderr.write('dc-hold-stderr\\nsk-dc-secret0123456789abcdef\\n');",
  "  process.stdin.resume();",
  "  setInterval(() => {}, 1 << 30);",
  "} else if (mode === 'exit137') {",
  "  emitInit();",
  "  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'dc-exit137-frame' }] } }) + '\\n');",
  "  process.stderr.write('dc-exit137-stderr\\nsk-dc-secret0123456789abcdef\\n');",
  "  setTimeout(() => process.exit(137), 30);",
  "} else if (mode === 'provider429') {",
  "  emitInit();",
  "  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'dc-429-frame' }] } }) + '\\n');",
  "  process.stderr.write('dc-429-stderr\\nsk-dc-secret0123456789abcdef\\n');",
  "  send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'provider rate-limited the request', api_error_status: 429, usage: { input_tokens: 10, output_tokens: 1 }, total_cost_usd: 0.0001 });",
  "  setTimeout(() => process.exit(137), 30);",
  '}',
].join('\n');

let FIXTURE = null;
function fixturePath() {
  if (FIXTURE) return FIXTURE;
  const dir = mkdtempSync(join(tmpdir(), 'dc-fixture-'));
  FIXTURE = join(dir, 'dc-claude.mjs');
  writeFileSync(FIXTURE, FIXTURE_SOURCE);
  return FIXTURE;
}

/** Event-bus harness: spawns the REAL ClaudeSessionCli against the fixture, buffers every
 * adapter event, and waits for the first predicate match. */
async function harness(mode) {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [fixturePath(), mode] });
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) { const w = waiters[i]; waiters.splice(i, 1); w.resolve(e); }
    }
  });
  const worker = `dc-${mode}`;
  const worktree = mkdtempSync(join(tmpdir(), 'dc-wt-'));
  const ack = await cli.spawn(worker, fullBrief('hold'), { worktree });
  assert.equal(ack.ok, true, `spawn must be admitted: ${JSON.stringify(ack)}`);
  function waitFor(pred, timeoutMs = 10000) {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        `waitFor timeout after ${timeoutMs}ms; seen kinds: ${events.map((e) => e.kind).join(',')}`,
      )), timeoutMs);
      waiters.push({ pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
    });
  }
  return { cli, worker, events, waitFor };
}

function assertTerminalNames(evt, expected) {
  assert.ok(evt.deathCert, `terminal ${evt.kind} must carry the death cert`);
  assert.equal(evt.deathCert.signal, expected.signal,
    `${evt.kind} death cert must name signal ${expected.signal}`);
  assert.equal(evt.deathCert.exitCode, expected.exitCode,
    `${evt.kind} death cert must name exitCode ${expected.exitCode}`);
}

function assertTails(cert, stderrMarker, stdoutMarker) {
  assert.ok(cert && typeof cert === 'object', 'death cert object required for tail assertions');
  assert.equal(typeof cert.stderrTail, 'string');
  assert.equal(typeof cert.stdoutTail, 'string');
  assert.ok(Buffer.byteLength(cert.stderrTail, 'utf8') <= TAIL_BYTES,
    `stderrTail must stay within ${TAIL_BYTES} bytes`);
  assert.ok(Buffer.byteLength(cert.stdoutTail, 'utf8') <= TAIL_BYTES,
    `stdoutTail must stay within ${TAIL_BYTES} bytes`);
  assert.ok(cert.stderrTail.includes(stderrMarker),
    `stderrTail must carry the last stderr output (${stderrMarker})`);
  assert.ok(cert.stdoutTail.includes(stdoutMarker),
    `stdoutTail must carry the last stdout output (${stdoutMarker})`);
  assert.ok(cert.stderrTail.includes('[redacted]'),
    'secret-shaped stderr must be redacted under the SECRET_SHAPED_TEXT discipline');
  assert.ok(!cert.stderrTail.includes(SECRET_SHAPED),
    'the raw secret must never ride the death cert tail');
}

// ---------------------------------------------------------------------------
// DC1 — SIGKILL: the terminal events name the signal and ride the redacted bounded tails.
// ---------------------------------------------------------------------------

test('DC1: SIGKILL — crashed and process_closed name signal=SIGKILL and ride bounded redacted tails', async (t) => {
  const { cli, worker, waitFor } = await harness('hold');
  t.after(() => cli.kill(worker).catch(() => {}));
  const started = await waitFor((e) => e.kind === 'lifecycle.process_started');
  // The fixture's assistant frame proves its boot block RAN — its stdout/stderr writes are the
  // same synchronous block, so the pipe buffers already hold the markers when SIGKILL lands.
  await waitFor((e) => e.kind === 'content.message');
  process.kill(-started.payload.pid, 'SIGKILL');
  const crashed = await waitFor((e) => e.kind === 'lifecycle.crashed');
  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');
  assertTerminalNames(crashed, { signal: 'SIGKILL', exitCode: null });
  assertTerminalNames(closed, { signal: 'SIGKILL', exitCode: null });
  assertTails(crashed.deathCert, 'dc-hold-stderr', 'dc-hold-frame');
  assertTails(closed.deathCert, 'dc-hold-stderr', 'dc-hold-frame');
});

// ---------------------------------------------------------------------------
// DC2 — exit 137-style code: the terminal events name the exit code.
// ---------------------------------------------------------------------------

test('DC2: exit 137 — crashed and process_closed name exitCode=137 with no signal', async (t) => {
  const { cli, worker, waitFor } = await harness('exit137');
  t.after(() => cli.kill(worker).catch(() => {}));
  await waitFor((e) => e.kind === 'lifecycle.process_started');
  const crashed = await waitFor((e) => e.kind === 'lifecycle.crashed');
  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');
  assertTerminalNames(crashed, { signal: null, exitCode: 137 });
  assertTerminalNames(closed, { signal: null, exitCode: 137 });
  assertTails(crashed.deathCert, 'dc-exit137-stderr', 'dc-exit137-frame');
  assertTails(closed.deathCert, 'dc-exit137-stderr', 'dc-exit137-frame');
});

// ---------------------------------------------------------------------------
// DC3 — adapter-surfaced provider 429: the terminal events name the cause class.
// ---------------------------------------------------------------------------

test('DC3: provider 429 — terminal events name the provider cause class 4xx/429 alongside exit facts', async (t) => {
  const { cli, worker, waitFor } = await harness('provider429');
  t.after(() => cli.kill(worker).catch(() => {}));
  await waitFor((e) => e.kind === 'lifecycle.process_started');
  const crashed = await waitFor((e) => e.kind === 'lifecycle.crashed');
  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');
  for (const evt of [crashed, closed]) {
    assertTerminalNames(evt, { signal: null, exitCode: 137 });
    assert.ok(evt.deathCert, `terminal ${evt.kind} must carry the death cert`);
    assert.equal(evt.deathCert.providerCauseClass, '4xx',
      `${evt.kind} death cert must name the provider cause class of the last failed request`);
    assert.equal(evt.deathCert.providerCauseStatus, 429,
      `${evt.kind} death cert must name the last failed request status`);
    assertTails(evt.deathCert, 'dc-429-stderr', 'dc-429-frame');
  }
});

// ---------------------------------------------------------------------------
// DC4 — the coordinator ledger fold: adapter-carried death cert retained AND the member
// route tuple (harnessResolved etc.) riding the same terminal events.
// ---------------------------------------------------------------------------

function makeRealRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dc-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'baton-test@localhost'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'baton-test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'death cert pin\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function fullBrief(goal) {
  return createBrief({
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'the pinned fake turn completes',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  });
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForLogEvent(log, workerId, pred, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = log.read(workerId).find(pred);
    if (hit) return hit;
    if (Date.now() >= deadline) {
      assert.fail(`no ${label} for ${workerId} within ${timeoutMs}ms; logged kinds: ${log.read(workerId).map((e) => `${e.kind}(${e.actor})`).join(',')}`);
    }
    await sleep(20);
  }
}

test('DC4: coordinator ledger terminal events carry the death cert and the member route tuple', async (t) => {
  const { coordinator, log } = createDriver({
    repoRoot: makeRealRepo(),
    logDir: mkdtempSync(join(tmpdir(), 'dc-log-')),
    adapters: { claude: new ClaudeSessionCli({ cmd: process.execPath, args: [fixturePath(), 'hold'] }) },
    stopDeadlineMs: 3000,
  });
  const h = await coordinator.spawn('claude', fullBrief('hold'));
  t.after(() => Promise.resolve(coordinator.kill(h.id)).catch(() => {}));
  const started = await waitForLogEvent(log, h.id,
    (e) => e.kind === 'lifecycle.process_started' && e.actor === 'worker', 'worker process_started');
  // The ledger's own content.message proves the fixture boot block RAN — its stdout/stderr
  // writes are the same synchronous block, so the pipe buffers hold the markers before the
  // external SIGKILL (see DC1).
  await waitForLogEvent(log, h.id, (e) => e.kind === 'content.message', 'fixture content.message');
  process.kill(-started.payload.pid, 'SIGKILL');
  const closed = await waitForLogEvent(log, h.id,
    (e) => e.kind === 'lifecycle.process_closed' && e.actor === 'worker', 'ledger process_closed');
  const crashed = await waitForLogEvent(log, h.id,
    (e) => e.kind === 'lifecycle.crashed' && e.actor === 'worker', 'ledger crashed');
  for (const evt of [closed, crashed]) {
    assert.ok(evt.deathCert, `folded ledger ${evt.kind} must retain the adapter death cert`);
    assert.equal(evt.deathCert.signal, 'SIGKILL', `folded ${evt.kind} names the signal`);
    assert.equal(evt.deathCert.exitCode, null, `folded ${evt.kind} names the exit code`);
    assertTails(evt.deathCert, 'dc-hold-stderr', 'dc-hold-frame');
    assert.equal(evt.harnessRequested, 'claude', `folded ${evt.kind} carries the requested harness`);
    assert.ok(typeof evt.harnessResolved === 'string' && evt.harnessResolved.length > 0,
      `folded ${evt.kind} carries the resolved harness`);
    assert.equal(typeof evt.taskId, 'string', `folded ${evt.kind} carries taskId`);
    assert.ok(evt.runId === null || typeof evt.runId === 'string',
      `folded ${evt.kind} carries runId (null when unbounded, string when run-bound)`);
    assert.equal(typeof evt.routeKey, 'string', `folded ${evt.kind} carries the route key`);
  }
});
