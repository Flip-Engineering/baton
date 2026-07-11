// phase10-completion.test.mjs — TDD-RED tests for spec/phase10/system-completion.md (SC1–SC8).
//
// Each test names its contract and its expected RED reason today. Tests marked LOCK-IN pass
// today and pin behavior the contracts depend on. Everything runs against the REAL adapters and
// the REAL fake binaries (zero quota), or against the real Coordinator with minimal stub deps —
// assertions target EFFECTS (which process ran where, what reached the wire, task state), never
// bare return values alone, per house rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { createDriver } from '../src/index.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { MockAdapter, CodexAdapter, ClaudeAdapter, GlmAdapter } from '../src/adapter.mjs';
import { CodexCli, ClaudeCli, ZCodeCli, PiCli } from '../src/cli-adapters.mjs';
import { initialState, foldEvent, renderNarrative } from '../src/story.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const p = new Promise((r) => { resolve = r; });
  return { p, resolve };
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

/** Buffers every adapter event; lets tests await the first matching one, failing fast. */
function collect(cli) {
  const events = [];
  const waiters = [];
  cli.onEvent((e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].pred(e)) { const w = waiters.splice(i, 1)[0]; w.resolve(e); }
    }
  });
  return {
    events,
    waitFor(pred, timeoutMs = 4000) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`waitFor timeout after ${timeoutMs}ms; saw kinds: ${events.map((e) => e.kind).join(',')}`)), timeoutMs);
        waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    },
  };
}

/** Minimal-but-real stub adapter satisfying the D1 surface, with call recording. */
function stubAdapter(over = {}) {
  const calls = { spawn: [], prompt: [], interrupt: [], kill: [] };
  return {
    calls,
    _cb: null,
    onEvent(cb) { this._cb = cb; },
    emit(e) { if (this._cb) this._cb(e); },
    card: () => ({
      harness: over.harness ?? 'stub',
      version: over.version ?? '1',
      authPosture: 'subscription',
      concurrencyCeiling: over.ceiling ?? 4,
      maxContext: 1000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      ...(over.card ?? {}),
    }),
    spawn: over.spawn ?? (async (w, b, o) => { calls.spawn.push([w, b, o]); return { ok: true }; }),
    prompt: over.prompt ?? (async (w, m, mode) => { calls.prompt.push([m, mode]); return { ok: true }; }),
    interrupt: async (w, then) => { calls.interrupt.push([w, then]); return { ok: true }; },
    kill: async (w) => { calls.kill.push(w); return { ok: true }; },
    approve: async () => ({ ok: true }),
    answer: async () => ({ ok: true }),
  };
}

/** Real Coordinator over stub worktrees/referee — the send/dispatch machinery under test is real. */
function makeCoordinator({ adapters, route } = {}) {
  const logDir = mkdtempSync(join(tmpdir(), 'p10-log-'));
  const log = new Log(logDir, () => new Date().toISOString());
  const fences = new FenceTable();
  const worktrees = {
    create: async (taskId) => ({ path: mkdtempSync(join(tmpdir(), `p10-wt-${taskId}-`)), branch: 'b', baseSha: 'x' }),
    capture: async () => ({ sha: 'deadbeef', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: mkdtempSync(join(tmpdir(), 'p10-vf-')) }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const referee = async () => ({ reverified: true, observedExit: 0 });
  const routeFn = route ?? ((task, cards) => Object.keys(cards)[0]);
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences, adapters, worktrees, repoRoot: tmpdir(), referee,
    route: routeFn, now: Date.now, approvalTimeoutMs: 2000, stopDeadlineMs: 2000,
  });
  return { coordinator, log };
}

// ---------------------------------------------------------------------------
// SC2 — session classes are product surface
// ---------------------------------------------------------------------------

test('SC2: index.mjs exports the session tier (ClaudeSessionCli/CodexAppServerCli/GrokAcpCli/GlmSessionCli)', async () => {
  const mod = await import('../src/index.mjs');
  for (const name of ['ClaudeSessionCli', 'CodexAppServerCli', 'GrokAcpCli', 'GlmSessionCli']) {
    assert.equal(typeof mod[name], 'function', `RED-today: index.mjs does not export ${name} — the product tier is unreachable through the entry point (G1-assembly)`);
  }
});

// ---------------------------------------------------------------------------
// SC1 — one spawn contract
// ---------------------------------------------------------------------------

