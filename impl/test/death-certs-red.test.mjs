// death-certs-red.test.mjs — issue #225 red-first pin suite: TERMINAL EVENTS CARRY THE DEATH
// CERT. RED at the pre-change head: the adapter-origin `lifecycle.crashed` / `lifecycle.process_closed`
// ledger events carry only the envelope + route attribution — no exitCode/signal fields, no
// bounded stderr/stdout tail, no provider cause class — so every assertion below fails on
// `deathCert` being absent. GREEN after the enrichment lands (impl/src/death-cert.mjs +
// claude-session.mjs + omp-rpc.mjs + coordinator.mjs intake pass-through/synthesis).
//
// Contract (closed):
//   1. lifecycle.process_closed and lifecycle.crashed LEDGER events carry, when the fact
//      exists: exitCode, signal (the close tuple), the member's route tuple, and — when the
//      adapter observed one — the provider cause class (HTTP status class of the last failed
//      request).
//   2. A bounded stderr/stdout TAIL (last 4KiB each, redaction per SECRET_SHAPED_TEXT)
//      rides the terminal events; never unbounded, never a new event kind.
//   3. No clocks, no retries, no behavior change: enrichment only.
//
// The three distinguishable kills:
//   - SIGKILL: a real ClaudeSessionCli child (the fake-claude fixture) is SIGKILLed mid-turn.
//   - exit 137-style code: an OmpRpcCli child exits 137 mid-turn.
//   - adapter-surfaced provider 429: the omp provider lane reports a failed request with
//     HTTP status 429 (auto_retry_start carries the status), then the child dies; and the
//     claude wire lane reports rate_limit_event status 429 then dies.
// Every kill flows through a REAL Coordinator so the assertions read the LEDGER (log.read),
// the exact surface the operator's forensic dig reads. The adapter's onEvent slot belongs to
// the coordinator's intake, so the suite polls the ledger itself — never a second observer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CLAUDE_429 = fileURLToPath(new URL('./fixtures/fake-claude-429.mjs', import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the worker's ledger (the ONLY observer — the coordinator owns the adapter slot). */
async function waitForLog(log, workerId, pred, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = log.read(workerId).find(pred);
    if (hit) return hit;
    if (Date.now() >= deadline) {
      throw new Error(`waitForLog timeout after ${timeoutMs}ms; ledger: ${log.read(workerId).map((e) => e.kind).join(',')}`);
    }
    await sleep(25);
  }
}

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'fake completes',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  };
}

/** Real Coordinator over stub worktrees/referee — the dispatch/ledger machinery is real. */
function makeCoordinator({ adapters } = {}) {
  const logDir = mkdtempSync(join(tmpdir(), 'death-certs-log-'));
  const log = new Log(logDir, () => new Date().toISOString());
  const fences = new FenceTable();
  const worktrees = {
    create: async (taskId) => ({ path: mkdtempSync(join(tmpdir(), `death-certs-wt-${taskId}-`)), branch: 'b', baseSha: 'x' }),
    capture: async () => ({ sha: 'deadbeef', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: mkdtempSync(join(tmpdir(), 'death-certs-vf-')) }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const referee = async () => ({ reverified: true, observedExit: 0 });
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences, adapters, worktrees, repoRoot: tmpdir(), referee,
    route: (task, cards) => Object.keys(cards)[0], now: Date.now, approvalTimeoutMs: 2000, stopDeadlineMs: 2000,
  });
  return { coordinator, log };
}

/** The ledger's adapter-origin terminal events (post-intake: route attribution attached). */
function ledgerTerminals(log, workerId) {
  return log.read(workerId).filter((event) => (
    event.kind === 'lifecycle.crashed' || event.kind === 'lifecycle.process_closed'
  ));
}

// ---------------------------------------------------------------------------
// Kill 1 — SIGKILL: a real child is SIGKILLed mid-turn (claude-session + fixture)
// ---------------------------------------------------------------------------

