// OMP ordinary-run pause — the audit A-G2 / N2 / I6 row for the REAL adapter card.
//
// THE FACT. `_turnCompletionOf` (coordinator.mjs:3295) answers 'pausable' for a swarm participant
// run before it ever reads the card, so a swarm member's completed turn parks regardless. That is
// exactly why the missing card field hid for so long. For an ORDINARY run the card IS the only
// input: `turnCompletion` absent ⇒ `'claim'` ⇒ the completed turn goes straight to the trust gate
// and `turn.paused` is never minted. OMP's card omitted the field (audit A-G1/G2/I6).
//
// This row drives the REAL `OmpRpcCli` through a real `Coordinator` with NO swarm participant run
// anywhere (a bare dispatch: the `hasSwarmParticipantRun` shortcut is provably not in play), ends
// one provider turn the way the wire does (`agent_end`), and asserts the ordinary OMP completion
// parks as a VISIBLE, claimable checkpoint — no gate dispatch, no second turn, no kill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

const MODEL = 'deepseek/deepseek-v4-flash';
const line = (frame) => `${JSON.stringify(frame)}\n`;

const dirs = [];
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-omp-pause-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 515151;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.written = [];
    this.stdin = {
      destroyed: false,
      write: (chunk) => { for (const raw of String(chunk).split('\n')) if (raw.trim()) this.written.push(JSON.parse(raw)); return true; },
      end: () => { this.stdin.destroyed = true; },
    };
    setImmediate(() => this.stdout.write(line({ type: 'ready', protocolVersion: 1 })));
  }
  kill(signal) { setImmediate(() => this.emit('exit', 0, signal ?? null)); return true; }
}

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff and report completion',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100_000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['in-scope.txt'] });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(fn, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not met');
    await sleep(5);
  }
}

test('A-G2/I6: an ordinary OMP turn completion parks a visible checkpoint (the card is the only input)', async () => {
  const child = new FakeChild();
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 2_000, model: MODEL, modelCatalog: { [MODEL]: ['high'] },
    versionProbe: () => 'omp test', spawnFn: () => child,
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  assert.equal(adapter.card().turnCompletion, 'pausable', 'the card declares the pausable turn lifecycle');

  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture: withDiff,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { omp: adapter }, worktrees,
    referee: async (task) => ({ reverified: true, observedExit: task.brief.verification.expectExit, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'omp',
    now: () => 0,
    approvalTimeoutMs: 60_000,
    stopDeadlineMs: 15_000,
  });

  const handle = await coordinator.spawn('omp', makeBrief(), { model: MODEL, effort: 'high' });
  const task = coordinator._tasks.get(handle.taskId);
  // The pre-condition that makes this an ORDINARY run: no swarm participant run exists, so
  // `_turnCompletionOf` cannot be answering 'pausable' through its swarm shortcut
  // (coordinator.mjs:3296) — only the card can.
  assert.notEqual(coordination.hasSwarmParticipantRun?.(task.runId ?? null), true,
    'this dispatch is an ordinary run: the swarm-participant shortcut is not in play');
  await until(() => coordinator._workers.get(handle.id)?.turnInFlight === true);
  const promptsBefore = child.written.filter((frame) => frame.type === 'prompt').length;
  assert.equal(promptsBefore, 1, 'the first turn rode spawn (#230), as every real adapter does');

  // The provider turn ends the way the wire says it ends.
  child.stdout.write(line({
    type: 'agent_end', isTerminal: true,
    messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'change complete' }] }],
  }));
  await until(() => task.status === 'paused');

  const rows = coordinator.pausedTurns({ taskId: task.id });
  assert.equal(rows.length, 1, 'exactly one claimable checkpoint is projected for the orchestrator');
  assert.equal(rows[0].state, 'pending');
  assert.equal(rows[0].consumer, null, 'nobody decided it — it awaits an explicit act');
  assert.equal(rows[0].workerId, handle.id);
  const origin = coordinator._log.read(handle.id).find((event) => event.kind === 'turn.paused')?.payload?.origin;
  assert.equal(origin?.kind, 'turn_completed', 'the durable pause origin is the worker\'s own completion claim');
  assert.equal(origin?.resultStatus, 'completed');

  // Nothing self-drives the pause: no gate dispatch, no second turn, no kill.
  const workerLog = coordinator._log.read(handle.id);
  assert.equal(workerLog.some((event) => event.kind === 'verify.reverified'), false,
    'the trust gate is not dispatched at a checkpoint');
  assert.equal(child.written.filter((frame) => frame.type === 'prompt').length, 1,
    'the coordinator sends no continuation prompt at a checkpoint');
  assert.equal(coordinator._workers.get(handle.id)?.status === 'dead', false, 'the member is not killed');

  await coordinator.kill(handle.id, 'test');
});