test('SC1a: ClaudeSessionCli.spawn accepts the coordinator dispatch contract ({worktreeReady}) and runs the child IN the resolved path', async () => {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-claude-wt-'));
  try {
    const ack = await cli.spawn('w1', brief('REPORT_CWD'), { worktreeReady: Promise.resolve({ path: wt }) });
    assert.equal(ack.ok, true, `RED-today: the coordinator passes {worktreeReady} (coordinator.mjs:223) but the adapter demands opts.worktree (claude-session.mjs:126) — got: ${ack.reason}`);
    const done = await c.waitFor((e) => e.kind === 'lifecycle.turn_completed');
    assert.ok(
      done.payload.result.summary.includes(`cwd:${realpathSync(wt)}`),
      `the child must run in the resolved worktree, not the orchestrator cwd; summary: ${done.payload.result.summary}`,
    );
  } finally { await Promise.resolve(cli.kill('w1')).catch(() => {}); }
});

test('SC1b: no resolvable cwd (absent, or failed worktreeReady) => spawn refuses — never a silent orchestrator-cwd session', async () => {
  const rejected = () => { const p = Promise.reject(new Error('worktree creation failed')); p.catch(() => {}); return p; };
  const cases = [
    // claude rows are LOCK-INs today (its loud guard is half-right already); codex/grok are RED.
    ['claude', new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] })],
    ['codex', new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2000, versionProbe: () => '0.144.0-fake' })],
    ['grok', new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 2000, versionProbe: () => '0.1.216-fake' })],
  ];
  for (const [name, cli] of cases) {
    try {
      const bare = await cli.spawn(`${name}-bare`, brief('hello'), {});
      assert.equal(bare.ok, false, `RED-today(${name === 'claude' ? 'lock-in' : name}): spawn with NO cwd source must refuse — codex silently drops thread/start.cwd (codex-appserver.mjs:412), grok inherits the orchestrator cwd (grok-acp.mjs:408)`);
      const rej = await cli.spawn(`${name}-rej`, brief('hello'), { worktreeReady: rejected() });
      assert.equal(rej.ok, false, `${name}: spawn with a failed worktreeReady must refuse, not fall through to undefined cwd`);
    } finally {
      for (const w of [`${name}-bare`, `${name}-rej`]) await Promise.resolve(cli.kill(w)).catch(() => {});
    }
  }
});

test('SC1c: codex threads the worktreeReady-resolved path into thread/start.cwd', async () => {
  const cli = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2000, versionProbe: () => '0.144.0-fake' });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-codex-wt-'));
  try {
    const ack = await cli.spawn('w1', brief('FAKE:REPORT_CWD'), { worktreeReady: Promise.resolve({ path: wt }) });
    assert.equal(ack.ok, true, `spawn via worktreeReady must succeed (got: ${ack.reason})`);
    const msg = await c.waitFor((e) => e.kind === 'content.message' && String(e.payload.text ?? '').startsWith('cwd:'));
    assert.equal(msg.payload.text, `cwd:${wt}`, 'RED-today: thread/start is sent with cwd undefined — the thread runs wherever the app-server happens to sit');
    await c.waitFor((e) => e.kind === 'lifecycle.turn_completed');
  } finally { await Promise.resolve(cli.kill('w1')).catch(() => {}); }
});

test('SC1c: grok pins the worktreeReady-resolved path as BOTH the child OS cwd and session/new.cwd', async () => {
  const cli = new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 2000, versionProbe: () => '0.1.216-fake' });
  const c = collect(cli);
  const wt = mkdtempSync(join(tmpdir(), 'p10-grok-wt-'));
  try {
    const ack = await cli.spawn('w1', brief('FAKE:REPORT_CWD'), { worktreeReady: Promise.resolve({ path: wt }) });
    assert.equal(ack.ok, true, `spawn via worktreeReady must succeed (got: ${ack.reason})`);
    const msg = await c.waitFor((e) => e.kind === 'content.message' && String(e.payload.text ?? '').startsWith('cwd:'));
    assert.ok(msg.payload.text.startsWith(`cwd:${wt} `), `RED-today: session/new.cwd is undefined; wire said: ${msg.payload.text}`);
    assert.ok(msg.payload.text.includes(`oscwd:${realpathSync(wt)}`), `grok indexes its OS cwd at startup (grok-acp.mjs:408) — the child must be spawned IN the worktree; wire said: ${msg.payload.text}`);
  } finally { await Promise.resolve(cli.kill('w1')).catch(() => {}); }
});