test('DEATH CERT SIGKILL: the terminal ledger event names the signal and the route tuple', async () => {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] });
  const { coordinator, log } = makeCoordinator({ adapters: { claude: cli } });
  const handle = await coordinator.spawn('claude', brief('HOLD_UNTIL_INTERRUPT'));
  try {
    // The fixture emits one assistant text event, then holds — wait for that mid-turn marker.
    await waitForLog(log, handle.id, (e) => e.kind === 'content.message');
    const session = cli._sessions.get(handle.id);
    assert.ok(session?.pid, 'the session owns a real child process');
    process.kill(-session.pid, 'SIGKILL');
    await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.crashed', 5000);

    const terminals = ledgerTerminals(log, handle.id);
    const crashed = terminals.find((e) => e.kind === 'lifecycle.crashed');
    const closed = terminals.find((e) => e.kind === 'lifecycle.process_closed');
    assert.ok(crashed, 'the ledger carries the crash');
    assert.ok(closed, 'the ledger carries the exact process close');
    // The close tuple names WHICH death — SIGKILL.
    assert.equal(crashed.deathCert?.signal, 'SIGKILL', 'the terminal event NAMES the signal');
    assert.equal(crashed.deathCert?.exitCode, null, 'a signal death carries no exit code');
    assert.equal(closed.deathCert?.signal, 'SIGKILL', 'the exact close event NAMES the signal too');
    // The member's route tuple lives on the ledger event at emit time.
    assert.match(crashed.harnessResolved, /^claude-code@/, `route tuple names the resolved harness (${crashed.harnessResolved})`);
    assert.ok(typeof crashed.routeKey === 'string' && crashed.routeKey.length > 0, 'route tuple carries the routeKey');
    assert.ok(typeof crashed.taskId === 'string' && crashed.taskId.length > 0, 'route tuple binds the task');
    // Bounded tails ride the terminal events.
    for (const cert of [crashed.deathCert, closed.deathCert]) {
      assert.equal(typeof cert?.stdoutTail, 'string', 'stdout tail rides the terminal event');
      assert.equal(typeof cert?.stderrTail, 'string', 'stderr tail rides the terminal event');
      assert.ok(Buffer.byteLength(cert.stdoutTail, 'utf8') <= 4096, 'stdout tail is bounded at 4KiB');
      assert.ok(Buffer.byteLength(cert.stderrTail, 'utf8') <= 4096, 'stderr tail is bounded at 4KiB');
    }
  } finally {
    await Promise.resolve(cli.kill(handle.id)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Kill 2 — exit 137-style code: an omp child exits 137 mid-turn
// ---------------------------------------------------------------------------

class FakeStream extends EventEmitter {
  setEncoding() { /* fake */ }
  write() { return true; }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.pid = 424242;
    this.killed = false;
    this.kill = (signal) => { this.killed = signal ?? true; };
  }
}

const READY = JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\n';

function makeOmpAdapter(child) {
  return new OmpRpcCli({
    requestTimeoutMs: 1_000,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['low'] },
    spawnFn: () => child,
    versionProbe: () => 'omp test',
  });
}

async function ompSpawnReady(coordinator, adapter, log, workerId, goal) {
  const handle = await coordinator.spawn('omp', brief(goal), {
    model: 'deepseek/deepseek-v4-flash', effort: 'low',
  });
  await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker');
  const session = adapter._sessions.get(handle.id);
  assert.ok(session, 'the omp session registered');
  session.process._onStdout(READY);
  await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker');
  return { handle, session };
}

