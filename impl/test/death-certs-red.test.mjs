// death-certs-red.test.mjs — issue #225 red-first pin suite: terminal events carry the death cert.
// attempt: ca499bcb-aebc-462b-8afa-3139200458fc row-death-certs
//
// Contract (row-death-certs brief, wave-d):
//   1. lifecycle.process_closed and lifecycle.crashed LEDGER events carry, when the fact exists:
//      exitCode + signal (the close tuple), the member's route tuple, and — when the adapter
//      observed one — the provider cause class (HTTP status class of the last failed request).
//   2. A bounded stderr/stdout TAIL rides the terminal event: last 4KiB each, redaction class per
//      the existing SECRET_SHAPED_TEXT discipline; never unbounded, never a new event kind.
//   3. No clocks, no retries, no behavior change: enrichment only. Terminal semantics byte-stable.
//   4. Kill a member three distinguishable ways (SIGKILL; exit 137-style code; adapter-surfaced
//      provider 429) and assert the terminal event NAMES WHICH.
//
// RED at pre-change head (the adapter's crash emission and the coordinator's appendAttributed
// dropped every one of these facts); GREEN after the enrichment lands.
//
// The adapter leg drives the REAL ClaudeSessionCli against an inline fake `claude` binary written
// to a throwaway temp dir at runtime (zero vendor quota, real child processes, real signals). The
// coordinator leg wires a Coordinator around a stub adapter and asserts the OPERATIONAL LEDGER
// (the per-worker event stream the driver folds) preserves the facts + route attribution.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { processClosedPayload, processStartedPayload } from '../src/process-lifecycle.mjs';

const TAIL_BYTES = 4 * 1024;
const SECRET_TOKEN = 'sk-ant-dc-1234567890abcdef1234567890'; // SECRET_SHAPED_TEXT sk-/sk-proj shape

// ---------------------------------------------------------------------------
// Inline fake `claude` binary (written to a temp dir; never a repo fixture edit).
// Speaks the stream-json wire shape the adapter requires, writes >4KiB of stdout so the
// bounded-tail claim is observable, and dies in exactly the mode its env asks for.
// ---------------------------------------------------------------------------

const FIXTURE_SOURCE = `#!/usr/bin/env node
// death-certs inline fake claude: driven entirely by env, no sleeps.
import readline from 'node:readline';
const mode = process.env.DEATH_CERT_MODE ?? 'hold';
const marker = process.env.DEATH_CERT_MARKER ?? '';
if (process.env.DEATH_CERT_IGNORE_SIGTERM === '1') process.on('SIGTERM', () => {});
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
function filler() { return 'X'.repeat(6144); }
send({ type: 'system', subtype: 'init', session_id: 'dc-' + process.pid, model: 'claude-test-model' });
if (mode === 'exit137') {
  process.stdout.write(filler() + '\\nDC-STDOUT-137:' + marker + '\\n');
  process.stderr.write('DC-STDERR-137:' + marker + '\\n');
  process.exit(137);
}
if (mode === 'rate429') {
  process.stdout.write(filler() + '\\nDC-STDOUT-429:' + marker + '\\n');
  process.stderr.write('DC-STDERR-429:' + marker + '\\n');
  send({ type: 'rate_limit_event', rate_limit_event: { type: 'rate_limit', status: 429 } });
  process.exit(1);
}
// hold mode: survive SIGTERM and hold until the process group is SIGKILLed.
process.stdout.write(filler() + '\\nDC-STDOUT-HOLD:' + marker + '\\n');
process.stderr.write('DC-STDERR-HOLD:' + marker + '\\n');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', () => {});
`;

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'death-certs-fixture-'));
const FIXTURE = join(FIXTURE_DIR, 'fake-death-cert-cli.mjs');
writeFileSync(FIXTURE, FIXTURE_SOURCE);

function makeCli(opts = {}) {
  return new ClaudeSessionCli({ cmd: process.execPath, args: [FIXTURE], ...opts });
}

function brief() {
  return {
    goal: 'Death certs ride the terminal event',
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 10 },
  };
}