test('SC1d: a refused adapter spawn fails the task — never a zombie stuck in "working"', async () => {
  const bad = stubAdapter({ spawn: async () => ({ ok: false, reason: 'auth gate closed' }) });
  const { coordinator, log } = makeCoordinator({ adapters: { v: bad } });
  const h = await coordinator.spawn('v', brief('x'));
  await sleep(50); // the fire-and-forget ack settles
  const r = await coordinator.result(h.id);
  assert.equal(r.status, 'failed', `RED-today: the spawn Ack is discarded (.catch(noop), coordinator.mjs:226) so a refused spawn leaves the task "${r.status}" forever`);
  const crash = log.read(h.id).filter((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'spawn');
  assert.equal(crash.length, 1, 'SC19/C-1: spawn refusal must be durable and replayable, not only an in-memory status write');
});

// ---------------------------------------------------------------------------
// SC4 — ordered, revalidated delivery
// ---------------------------------------------------------------------------

test('SC4a: deliveries to one worker are serialized in send() call order', async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const promptLog = [];
  const a = stubAdapter({
    prompt: async (w, m) => { promptLog.push(m); if (m === 'A') await gate.p; return { ok: true }; },
  });
  const { coordinator } = makeCoordinator({ adapters: { v: a } });
  const h = await coordinator.spawn('v', brief('x'));
  const pA = coordinator.send(h.id, 'A', 'send');
  const pB = coordinator.send(h.id, 'B', 'send');
  await sleep(40);
  assert.deepEqual(promptLog, ['A'], `RED-today: B reached the adapter while A was still in flight (saw: ${promptLog.join(',')}) — concurrent sends can deliver out of order (coordinator.mjs:372 never holds a per-worker slot)`);
  gate.resolve();
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.deepEqual(promptLog, ['A', 'B'], 'B delivers after A resolves — order preserved, nothing dropped');
  assert.equal(rA.ok, true);
  assert.equal(rB.ok, true);
});

test('SC4b: a queued send re-evaluates its guards at delivery time — an interrupt landing first wins', async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const promptLog = [];
  const a = stubAdapter({
    prompt: async (w, m) => { promptLog.push(m); if (m === 'A') await gate.p; return { ok: true }; },
  });
  const { coordinator } = makeCoordinator({ adapters: { v: a } });
  const h = await coordinator.spawn('v', brief('x'));
  const pA = coordinator.send(h.id, 'A', 'send'); // in flight, holding the slot
  await sleep(20);
  const pB = coordinator.send(h.id, 'B', 'send'); // queued behind A (per SC4a)
  await sleep(20);
  // Request the stop but do NOT await its resolution — the stop stays pending ('stopping')
  // while A's delivery completes; awaiting here would ride out the whole stop deadline and the
  // worker would no longer be stopping by the time B's slot opened.
  const pI = coordinator.interrupt(h.id); // human authority supersedes queued work (R5.1 spirit)
  await sleep(20);
  gate.resolve();
  const [rB] = await Promise.all([pB, pA.catch(() => null)]);
  assert.equal(rB.ok, false, 'RED-today: B was already delivered before the interrupt could count — a queued send must re-check the stopping guard when its slot opens');
  assert.deepEqual(promptLog, ['A'], `only A may reach the adapter (saw: ${promptLog.join(',')})`);
  // Settle the pending stop so the test leaves no dangling deadline behind.
  a.emit({ worker: h.id, harness: 'stub@1', turnEpoch: 1, kind: 'control.interrupt_confirmed', actor: 'worker', payload: {} });
  await Promise.resolve(pI).catch(() => {});
});

// ---------------------------------------------------------------------------
// SC5 — story lifecycle truth (pure folds)
// ---------------------------------------------------------------------------

function ev(worker, seq, kind, payload = {}, extra = {}) {
  return {
    worker, seq, kind, payload,
    ts: `2026-07-10T00:00:${String(Math.min(seq, 59)).padStart(2, '0')}.000Z`,
    harness: 'h@1', turnEpoch: extra.turnEpoch ?? 1, actor: extra.actor ?? 'worker',
  };
}

function foldAll(events) {
  let s = initialState();
  for (const e of events) s = foldEvent(s, e);
  return s;
}

