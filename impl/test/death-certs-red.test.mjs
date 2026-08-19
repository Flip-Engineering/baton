// death-certs-red.test.mjs — issue #225 red-first pin suite: terminal events carry the death cert.
//
// RED at pre-change head, GREEN after enrichment. Kills a real member (ClaudeSessionCli against a
// runtime-generated scripted child) three distinguishable ways and asserts the TERMINAL EVENT names
// WHICH:
//
//   1. SIGKILL            -> lifecycle.process_closed carries event-level signal:'SIGKILL' /
//                            exitCode:null (the close tuple), payload byte-stable (exact-keys).
//   2. exit 137 mid-turn  -> the COORDINATOR ledger terminal events (process_closed + crashed)
//                            carry event-level/payload exitCode:137 and the member route tuple.
//   3. provider 429       -> the adapter-surfaced HTTP status class ('4xx') rides process_closed
//                            (event level) and crashed (payload).
//   4. tails              -> a bounded (<=4KiB each), SECRET_SHAPED_TEXT-redacted stderr/stdout
//                            tail rides both terminal kinds; never unbounded, no new event kind.
//
// The child fixture is written at runtime into the OS temp dir (never the repo tree), scripted by a
// DEATH:<mode> marker in the rendered brief goal — no timing, no env plumbing, no fixture edits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const TAIL_MAX_BYTES = 4 * 1024;

// ---------------------------------------------------------------------------
// scripted child — speaks the REAL Claude Code stream-json wire shapes, dies per DEATH:<mode>
// ---------------------------------------------------------------------------

const CHILD_FIXTURE = `// runtime-generated death-cert fixture (issue #225). Acts on the DEATH:<mode>
// marker in the first user frame; writes are synchronous so the death cert tail is complete
// before process.exit — deterministic, no sleeps.
import { writeSync } from 'node:fs';
import readline from 'node:readline';

if (!process.argv.includes('--input-format')) process.exit(0);

// Registered from the very first tick: the operator's kill() must escalate SIGTERM -> SIGKILL for
// the signal leg, and no fixture flow is allowed to end on a bare SIGTERM.
process.on('SIGTERM', () => { /* deliberately unresponsive — escalation to SIGKILL is required */ });

const out = (text) => writeSync(1, text);
const err = (text) => writeSync(2, text);
const send = (obj) => out(JSON.stringify(obj) + '\\n');
const die = (code) => { process.exit(code); };

send({ type: 'system', subtype: 'init', model: 'death-cert-test', session_id: 'death-cert-session' });

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame.type !== 'user') return;
  const text = JSON.stringify(frame.message ?? '');
  const mode = /DEATH:(signal|exit137|provider429|tails)/u.exec(text)?.[1] ?? 'hold';
  if (mode === 'signal') {
    send({ type: 'assistant', message: { content: [{ type: 'text', text: 'holding' }] } });
    return; // hold forever until the process group is signaled
  }
  if (mode === 'exit137') {
    err('dying with exit 137\\n');
    send({ type: 'assistant', message: { content: [{ type: 'text', text: 'about to die' }] } });
    die(137);
  }
  if (mode === 'provider429') {
    send({ type: 'result', is_error: true, result: 'API Error: 429 rate limited', api_error_status: 429, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
    die(137);
  }
  if (mode === 'tails') {
    err('api_key=super-secret-credential-1234567890\\n');
    out('T'.repeat(6000) + '\\n');
    die(137);
  }
  die(0);
});
rl.on('close', () => { if (process.exitCode === null) process.exit(0); });
`;

let fixtureDir = null;
let fixturePath = null;
function fixtureFile() {
  if (fixturePath) return fixturePath;
  fixtureDir = mkdtempSync(join(tmpdir(), 'death-certs-red-'));
  fixturePath = join(fixtureDir, 'fake-death-cert-child.mjs');
  writeFileSync(fixturePath, CHILD_FIXTURE);
  return fixturePath;
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(fn, label, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  };
}

function makeCli() {
  return new ClaudeSessionCli({ cmd: process.execPath, args: [fixtureFile()], killGraceMs: 50 });
}