/** Event bus harness: buffers every event and lets tests await the first matching one. */
function harness(cliOpts = {}) {
  const cli = makeCli(cliOpts);
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) {
        const w = waiters[i];
        waiters.splice(i, 1);
        w.resolve(e);
      }
    }
  });
  function waitFor(pred, timeoutMs = 8000) {
    const already = events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor timeout after ${timeoutMs}ms; seen kinds: ${events.map((e) => e.kind).join(',')}`)),
        timeoutMs,
      );
      waiters.push({ pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
    });
  }
  function waitForKind(kind, timeoutMs) { return waitFor((e) => e.kind === kind, timeoutMs); }
  return { cli, events, waitFor, waitForKind };
}

function spawnWorktree() {
  return mkdtempSync(join(tmpdir(), 'death-certs-worktree-'));
}

async function emergencyCleanup(cli, worker) {
  try { await cli.kill(worker); } catch { /* already gone */ }
  const session = cli._sessions?.get(worker);
  if (session?.child && !session.child.killed) {
    try { process.kill(-session.pid, 'SIGKILL'); } catch { try { session.child.kill('SIGKILL'); } catch { /* gone */ } }
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const assertTail = (event, key, marker) => {
  const tail = event?.[key];
  assert.ok(typeof tail === 'string' && tail.length > 0, `${event?.kind}.${key} rides the terminal event`);
  assert.ok(Buffer.byteLength(tail, 'utf8') <= TAIL_BYTES, `${event?.kind}.${key} is bounded to 4KiB`);
  assert.ok(tail.includes(marker), `${event?.kind}.${key} keeps the last output (marker "${marker}")`);
};

// ---------------------------------------------------------------------------
// 1. SIGKILL — the member ignores SIGTERM, so the adapter's kill escalates; the
//    terminal events must name the SIGNAL, and carry the bounded tails.
// ---------------------------------------------------------------------------

test('death-certs: a SIGKILLed member — terminal events name the signal and carry bounded tails', async () => {
  const { cli, events, waitFor, waitForKind } = harness({
    env: { DEATH_CERT_MODE: 'hold', DEATH_CERT_MARKER: 'sigkill' },
  });
  const worker = 'dc-sigkill';
  try {
    const ack = await cli.spawn(worker, brief(), { worktree: spawnWorktree(), processGeneration: 21 });
    assert.equal(ack.ok, true);
    await waitForKind('lifecycle.spawned');
    // Let the fixture's stdout tail chunk reach the adapter (it is written before init is even
    // observed, but the parent must read it) — then SIGKILL the member's process group directly.
    // The adapter never asked it to stop, so the OS close tuple (null code, SIGKILL) is the crash
    // evidence and lifecycle.crashed fires.
    await waitFor(() => (cli._sessions.get(worker)?.stdoutTail ?? '').length > 0, 4000);
    const pid = cli._sessions.get(worker).pid;
    process.kill(-pid, 'SIGKILL');
    await waitForKind('lifecycle.process_closed');
    const crashed = await waitForKind('lifecycle.crashed');

    const closed = events.find((e) => e.kind === 'lifecycle.process_closed');
    assert.equal(closed.payload.code, null, 'process_closed close tuple: no exit code');
    assert.equal(closed.payload.signal, 'SIGKILL', 'process_closed close tuple names the signal');
    assert.equal(crashed.payload.signal, 'SIGKILL', 'crashed names the signal');
    assert.equal(crashed.payload.exitCode, null, 'crashed close tuple: no exit code');
    assert.equal(crashed.payload.causeClass, null, 'no provider failure was observed');

    assertTail(closed, 'stdoutTail', 'DC-STDOUT-HOLD');
    assertTail(closed, 'stderrTail', 'DC-STDERR-HOLD');
    assert.equal(crashed.payload.stdoutTail?.includes('DC-STDOUT-HOLD'), true, 'crashed payload carries the stdout tail');
    assert.equal(crashed.payload.stderrTail?.includes('DC-STDERR-HOLD'), true, 'crashed payload carries the stderr tail');
    assert.ok(Buffer.byteLength(crashed.payload.stdoutTail ?? '', 'utf8') <= TAIL_BYTES, 'crashed stdoutTail is bounded to 4KiB');
    assert.ok(Buffer.byteLength(crashed.payload.stderrTail ?? '', 'utf8') <= TAIL_BYTES, 'crashed stderrTail is bounded to 4KiB');
  } finally {
    await emergencyCleanup(cli, worker);
  }
});

// ---------------------------------------------------------------------------
// 2. exit 137-style code — the member exits 137 on its own; the terminal events
//    must name the EXIT CODE.
// ---------------------------------------------------------------------------

test('death-certs: an exit-137 member — terminal events name the exit code', async () => {
  const { cli, events, waitFor, waitForKind } = harness({
    env: { DEATH_CERT_MODE: 'exit137', DEATH_CERT_MARKER: 'exit137' },
  });
  const worker = 'dc-exit137';
  try {
    const ack = await cli.spawn(worker, brief(), { worktree: spawnWorktree(), processGeneration: 22 });
    assert.equal(ack.ok, true);
    await waitForKind('lifecycle.spawned');
    const crashed = await waitForKind('lifecycle.crashed');
    const closed = events.find((e) => e.kind === 'lifecycle.process_closed');

    assert.equal(closed.payload.code, 137, 'process_closed close tuple names the exit code');
    assert.equal(closed.payload.signal, null, 'process_closed close tuple: no signal');
    assert.equal(crashed.payload.exitCode, 137, 'crashed names the exit code');
    assert.equal(crashed.payload.signal, null, 'crashed close tuple: no signal');
    assert.equal(crashed.payload.causeClass, null, 'no provider failure was observed');

    assertTail(closed, 'stdoutTail', 'DC-STDOUT-137');
    assertTail(closed, 'stderrTail', 'DC-STDERR-137');
  } finally {
    await emergencyCleanup(cli, worker);
  }
});

// ---------------------------------------------------------------------------
// 3. adapter-surfaced provider 429 — the wire carries a rate_limit_event(429) before
//    death; the terminal events must name the provider CAUSE CLASS, and secret-shaped
//    tail content must be redacted.
// ---------------------------------------------------------------------------

test('death-certs: adapter-surfaced provider 429 — terminal events name the cause class; tails redact secret-shaped text', async () => {
  const { cli, events, waitFor, waitForKind } = harness({
    env: { DEATH_CERT_MODE: 'rate429', DEATH_CERT_MARKER: SECRET_TOKEN },
  });
  const worker = 'dc-rate429';
  try {
    const ack = await cli.spawn(worker, brief(), { worktree: spawnWorktree(), processGeneration: 23 });
    assert.equal(ack.ok, true);
    await waitForKind('lifecycle.spawned');
    const crashed = await waitForKind('lifecycle.crashed');
    const closed = events.find((e) => e.kind === 'lifecycle.process_closed');

    assert.equal(crashed.causeClass ?? crashed.payload.causeClass, '4xx', 'crashed names the provider cause class of the last failed request');
    assert.equal(closed.causeClass, '4xx', 'process_closed names the provider cause class');
    assert.equal(crashed.payload.exitCode, 1, 'crashed still carries the honest exit code');
    assert.equal(closed.payload.code, 1, 'process_closed still carries the honest exit code');

    // crashed carries the facts in its (unvalidated) payload; process_closed carries them
    // top-level (its payload shape is validated and must stay byte-stable).
    for (const [kind, key, source] of [
      ['crashed', 'stdoutTail', crashed.payload], ['crashed', 'stderrTail', crashed.payload],
      ['closed', 'stdoutTail', closed], ['closed', 'stderrTail', closed],
    ]) {
      const tail = source?.[key];
      assert.ok(typeof tail === 'string' && tail.length > 0, `${kind}.${key} rides the terminal event`);
      assert.ok(Buffer.byteLength(tail, 'utf8') <= TAIL_BYTES, `${kind}.${key} is bounded to 4KiB`);
      assert.ok(!tail.includes(SECRET_TOKEN), `${kind}.${key} redacts the secret-shaped token`);
      assert.ok(tail.includes('[redacted]'), `${kind}.${key} applies the SECRET_SHAPED_TEXT redaction class`);
    }
  } finally {
    await emergencyCleanup(cli, worker);
  }
});

// ---------------------------------------------------------------------------
// 4. Coordinator LEDGER — the operational event stream preserves the adapter's
//    death-cert facts AND the member's route tuple on both terminal kinds.
// ---------------------------------------------------------------------------

function stubCard() {
  return {
    schemaVersion: 1,
    autonomy: {
      supported: ['unattended', 'interactive'], default: 'unattended', perTask: true,
      observation: 'launch', mechanisms: ['approval-policy-never'],
    },
    access: {
      supported: ['full', 'workspace'], default: 'full', perTask: true,
      observation: 'launch', mechanisms: ['host-full-permissions'],
    },
    harness: 'stub', version: '1', concurrencyCeiling: 1, maxContext: 1_000,
    modelSelection: {
      mode: 'exact', configuredDefault: 'stub-model', available: ['stub-model'], family: 'stub',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'test', refreshedAt: null,
    },
    verbs: {
      spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
      approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
    },
  };
}

function directBrief() {
  return {
    goal: 'Bind the death cert', constraints: [], pathScope: ['**'], definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  };
}

test('death-certs: the coordinator ledger preserves death-cert facts and the member route tuple on both terminal kinds', async () => {
  let emit = () => {};
  const adapter = {
    onEvent(callback) { emit = callback; },
    card: stubCard,
    async spawn(worker, _brief, opts) {
      const generation = opts.processGeneration;
      const pid = 42_101;
      const base = { worker, harness: 'stub', turnEpoch: 1, actor: 'worker' };
      emit({ ...base, kind: 'lifecycle.process_started', payload: processStartedPayload(generation, pid) });
      return { ok: true };
    },
    async kill() { return { ok: true }; },
    async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  const log = new Log(mkdtempSync(join(tmpdir(), 'death-certs-coord-log-')));
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 1_000,
  });
  const publicHandle = await coordinator.spawn('stub', directBrief(), {
    taskId: 'dc-ledger-task', model: 'stub-model', effort: 'high',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const internal = coordinator._workers.get(publicHandle.id);
  const generation = internal.processGeneration;
  const pid = internal.processRef?.pid ?? 42_101;
  const base = { worker: publicHandle.id, harness: 'stub', turnEpoch: 1, actor: 'worker' };

  emit({
    ...base,
    kind: 'lifecycle.process_closed',
    payload: processClosedPayload(generation, pid, null, 'SIGKILL', false),
    causeClass: '4xx',
    stdoutTail: 'DC-LEDGER-OUT\n',
    stderrTail: 'DC-LEDGER-ERR\n',
  });
  await new Promise((resolve) => setImmediate(resolve));
  emit({
    ...base,
    kind: 'lifecycle.crashed',
    payload: {
      error: 'exited null (SIGKILL)', exitCode: null, signal: 'SIGKILL', causeClass: '4xx',
      stdoutTail: 'DC-LEDGER-OUT\n', stderrTail: 'DC-LEDGER-ERR\n',
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const ledger = log.read(publicHandle.id);
  const closed = ledger.find((event) => event.kind === 'lifecycle.process_closed');
  const crashed = ledger.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(closed, 'the ledger records lifecycle.process_closed');
  assert.ok(crashed, 'the ledger records lifecycle.crashed');

  // Close tuple rides the (validated, byte-stable) process_closed payload.
  assert.equal(closed.payload.code, null);
  assert.equal(closed.payload.signal, 'SIGKILL');
  // Cause class + bounded tails ride TOP-LEVEL on the ledger event, preserved from the adapter.
  assert.equal(closed.causeClass, '4xx', 'ledger process_closed preserves the provider cause class');
  assert.equal(closed.stdoutTail, 'DC-LEDGER-OUT\n', 'ledger process_closed preserves the stdout tail');
  assert.equal(closed.stderrTail, 'DC-LEDGER-ERR\n', 'ledger process_closed preserves the stderr tail');
  // The member's route tuple rides the ledger event.
  assert.equal(closed.taskId, 'dc-ledger-task');
  assert.equal(closed.harnessResolved, 'stub@1');
  assert.equal(closed.modelResolved, 'stub-model');
  assert.equal(closed.effortResolved, 'high');
  assert.ok(Object.hasOwn(closed, 'runId'), 'runId rides the route tuple');

  // crashed: facts ride the payload (unvalidated passthrough) + route tuple top-level.
  assert.equal(crashed.payload.exitCode, null);
  assert.equal(crashed.payload.signal, 'SIGKILL');
  assert.equal(crashed.payload.causeClass, '4xx');
  assert.equal(crashed.payload.stdoutTail, 'DC-LEDGER-OUT\n');
  assert.equal(crashed.payload.stderrTail, 'DC-LEDGER-ERR\n');
  assert.equal(crashed.taskId, 'dc-ledger-task');
  assert.equal(crashed.harnessResolved, 'stub@1');
  assert.equal(crashed.modelResolved, 'stub-model');
  assert.equal(crashed.effortResolved, 'high');
});
