// 2026-09-14 audit — the two member-boundary wedges (swarm-a/lead.md findings 4 and 8, each
// reproduced against the live harness by the `giants` worker):
//
//   8. question.asked / approval.requested read `payload?.requestId` with NO type check (the
//      decision branch one case later does check), so one malformed adapter frame parks the worker
//      `blocked` and the task `input_required` under the map key `undefined`; claimInteraction /
//      interactionStatus refuse it, the stop path's resolver is truthiness-gated on a handle field
//      that frame never wrote, and closeAuthority() then refuses. One untrusted frame produced a
//      task no one could answer, stop cleanly, or drain.
//   4. A pause record stuck in 'resolving' hangs every later turn on it, forever, invisibly: the
//      reservation is released only by rollback()/commit(), with no finally, so any throw between
//      them strands it — and `pausedTurns()` filters on `state === 'pending'`, so the projection
//      that is supposed to make the park visible skips exactly the wedged row.
//
// Red-first: every RED row fails at a NAMED stage against the PRE-implementation tree; every PIN
// row is green today AND under the correct implementation, but fails a plausible WRONG one.
// Hermetic: mock adapter, tmp dirs, test.after cleanup, no network, microtask drains only (no row
// asserts a wall-clock behavior of the fleet).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const SHA = 'a'.repeat(40);

async function flush(times = 60) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-wedge-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const prompts = [];
  let emit = null;
  const adapter = {
    card: () => ({
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000, turnCompletion: 'pausable',
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
    }),
    onEvent(callback) { emit = callback; },
    async spawn() { return { ok: true }; },
    async prompt(worker, content, mode) { prompts.push({ worker, content, mode }); return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
    async kill() { return { ok: true }; },
  };
  const log = new Log(join(directory, 'log'));
  const pins = new Map();
  const worktrees = {
    async create(id) { return { path: `/owned/${id}`, baseSha: SHA, branch: `baton/${id}` }; },
    async capture() { return { sha: SHA, baseSha: SHA, changedPaths: ['change.mjs'] }; },
    async retainCheckpoint(sha) { const ref = `refs/baton/checkpoints/${sha}`; pins.set(ref, sha); return ref; },
    async resolveCheckpoint(ref) { return pins.get(ref); },
    async createVerifyWorktree(id) { return { path: `/check/${id}` }; },
    async createBaseVerifyWorktree(id) { return { path: `/base/${id}` }; },
    async removeVerifyWorktree() {},
    async remove() {},
    async reconcile() {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: async () => ({ reverified: true, observedExit: 0, passed: true, matchesClaim: true, locus: 'fresh_sandbox' }),
    route: () => 'mock',
    now: () => 0,
  });
  return { coordinator, log, prompts, adapter, emit: (event) => emit(event) };
}

async function spawnMember(coordinator) {
  const handle = await coordinator.spawn('mock', {
    goal: 'Carry the member through a checkpoint', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the member reports a checkpoint',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  });
  return handle;
}

/** Park the member on a real checkpoint: a `pausable` card's completed turn is a pause, not a claim. */
async function checkpoint(coordinator, emit, handle) {
  emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'Checkpoint reached; awaiting the orchestrator.' },
  });
  await flush();
  const pause = coordinator.pausedTurns({ workerId: handle.id })[0];
  assert.ok(pause, 'fixture check: the pausable completion minted a pause record');
  return pause;
}

function askQuestion(adapter, emit, handle, payloadWith) {
  emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: payloadWith,
  });
}

// ===========================================================================
// Finding 8 — malformed interaction frames refuse at the boundary
// ===========================================================================