test('SC5a: kill.confirmed folds to terminal "exited" — a killed worker\'s narrative must end', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'kill.confirmed', { signal: 'SIGKILL' }, { actor: 'orchestrator' }),
  ]);
  const w = s.workers.get('w1');
  assert.equal(w.status, 'exited', `RED-today: kill.confirmed is not in the story KIND vocabulary (story.mjs:75–95), so the worker stays "${w.status}" forever (G12)`);
});

test('SC5b: turn_completed folds working -> idle (the worker finished; it is not "active")', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'lifecycle.turn_completed', { result: { status: 'completed' } }),
  ]);
  assert.equal(s.workers.get('w1').status, 'idle', 'RED-today: TURN_COMPLETED only records turnEpoch (story.mjs:322–324) — completed workers stay "working" (G7)');
});

test('SC5b LOCK-IN: turn_completed while "stopping" leaves the stop in charge — no transition, no illegal_transition warning', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'control.interrupt_requested', {}, { actor: 'orchestrator' }),
    ev('w1', 4, 'lifecycle.turn_completed', { result: { status: 'completed' } }),
  ]);
  const w = s.workers.get('w1');
  assert.equal(w.status, 'stopping', 'the stop confirmation owns the terminal state of this race');
  assert.ok(!w.warnings.has('illegal_transition'), 'a legal race must not be branded an illegal transition');
});

test('SC5c: verify.reverified is recorded on the story (lastVerdict), closing the silent no-op', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'lifecycle.turn_completed', { result: { status: 'completed' } }),
    ev('w1', 4, 'verify.reverified', { accept: true, verdict: { reverified: true, observedExit: 0 } }, { actor: 'policy' }),
  ]);
  const w = s.workers.get('w1');
  assert.deepEqual(w.lastVerdict, { accept: true }, 'RED-today: verify.reverified is unknown to the story — the one kind the coordinator itself emits folds to nothing (DoD item 7)');
});

test('SC5d: the narrative counts verified-done work as done, not active', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'lifecycle.turn_completed', { result: { status: 'completed' } }),
    ev('w1', 4, 'verify.reverified', { accept: true }, { actor: 'policy' }),
    ev('w2', 1, 'lifecycle.spawned', { taskId: 't2', brief: brief('y') }),
    ev('w2', 2, 'lifecycle.turn_started'),
  ]);
  const text = renderNarrative(s, { now: Date.parse('2026-07-10T00:00:10.000Z') });
  assert.ok(text.startsWith('1 worker(s) active, 1 done'), `RED-today: every non-exited worker counts "active" (story.mjs:593); narrative was:\n${text}`);
  assert.match(text, /w1 .*done \(verified\)/, `the verified worker must read as done; narrative was:\n${text}`);
});

test('SC5d: a failed verification reads as idle (verification failed), never silently "done"', () => {
  const s = foldAll([
    ev('w1', 1, 'lifecycle.spawned', { taskId: 't1', brief: brief('x') }),
    ev('w1', 2, 'lifecycle.turn_started'),
    ev('w1', 3, 'lifecycle.turn_completed', { result: { status: 'completed' } }),
    ev('w1', 4, 'verify.reverified', { accept: false }, { actor: 'policy' }),
  ]);
  const text = renderNarrative(s, { now: Date.parse('2026-07-10T00:00:10.000Z') });
  assert.match(text, /w1 .*idle \(verification failed\)/, `RED-today: the story cannot tell a failed gate from plain idle; narrative was:\n${text}`);
});

// ---------------------------------------------------------------------------
// SC7 — deterministic capability routing (nonRefuserFor)
// ---------------------------------------------------------------------------

function makeRealRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'p10-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'baton-test@localhost'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'baton-test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'phase10\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeRoutingDriver({ bCard } = {}) {
  const a = stubAdapter({ harness: 'stub-a' });
  const b = stubAdapter({ harness: 'stub-b', card: bCard });
  const driver = createDriver({
    repoRoot: makeRealRepo(),
    logDir: mkdtempSync(join(tmpdir(), 'p10-route-log-')),
    adapters: { a, b },
  });
  return { a, b, driver };
}