test('DEATH CERT EXIT 137: the terminal ledger event names the exit code', async () => {
  const child = new FakeChild();
  const adapter = makeOmpAdapter(child);
  const { coordinator, log } = makeCoordinator({ adapters: { omp: adapter } });
  let handle;
  try {
    ({ handle } = await ompSpawnReady(coordinator, adapter, log, 'w-137', 'death-certs 137 pin'));
    child.emit('exit', 137, null);
    await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.crashed', 5000);

    const crashed = log.read(handle.id).find((e) => e.kind === 'lifecycle.crashed');
    assert.ok(crashed, 'the ledger carries the crash');
    assert.equal(crashed.deathCert?.exitCode, 137, 'the terminal event NAMES the exit code');
    assert.equal(crashed.deathCert?.signal, null, 'an exit-code death carries no signal');
    assert.equal(crashed.harnessResolved, 'omp@omp test', 'route tuple names the resolved omp harness');
    assert.ok(typeof crashed.routeKey === 'string' && crashed.routeKey.length > 0, 'route tuple carries the routeKey');
  } finally {
    if (handle) await Promise.resolve(adapter.kill(handle.id)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Kill 3 — adapter-surfaced provider 429: the provider lane reports HTTP 429, then the
// child dies; the terminal event must name the cause class (and the close tuple).
// ---------------------------------------------------------------------------

test('DEATH CERT PROVIDER 429: an adapter-surfaced provider 429 names the cause class on the terminal event', async () => {
  const child = new FakeChild();
  const adapter = makeOmpAdapter(child);
  const { coordinator, log } = makeCoordinator({ adapters: { omp: adapter } });
  let handle;
  try {
    ({ handle } = await ompSpawnReady(coordinator, adapter, log, 'w-429', 'death-certs 429 pin'));
    // omp's native provider-retry lane reports the failed request's HTTP status.
    adapter._sessions.get(handle.id).process._onStdout(
      `${JSON.stringify({ type: 'auto_retry_start', status: 429 })}\n`,
    );
    await sleep(30);
    child.emit('exit', 1, null);
    await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.crashed', 5000);

    const crashed = log.read(handle.id).find((e) => e.kind === 'lifecycle.crashed');
    assert.ok(crashed, 'the ledger carries the crash');
    assert.equal(crashed.deathCert?.providerCauseClass, '4xx', 'the terminal event NAMES the provider cause class');
    assert.equal(crashed.deathCert?.exitCode, 1, 'the close tuple rides beside the cause class');
    assert.equal(crashed.deathCert?.signal, null);
  } finally {
    if (handle) await Promise.resolve(adapter.kill(handle.id)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Kill 3b — the claude wire lane: rate_limit_event status 429 then death.
// ---------------------------------------------------------------------------

test('DEATH CERT CLAUDE 429: a rate_limit_event provider 429 names the cause class on the terminal event', async () => {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE_429] });
  const { coordinator, log } = makeCoordinator({ adapters: { claude: cli } });
  const handle = await coordinator.spawn('claude', brief('death-certs claude 429 pin'));
  try {
    await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.crashed', 6000);
    const crashed = log.read(handle.id).find((e) => e.kind === 'lifecycle.crashed');
    assert.ok(crashed, 'the ledger carries the crash');
    assert.equal(crashed.deathCert?.providerCauseClass, '4xx', 'the terminal event NAMES the provider cause class');
    assert.equal(crashed.deathCert?.exitCode, 1, 'the close tuple rides beside the cause class');
    assert.equal(typeof crashed.deathCert?.stderrTail, 'string');
    assert.match(crashed.deathCert?.stderrTail ?? '', /rate limit/i, 'the stderr tail carries the forensic line');
  } finally {
    await Promise.resolve(cli.kill(handle.id)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Bounded redacted tail: >4KiB streams and secret-shaped text never leak, never blow up.
// ---------------------------------------------------------------------------

const SECRET_SHAPED = 'api_key=sk-proj-abcdef0123456789ABCDEF0123456789';

test('DEATH CERT TAIL: the terminal events carry a bounded, SECRET_SHAPED_TEXT-redacted stderr/stdout tail', async () => {
  const child = new FakeChild();
  const adapter = makeOmpAdapter(child);
  const { coordinator, log } = makeCoordinator({ adapters: { omp: adapter } });
  let handle;
  try {
    ({ handle } = await ompSpawnReady(coordinator, adapter, log, 'w-tail', 'death-certs tail pin'));
    const process = adapter._sessions.get(handle.id).process;
    // >4KiB of stdout chatter with a distinguishable HEAD ('H') and TAIL ('T'), then a
    // secret-shaped stderr line AFTER the flood so the bounded window still holds it.
    process._onStdout('H'.repeat(5000) + '\n');
    process._onStdout('T'.repeat(5000) + '\n');
    child.stderr.emit('data', 'A'.repeat(1000) + 'B'.repeat(5000) + '\n');
    child.stderr.emit('data', `provider panic: ${SECRET_SHAPED}\npost-secret diagnostic line\n`);
    await sleep(30);
    child.emit('exit', 9, null);
    await waitForLog(log, handle.id, (e) => e.kind === 'lifecycle.crashed', 5000);

    const terminals = ledgerTerminals(log, handle.id);
    const crashed = terminals.find((e) => e.kind === 'lifecycle.crashed');
    const closed = terminals.find((e) => e.kind === 'lifecycle.process_closed');
    assert.ok(crashed && closed, 'both terminal kinds landed in the ledger');
    for (const event of [crashed, closed]) {
      const cert = event.deathCert;
      assert.ok(cert, 'the death-cert block rides the terminal event');
      for (const tail of [cert.stdoutTail, cert.stderrTail]) {
        assert.ok(Buffer.byteLength(tail, 'utf8') <= 4096, 'the tail is bounded at 4KiB, never unbounded');
        assert.ok(!tail.includes(SECRET_SHAPED), 'secret-shaped provider text is redacted from the tail');
      }
      assert.ok(cert.stderrTail.includes('[redacted]'), 'the redaction marker is present in the stderr tail');
      assert.ok(!cert.stdoutTail.includes('H') && cert.stdoutTail.includes('T'),
        'the stdout tail retains the LAST bytes of the stream, not the head');
      assert.ok(!cert.stderrTail.includes('A') && cert.stderrTail.includes('B'),
        'the stderr tail evicts the >4KiB head of the stream and keeps its tail');
    }
  } finally {
    if (handle) await Promise.resolve(adapter.kill(handle.id)).catch(() => {});
  }
});