function collect(cli) {
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) { const w = waiters[i]; waiters.splice(i, 1); w.resolve(e); }
    }
  });
  const waitFor = (pred, timeoutMs = 6000) => {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor timeout after ${timeoutMs}ms; seen kinds: ${events.map((e) => e.kind).join(',')}`)),
        timeoutMs,
      );
      waiters.push({ pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
    });
  };
  return { events, waitFor };
}

async function spawnAndReady(cli, worker, goal) {
  const ack = await cli.spawn(worker, brief(goal), { worktree: mkdtempSync(join(tmpdir(), 'death-certs-wt-')) });
  assert.equal(ack.ok, true, ack.reason);
}

async function emergencyCleanup(cli, worker) {
  try { await cli.kill(worker); } catch { /* already gone */ }
  const session = cli._sessions?.get(worker);
  const pid = session?.child?.pid ?? session?.pid;
  if (pid && alive(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
  await sleep(20);
}

const CLOSE_PAYLOAD_KEYS = ['code', 'generation', 'pid', 'processGroupId', 'ready', 'schemaVersion', 'signal'];

// ---------------------------------------------------------------------------
// 1. SIGKILL — process_closed names the signal, payload byte-stable
// ---------------------------------------------------------------------------

test('SIGKILL death: process_closed names WHICH (signal SIGKILL, exitCode null) with a byte-stable payload', async (t) => {
  const cli = makeCli();
  const worker = 'dc-sigkill';
  const { waitFor } = collect(cli);
  t.after(() => emergencyCleanup(cli, worker));
  await spawnAndReady(cli, worker, 'DEATH:signal');
  await waitFor((e) => e.kind === 'lifecycle.spawned');

  const killed = await cli.kill(worker);
  assert.equal(killed.ok, true);
  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');

  // The death cert NAMES WHICH: the operator escalation landed as SIGKILL, no exit code.
  assert.equal(closed.signal, 'SIGKILL', 'the terminal event names the kill signal');
  assert.equal(closed.exitCode, null, 'a signal death carries no exit code');
  // The close tuple also stays on the payload exactly as before (terminal semantics byte-stable).
  assert.equal(closed.payload.signal, 'SIGKILL');
  assert.equal(closed.payload.code, null);
  assert.deepEqual(Object.keys(closed.payload).sort(), CLOSE_PAYLOAD_KEYS.sort(),
    'process_closed payload keeps its exact-keys contract shape');
  await waitFor((e) => e.kind === 'kill.confirmed');
});

// ---------------------------------------------------------------------------
// 2. exit 137 — the COORDINATOR ledger terminal events carry exitCode + the route tuple
// ---------------------------------------------------------------------------

test('exit-137 death: the ledger process_closed and crashed events name exitCode 137 and the member route', async (t) => {
  const cli = makeCli();
  const worker = 'dc-exit137';
  const log = new Log(mkdtempSync(join(tmpdir(), 'dc-exit137-log-')));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async () => ({ path: mkdtempSync(join(tmpdir(), 'dc-exit137-wt-')) }),
    capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { claude: cli }, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'claude',
    approvalTimeoutMs: 100, stopDeadlineMs: 100,
  });
  t.after(() => emergencyCleanup(cli, worker));

  const handle = await coordinator.spawn('claude', brief('DEATH:exit137'), { taskId: 'death-certs-exit137' });
  await until(() => log.read(handle.id).some((e) => e.kind === 'lifecycle.crashed' && e.actor === 'worker'),
    'ledger crashed event');
  const events = log.read(handle.id);
  const closed = events.filter((e) => e.kind === 'lifecycle.process_closed');
  const crashed = events.filter((e) => e.kind === 'lifecycle.crashed' && e.actor === 'worker');

  assert.equal(closed.length, 1, 'exactly one ledger process_closed');
  assert.equal(closed[0].exitCode, 137, 'ledger process_closed names the exit code');
  assert.equal(closed[0].signal, null, 'an exit-code death names no signal');
  assert.equal(closed[0].payload.code, 137, 'the close tuple stays on the payload');
  assert.ok(closed[0].harnessResolved && typeof closed[0].harnessResolved === 'string' && closed[0].harnessResolved.length > 0,
    'the member route tuple (harnessResolved) rides the ledger close');
  assert.ok(closed[0].routeKey === null || typeof closed[0].routeKey === 'string',
    'the ledger close carries a routeKey attribution slot');

  assert.ok(crashed.length >= 1, 'a ledger crashed event exists');
  const crash = crashed[0];
  assert.equal(crash.payload.exitCode, 137, 'ledger crashed names the exit code');
  assert.equal(crash.payload.signal, null, 'an exit-code death names no signal');
  assert.ok(crash.harnessResolved && typeof crash.harnessResolved === 'string' && crash.harnessResolved.length > 0,
    'the member route tuple rides the ledger crash');
});

// ---------------------------------------------------------------------------
// 3. provider 429 — the adapter-surfaced HTTP status class names the death
// ---------------------------------------------------------------------------

test('provider-429 death: the terminal events name the provider cause class (4xx)', async (t) => {
  const cli = makeCli();
  const worker = 'dc-429';
  const { waitFor } = collect(cli);
  t.after(() => emergencyCleanup(cli, worker));
  await spawnAndReady(cli, worker, 'DEATH:provider429');
  await waitFor((e) => e.kind === 'lifecycle.spawned');

  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');
  assert.equal(closed.providerCauseClass, '4xx', 'process_closed names the provider cause class');
  assert.equal(closed.exitCode, 137, 'process_closed still names the exit code');

  const crashed = await waitFor((e) => e.kind === 'lifecycle.crashed');
  assert.equal(crashed.payload.providerCauseClass, '4xx', 'crashed names the provider cause class');
  assert.equal(crashed.payload.exitCode, 137, 'crashed still names the exit code');
});

// ---------------------------------------------------------------------------
// 4. bounded redacted tails ride the terminal events
// ---------------------------------------------------------------------------

test('terminal events carry a bounded (<=4KiB) SECRET_SHAPED_TEXT-redacted stderr/stdout tail', async (t) => {
  const cli = makeCli();
  const worker = 'dc-tails';
  const { waitFor } = collect(cli);
  t.after(() => emergencyCleanup(cli, worker));
  await spawnAndReady(cli, worker, 'DEATH:tails');
  await waitFor((e) => e.kind === 'lifecycle.spawned');

  const closed = await waitFor((e) => e.kind === 'lifecycle.process_closed');
  assert.ok(typeof closed.stderrTail === 'string' && closed.stderrTail.length > 0,
    'process_closed carries the stderr tail');
  assert.ok(typeof closed.stdoutTail === 'string' && closed.stdoutTail.length > 0,
    'process_closed carries the stdout tail');
  assert.ok(Buffer.byteLength(closed.stderrTail) <= TAIL_MAX_BYTES, 'stderr tail is bounded to 4KiB');
  assert.ok(Buffer.byteLength(closed.stdoutTail) <= TAIL_MAX_BYTES, 'stdout tail is bounded to 4KiB');
  assert.ok(closed.stdoutTail.endsWith('T\n'), 'stdout tail keeps the newest bytes');
  assert.equal(closed.stderrTail.includes('api_key='), false, 'secret-shaped text is redacted from the tail');
  assert.ok(closed.stderrTail.includes('[redacted]'), 'the redaction marker is visible in the tail');

  const crashed = await waitFor((e) => e.kind === 'lifecycle.crashed');
  assert.ok(typeof crashed.payload.stderrTail === 'string' && crashed.payload.stderrTail.length > 0,
    'crashed carries the stderr tail');
  assert.equal(crashed.payload.stderrTail.includes('api_key='), false, 'crashed tail is redacted');
  assert.ok(Buffer.byteLength(crashed.payload.stdoutTail) <= TAIL_MAX_BYTES, 'crashed stdout tail is bounded');
});

test('cleanup: the runtime fixture directory is removed', (t) => {
  t.after(() => {
    if (fixtureDir) { try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
  assert.equal(typeof fixtureFile(), 'string');
});