test('SC7: a taskType listed in a card nonRefuserFor restricts routing to the capable vendor', async () => {
  const { a, b, driver } = makeRoutingDriver({ bCard: { nonRefuserFor: ['cybersecurity'] } });
  await driver.coordinator.spawn('auto', brief('domain probe'), { taskType: 'cybersecurity' });
  await sleep(40);
  assert.equal(b.calls.spawn.length, 1, 'RED-today: route() (index.mjs:69–84) never reads nonRefuserFor — the tie-break hands domain-sensitive work to the first-listed vendor');
  assert.equal(a.calls.spawn.length, 0, 'the incapable vendor must not receive the domain-tagged task while a capable one is feasible');
});

test('SC7 LOCK-IN: an unlisted taskType leaves routing unrestricted (first-listed wins the fresh-router tie)', async () => {
  const { a, b, driver } = makeRoutingDriver({ bCard: { nonRefuserFor: ['cybersecurity'] } });
  await driver.coordinator.spawn('auto', brief('plain work'), { taskType: 'general' });
  await sleep(40);
  assert.equal(a.calls.spawn.length, 1);
  assert.equal(b.calls.spawn.length, 0);
});

test('SC7 LOCK-IN: a domain tag NO card carries never strands the task — pool stays unrestricted', async () => {
  const { a, b, driver } = makeRoutingDriver({});
  await driver.coordinator.spawn('auto', brief('untagged domain'), { taskType: 'cybersecurity' });
  await sleep(40);
  assert.equal(a.calls.spawn.length, 1, 'no capable vendor => unrestricted pool, task still dispatches');
  assert.equal(b.calls.spawn.length, 0);
});

// ---------------------------------------------------------------------------
// SC8 — one card shape, honest values, every exported adapter
// ---------------------------------------------------------------------------

const CANONICAL = ['answer', 'approve', 'interrupt', 'kill', 'pause', 'prompt', 'spawn', 'steer'];
const CLOSED = new Set(['native', 'emulated', 'unsupported']);
const ONE_SHOT_VERBS = { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'emulated', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' };
const LEGACY_VERBS = { spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'unsupported', approve: 'unsupported', answer: 'unsupported', kill: 'unsupported', pause: 'unsupported' };

const CARD_CASES = [
  ['MockAdapter', () => new MockAdapter(), { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' }],
  ['CodexAdapter (legacy)', () => new CodexAdapter(), LEGACY_VERBS],
  ['ClaudeAdapter (legacy)', () => new ClaudeAdapter(), LEGACY_VERBS],
  ['GlmAdapter (legacy)', () => new GlmAdapter(), LEGACY_VERBS],
  ['CodexCli (one-shot)', () => new CodexCli(), ONE_SHOT_VERBS],
  ['ClaudeCli (one-shot)', () => new ClaudeCli(), ONE_SHOT_VERBS],
  ['ZCodeCli (one-shot)', () => new ZCodeCli(), ONE_SHOT_VERBS],
  ['PiCli (unconfigured)', () => new PiCli(), { ...ONE_SHOT_VERBS, spawn: 'unsupported' }],
  ['ClaudeSessionCli (session)', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] }), { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'unsupported', answer: 'unsupported', kill: 'native', pause: 'unsupported' }],
  ['CodexAppServerCli (session)', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2000, versionProbe: () => 'x' }), { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' }],
  ['GrokAcpCli (session)', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 2000, versionProbe: () => 'x' }), { spawn: 'native', prompt: 'native', steer: 'emulated', interrupt: 'native', approve: 'native', answer: 'unsupported', kill: 'native', pause: 'unsupported' }],
];

for (const [name, make, expected] of CARD_CASES) {
  test(`SC8: ${name} card().verbs is the canonical 8-key shape with honest closed-set values`, () => {
    const card = make().card();
    assert.deepEqual(
      Object.keys(card.verbs).sort(), CANONICAL,
      `RED-today for non-session tiers: ${name} exposes ${Object.keys(card.verbs).length} keys (${Object.keys(card.verbs).join(',')}) — a fleet operator cannot compare capability across mixed vocabularies (G10)`,
    );
    for (const [verb, val] of Object.entries(card.verbs)) {
      assert.ok(CLOSED.has(val), `${name}.${verb}="${val}" is outside the closed value set`);
    }
    if (expected) {
      assert.deepEqual(card.verbs, expected, `${name}: values must match the implemented surface — a card claiming a verb its methods stub out is the docs/22 overclaim pattern in miniature`);
    }
  });
}