test('SW8 (RED): a question.asked frame without a well-formed requestId refuses typed — never parked under undefined', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  askQuestion(f.adapter, f.emit, handle, { question: 'which branch?', blocking: true });
  await flush();

  assert.equal(f.coordinator._pending.has(undefined), false,
    'stage[interaction-id-unvalidated]: no pending record is parked under the key `undefined`');
  assert.equal([...f.coordinator._pending.keys()].some((key) => typeof key !== 'string'), false,
    'every pending key is a string requestId');
  assert.notEqual(f.coordinator._tasks.get(handle.taskId).status, 'input_required',
    'a malformed frame never parks the task in input_required');
  assert.notEqual(f.coordinator._workers.get(handle.id).status, 'blocked',
    'a malformed frame never blocks the worker');
  const rejected = f.log.read(handle.id).filter((event) => event.kind === 'control.malformed_interaction_rejected');
  assert.equal(rejected.length, 1,
    'stage[interaction-id-unvalidated]: the refusal is durable and typed');
  assert.equal(rejected[0].payload.kind, 'question', 'the refusal names the family it refused');
  assert.equal(rejected[0].payload.reason, 'malformed_request_id', 'and the reason it refused on');
  // The stop path stays usable: nothing was parked, so nothing blocks a clean stop.
  assert.equal(f.coordinator._hasPendingInteractionAuthority(), false,
    'no interaction authority was minted for the malformed frame');
});

test('SW8 (RED): an approval.requested frame with a non-string requestId refuses typed — never parked', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  for (const bad of [7, '', null, { nested: true }]) {
    f.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'approval.requested', actor: 'worker',
      payload: { requestId: bad, kind: 'command', blocking: true },
    });
  }
  await flush();

  assert.equal(f.coordinator._pending.size, 0, 'no pending record exists for any malformed frame');
  assert.equal(f.coordinator._hasPendingInteractionAuthority(), false, 'no interaction authority was minted');
  assert.notEqual(f.coordinator._tasks.get(handle.taskId).status, 'input_required', 'the task is never parked');
  assert.notEqual(f.coordinator._workers.get(handle.id).status, 'blocked', 'the worker is never blocked');
  const rejected = f.log.read(handle.id).filter((event) => event.kind === 'control.malformed_interaction_rejected');
  assert.equal(rejected.length, 4, 'stage[interaction-id-unvalidated]: every malformed frame is refused by name');
  assert.ok(rejected.every((event) => event.payload.kind === 'approval' && event.payload.reason === 'malformed_request_id'));

  // The well-formed sibling frame still lands: the boundary refuses the shape, not the family.
  f.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'approval.requested', actor: 'worker',
    payload: { requestId: 'ap:ok', kind: 'command', blocking: true },
  });
  await flush();
  assert.ok(f.coordinator._pending.has('ap:ok'), 'PIN: a well-formed approval still parks normally');
  assert.equal(f.coordinator._workers.get(handle.id).status, 'blocked');
});

test('SW8 (RED): the stop resolver is key-based — a restored pending interaction is still resolvable', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  askQuestion(f.adapter, f.emit, handle, { requestId: 'q:stop', question: 'proceed?', blocking: true });
  await flush();
  const raw = f.coordinator._workers.get(handle.id);
  assert.equal(raw.status, 'blocked', 'fixture check: the blocking question parked the worker');
  // The replay-shaped handle: durable replay restores `_pending` from the ledger and deliberately
  // resets the handle's pending*Id caches to null (a durable reference is not a live transport).
  raw.pendingQuestionId = null;
  raw.pendingApprovalId = null;
  raw.pendingDecisionId = null;

  const resolved = await f.coordinator.prepareSemanticInterrupt(handle.id);
  assert.equal(resolved.ok, true,
    'stage[stop-resolver-truthiness]: the resolver reads the pending map KEY, never the truthiness of a handle field');
  assert.equal(resolved.result, 'interaction_superseded');
  assert.equal(raw.status, 'working', 'the worker is released to working');
  assert.equal(f.coordinator._pending.get('q:stop')?.state, 'resolved',
    'the named record is settled by its own key');
  assert.equal(f.coordinator._hasPendingInteractionAuthority(), false, 'the stop released the interaction authority');
});

// ===========================================================================
// Finding 4 — a pause record can never stay 'resolving'
// ===========================================================================

