// phase10-driver-e2e.test.mjs — TDD-RED tests for SC3/SC10 (spec/phase10/system-completion.md):
// driver-level fake E2E, per session vendor, through the REAL createDriver() against a REAL temp
// git repo. Zero quota: every vendor binary is its wire-faithful fake.
//
// This is the test tier the completeness audits kept asking for: overclaims live in the seams,
// so completion is proven at the seam — coordinator dispatch -> adapter spawn -> wire -> events
// -> trust gate (fresh-worktree re-verification) -> task terminal state.
//
// RED reasons today (G1): the coordinator dispatches spawn(worker, brief, {worktreeReady})
// (coordinator.mjs:223) — claude-session refuses it loudly (claude-session.mjs:126) so its turn
// never starts; codex/grok accept but run in the WRONG cwd (codex-appserver.mjs:412,
// grok-acp.mjs:408) — the task even "completes", and only the cwd-echo assertion exposes the lie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDriver } from '../src/index.mjs';
import { createBrief } from '../src/messages.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRealRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'p10-e2e-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'baton-test@localhost'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'baton-test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'phase10 driver e2e\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function fullBrief(goal) {
  return createBrief({
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'the fake turn completes and the pinned check passes',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  });
}

function makeDriver(adapters) {
  return createDriver({
    repoRoot: makeRealRepo(),
    logDir: mkdtempSync(join(tmpdir(), 'p10-e2e-log-')),
    adapters,
    stopDeadlineMs: 3000,
    // TG1/TG3: these pausable native-session vendors checkpoint every turn_completed; a short
    // steering window lets the cycle expire and the gate evaluate the turn promptly.
    progressNudgeWindowMs: 50,
  });
}

async function pollTask(coordinator, workerId, wanted, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await coordinator.result(workerId);
    if (wanted.includes(last.status)) return last;
    await sleep(25);
  }
  assert.fail(`worker ${workerId} never reached ${wanted.join('/')} within ${timeoutMs}ms (last status: "${last && last.status}") — the G1 built-not-wired gap at driver level`);
}

async function waitForLogEvent(log, workerId, pred, label, timeoutMs = 5000) {
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

test('SC3: claude session vendor through createDriver — spawn, mid-turn steer, trust gate, completed', async () => {
  const { coordinator, log } = makeDriver({ claude: new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] }) });
  const h = await coordinator.spawn('claude', fullBrief('HOLD_UNTIL_INTERRUPT'));
  const task = coordinator._tasks.get(h.taskId);
  // TG1/TG3: a pausable native session checkpoints every turn_completed. This test drives the
  // gate through the epic's drivered path — a live steering registration parks the checkpoint
  // and the driver's claim re-runs the full trust gate (byte-identical to today's claim cadence).
  coordinator._coordRecord(
    'steering.registered', { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator',
  );
  try {
    // The adapter's own turn_started (actor:worker) proves the child session is live —
    // the coordinator logs its own orchestrator-actor turn_started at dispatch regardless.
    await waitForLogEvent(log, h.id, (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker', 'worker-actor turn_started (RED-today: adapter spawn refused {worktreeReady}, session never came up)');
    const steer = await coordinator.send(h.id, 'stop holding and wrap up now', 'steer');
    assert.equal(steer.ok, true, `mid-turn steer must deliver into the running turn (erratum E2 semantics): ${JSON.stringify(steer)}`);
    // The steered turn completes → the drivered checkpoint pause pends.
    await waitForLogEvent(log, h.id, (e) => e.kind === 'turn.paused', 'checkpoint pause');
    const pause = coordinator.pausedTurns({ taskId: h.taskId })[0];
    assert.ok(pause, 'the checkpoint pause pends for the driver claim');
    await coordinator.claimTurn(pause.pauseId, { actor: 'orchestrator' });
    const r = await pollTask(coordinator, h.id, ['completed', 'failed']);
    assert.equal(r.status, 'completed', `the steered turn must complete and pass the fresh-worktree trust gate (verdict: ${JSON.stringify(r.verdict)})`);
    assert.equal(r.verdict.reverified, true, 'the gate re-ran the pinned verification — never trusted the worker claim');
  } finally { await Promise.resolve(coordinator.kill(h.id)).catch(() => {}); }
});

test('SC3: claude interrupt through the driver — two-phase stop ends the task cancelled', async () => {
  const { coordinator, log } = makeDriver({ claude: new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE] }) });
  const h = await coordinator.spawn('claude', fullBrief('HOLD_UNTIL_INTERRUPT'));
  try {
    await waitForLogEvent(log, h.id, (e) => e.kind === 'lifecycle.turn_started' && e.actor === 'worker', 'worker-actor turn_started (RED-today: adapter spawn refused {worktreeReady})');
    await coordinator.interrupt(h.id);
    const r = await pollTask(coordinator, h.id, ['cancelled', 'completed', 'failed']);
    assert.equal(r.status, 'cancelled', 'the confirmed stop must land as cancelled — an event, never an assumption (D9)');
  } finally { await Promise.resolve(coordinator.kill(h.id)).catch(() => {}); }
});

test('SC10: codex app-server vendor through createDriver — thread pinned to the task worktree, trust gate, completed', async () => {
  const { coordinator, log } = makeDriver({
    codex: new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 3000, versionProbe: () => '0.144.0-fake' }),
  });
  const h = await coordinator.spawn('codex', fullBrief('FAKE:REPORT_CWD'));
  try {
    const r = await pollTask(coordinator, h.id, ['completed', 'failed']);
    assert.equal(r.status, 'completed', JSON.stringify(r.verdict));
    const worktree = coordinator.list().find((w) => w.id === h.id).worktree;
    assert.ok(worktree, 'dispatch must record the task worktree');
    const echo = await waitForLogEvent(log, h.id, (e) => e.kind === 'content.message' && String(e.payload?.text ?? '').startsWith('cwd:'), 'cwd echo');
    assert.equal(
      echo.payload.text, `cwd:${worktree}`,
      'RED-today: the task "completes" while thread/start.cwd was silently undefined — the exact G1 failure the audit called correctness-critical',
    );
  } finally { await Promise.resolve(coordinator.kill(h.id)).catch(() => {}); }
});

test('SC10: grok ACP vendor through createDriver — child AND session pinned to the task worktree, trust gate, completed', async () => {
  const { coordinator, log } = makeDriver({
    grok: new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 3000, versionProbe: () => '0.1.216-fake' }),
  });
  const h = await coordinator.spawn('grok', fullBrief('FAKE:REPORT_CWD'));
  try {
    const r = await pollTask(coordinator, h.id, ['completed', 'failed']);
    assert.equal(r.status, 'completed', JSON.stringify(r.verdict));
    const worktree = coordinator.list().find((w) => w.id === h.id).worktree;
    assert.ok(worktree, 'dispatch must record the task worktree');
    const echo = await waitForLogEvent(log, h.id, (e) => e.kind === 'content.message' && String(e.payload?.text ?? '').startsWith('cwd:'), 'cwd echo');
    assert.ok(echo.payload.text.startsWith(`cwd:${worktree} `), `RED-today: session/new.cwd silently undefined; wire said: ${echo.payload.text}`);
    assert.ok(echo.payload.text.includes(`oscwd:${realpathSync(worktree)}`), `grok indexes its OS cwd at startup — the child must run IN the worktree; wire said: ${echo.payload.text}`);
  } finally { await Promise.resolve(coordinator.kill(h.id)).catch(() => {}); }
});