test('SW4 (RED): a throw between the reservation and the commit re-settles the pause record', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  const pause = await checkpoint(f.coordinator, f.emit, handle);
  const record = f.coordinator._pausedTurns.get(pause.pauseId);

  // A poisoned durable write between the reservation and the commit (the audit's exact class: any
  // throw after `_reservePauseRecord` and before `commit`).
  const append = f.coordinator._log.append;
  let poisoned = true;
  f.coordinator._log.append = (partial) => {
    if (poisoned && partial.kind === 'turn.settled') {
      poisoned = false;
      throw Object.assign(new Error('the operational log refused the append'), { code: 'log_append_refused' });
    }
    return append(partial);
  };
  await assert.rejects(f.coordinator.nudgeTurn(pause.pauseId, 'continue the work'), /refused the append/u,
    'the act fails loudly — the append really was refused');
  f.coordinator._log.append = append;

  assert.equal(record.state, 'pending',
    'stage[pause-resolving-stranded]: every exit releases the reservation — the record is never left wedged');
  assert.equal(record.resolvingDone, undefined, 'the resolving gate is released on the failure path');
  assert.equal(f.coordinator.pausedTurns({ workerId: handle.id })[0]?.state, 'pending',
    'the projection still offers the checkpoint — the park survived the failed act');

  // The next act is not hung by the stranded reservation (a wedged-resolving impl times out here).
  const second = await Promise.race([
    f.coordinator.nudgeTurn(pause.pauseId, 'continue the work'),
    new Promise((resolve) => { setTimeout(() => resolve({ ok: false, result: '__wedged__' }), 1000).unref?.(); }),
  ]);
  assert.notEqual(second.result, '__wedged__',
    'stage[pause-resolving-stranded]: the released reservation lets a later act re-enter');
  assert.equal(second.ok, true);
  assert.equal(f.coordinator._tasks.get(handle.taskId).status, 'working');
});

test('SW4 (PIN): the claim act releases its reservation on a thrown gate too (the shared settle path)', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  const pause = await checkpoint(f.coordinator, f.emit, handle);
  const record = f.coordinator._pausedTurns.get(pause.pauseId);
  const gate = f.coordinator._runTrustGate;
  f.coordinator._runTrustGate = async () => { throw Object.assign(new Error('gate exploded'), { code: 'trust_gate_failed' }); };
  await assert.rejects(f.coordinator.claimTurn(pause.pauseId, { actor: 'orchestrator' }), /gate exploded/u);
  f.coordinator._runTrustGate = gate;
  assert.equal(record.state, 'pending', 'PIN: the claim reservation is released on a thrown gate');
  assert.equal(record.resolvingDone, undefined, 'PIN: no resolving gate survives the throw');
});

test('SW4 (RED): pausedTurns() never hides a wedged row — the projected state IS the record state', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  const pause = await checkpoint(f.coordinator, f.emit, handle);
  const record = f.coordinator._pausedTurns.get(pause.pauseId);
  record.state = 'resolving';
  record.consumer = 'orchestrator';
  record.resolvingDone = new Promise(() => {});

  const rows = f.coordinator.pausedTurns({ workerId: handle.id });
  assert.equal(rows.length, 1,
    'stage[pausedTurns-hides-wedged]: the authoritative layer says wedged — the projection must not say fine');
  assert.equal(rows[0].state, 'resolving', 'the wedged row reads its own state');
  assert.equal(rows[0].consumer, 'orchestrator', 'and who holds it');
  assert.equal(f.coordinator.pausedTurnStatus(pause.pauseId).state, 'resolving');

  // Only a CONSUMED record leaves the projection.
  record.state = 'resolved';
  record.consumer = null;
  assert.equal(f.coordinator.pausedTurns({ workerId: handle.id }).length, 0,
    'a consumed record is not a park');
});

test('SW4 (RED): a plain turn send to a paused member is gated on the pause — no orphaned pause record', async (t) => {
  const f = fixture(t);
  const handle = await spawnMember(f.coordinator);
  await checkpoint(f.coordinator, f.emit, handle);
  const sent = await f.coordinator.send(handle.id, 'Carry on with the next slice.', 'turn');

  assert.deepEqual(f.prompts.map((entry) => entry.mode), ['turn'], 'the continuation is a real turn');
  assert.equal(f.coordinator.pausedTurns({ workerId: handle.id }).length, 0,
    'stage[pause-orphaned-by-turn]: the pause is consumed by the turn that resumed it, never orphaned');
  const settled = f.log.read(handle.id).filter((event) => event.kind === 'turn.settled').at(-1);
  assert.equal(settled?.payload?.basis, 'nudge', 'the pause is settled by the turn that consumed it');
  assert.equal(f.coordinator._tasks.get(handle.taskId).status, 'working', 'the member is working again');
});
