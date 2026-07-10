import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND,
  DEFAULT_STALL_MS,
  DEFAULT_LOOP_REPEAT_THRESHOLD,
  BUDGET_THRESHOLDS,
  MAX_ACTION_SIGNATURE_WINDOW,
  initialState,
  foldEvent,
  renderNarrative,
  computeSignals,
  pathScopeCollisions,
  StoryCompiler,
} from '../src/story.mjs';

// ---------------------------------------------------------------------------
// Event fixture helpers — deterministic, no wall clock, incrementing seq.
// ---------------------------------------------------------------------------

const BASE_TS = Date.parse('2026-01-01T00:00:00.000Z');

/** Builds an ISO timestamp offset from BASE_TS by `ms` milliseconds. */
function tsAt(ms) {
  return new Date(BASE_TS + ms).toISOString();
}

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing',
    constraints: [],
    pathScope: { include: ['src/auth/**'], exclude: [] },
    tools: ['bash', 'edit'],
    outputFormat: 'diff',
    definitionOfDone: 'tests pass',
    verification: { command: 'npm test', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMinutes: 30 },
    ...overrides,
  };
}

/**
 * A small per-worker sequence allocator so tests can build ordered event
 * streams without manually tracking seq numbers.
 */
function makeSeqAllocator() {
  const counters = new Map();
  return (worker, seq) => {
    if (seq !== undefined) {
      counters.set(worker, seq);
      return seq;
    }
    const next = (counters.get(worker) ?? 0) + 1;
    counters.set(worker, next);
    return next;
  };
}

function ev({ worker, kind, seq, tsMs, turnEpoch = 1, actor = 'worker', payload = {}, emulated }) {
  const e = {
    seq,
    ts: tsAt(tsMs ?? 0),
    worker,
    harness: 'mock@1.0.0',
    turnEpoch,
    kind,
    actor,
    payload,
  };
  if (emulated !== undefined) e.emulated = emulated;
  return e;
}

// ===========================================================================
// 1. SPAWNED
// ===========================================================================

test('SPAWNED creates a WorkerStory with status:idle, capturing brief/taskId from payload', () => {
  let state = initialState();
  const brief = makeBrief();
  state = foldEvent(
    state,
    ev({
      worker: 'w1',
      kind: KIND.SPAWNED,
      seq: 1,
      tsMs: 0,
      turnEpoch: 0,
      actor: 'orchestrator',
      payload: { taskId: 't1', brief },
    })
  );
  const w1 = state.workers.get('w1');
  assert.equal(w1.status, 'idle');
  assert.equal(w1.taskId, 't1');
  assert.deepEqual(w1.brief, brief);
});

// ===========================================================================
// 2. TURN_STARTED
// ===========================================================================

test('TURN_STARTED after idle sets status:working, increments turnCount, resets recentActionSignatures', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  let w1 = state.workers.get('w1');
  assert.equal(w1.status, 'working');
  assert.equal(w1.turnCount, 1);

  // Simulate a failing command action then a second turn boundary.
  state = foldEvent(
    state,
    ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 3, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } })
  );
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 4, turnEpoch: 2, actor: 'orchestrator', payload: {} }));
  w1 = state.workers.get('w1');
  assert.equal(w1.turnCount, 2);
  assert.deepEqual(w1.recentActionSignatures, []);
});

// ===========================================================================
// 3. interrupt lifecycle
// ===========================================================================

test('INTERRUPT_REQUESTED while working sets stopping; INTERRUPT_CONFIRMED sets idle', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.INTERRUPT_REQUESTED, seq: 3, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  assert.equal(state.workers.get('w1').status, 'stopping');
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.INTERRUPT_CONFIRMED, seq: 4, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  assert.equal(state.workers.get('w1').status, 'idle');
});

test('a worker that receives INTERRUPT_REQUESTED but never INTERRUPT_CONFIRMED stays stopping forever', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.INTERRUPT_REQUESTED, seq: 3, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  // Nothing further arrives.
  assert.equal(state.workers.get('w1').status, 'stopping');
});

// ===========================================================================
// 4. approvals
// ===========================================================================

test('APPROVAL_REQUESTED sets blocked and adds to approvalsPending; APPROVAL_RESOLVED clears and reverts to working only once all approvals cleared', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.APPROVAL_REQUESTED, seq: 3, turnEpoch: 1, payload: { id: 'a1', kind: 'file_write' } }));
  let w1 = state.workers.get('w1');
  assert.equal(w1.status, 'blocked');
  assert.equal(w1.approvalsPending.length, 1);

  // A second concurrent approval request.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.APPROVAL_REQUESTED, seq: 4, turnEpoch: 1, payload: { id: 'a2', kind: 'shell_exec' } }));
  w1 = state.workers.get('w1');
  assert.equal(w1.approvalsPending.length, 2);

  // Resolving one of two leaves the worker blocked.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.APPROVAL_RESOLVED, seq: 5, turnEpoch: 1, payload: { id: 'a1' } }));
  w1 = state.workers.get('w1');
  assert.equal(w1.status, 'blocked');
  assert.equal(w1.approvalsPending.length, 1);

  // Resolving the last one reverts to working.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.APPROVAL_RESOLVED, seq: 6, turnEpoch: 1, payload: { id: 'a2' } }));
  w1 = state.workers.get('w1');
  assert.equal(w1.status, 'working');
  assert.equal(w1.approvalsPending.length, 0);
});

// ===========================================================================
// 5. questions
// ===========================================================================

test('QUESTION_ASKED sets input_required and pushes to questionsPending; QUESTION_ANSWERED clears and reverts to working', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.QUESTION_ASKED, seq: 3, turnEpoch: 1, payload: { msgId: 'q1', question: 'proceed?' } }));
  let w1 = state.workers.get('w1');
  assert.equal(w1.status, 'input_required');
  assert.equal(w1.questionsPending.length, 1);

  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.QUESTION_ANSWERED, seq: 4, turnEpoch: 1, payload: { msgId: 'q1' } }));
  w1 = state.workers.get('w1');
  assert.equal(w1.status, 'working');
  assert.equal(w1.questionsPending.length, 0);
});

// ===========================================================================
// 6/8. idempotency / duplicate & stale seq handling
// ===========================================================================

test('ingesting the identical event object twice (same worker+seq) leaves the snapshot unchanged after the second call', () => {
  let state = initialState();
  const e1 = ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } });
  state = foldEvent(state, e1);
  const afterFirst = JSON.stringify(Array.from(state.workers.entries()), replacer);
  state = foldEvent(state, e1);
  const afterSecond = JSON.stringify(Array.from(state.workers.entries()), replacer);
  assert.equal(afterFirst, afterSecond);
});

test('an event with seq less than or equal to lastEventSeq is dropped even if content differs', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  const beforeStatus = state.workers.get('w1').status;
  // A stale, differently-shaped event at an already-seen seq must be dropped.
  state = foldEvent(
    state,
    ev({ worker: 'w1', kind: KIND.INTERRUPT_REQUESTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} })
  );
  assert.equal(state.workers.get('w1').status, beforeStatus);
});

// ===========================================================================
// 7. seq gap detection
// ===========================================================================

test('seq=1 then seq=5 for a worker (skipping 2-4) sets sawGap:true; signals() includes a log_gap entry', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 5, turnEpoch: 1, payload: { tokens: 10, usd: 0.001 } }));
  const w1 = state.workers.get('w1');
  assert.equal(w1.sawGap, true);
  const signals = computeSignals(state, { now: BASE_TS });
  assert.ok(signals.some((s) => s.type === 'log_gap' && s.worker === 'w1'));
});

// ===========================================================================
// 9. budget thresholds
// ===========================================================================

test('TOKENS events accumulate budgetUsed; crossing 50/80/100% fires over_budget once per threshold, no dupes', () => {
  let state = initialState();
  state = foldEvent(
    state,
    ev({
      worker: 'w1',
      kind: KIND.SPAWNED,
      seq: 1,
      turnEpoch: 0,
      actor: 'orchestrator',
      payload: { taskId: 't1', brief: makeBrief({ budget: { tokens: 1000, usd: 1, wallMinutes: 30 } }) },
    })
  );
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));

  // 40% — no threshold crossed yet.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 3, turnEpoch: 1, payload: { tokens: 400, usd: 0.4 } }));
  let signals = computeSignals(state, { now: BASE_TS });
  assert.ok(!signals.some((s) => s.type === 'over_budget'));

  // Cross 50%.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 4, turnEpoch: 1, payload: { tokens: 200, usd: 0.2 } }));
  signals = computeSignals(state, { now: BASE_TS });
  assert.equal(signals.filter((s) => s.type === 'over_budget' && s.worker === 'w1').length, 1);

  // Extra tokens that DON'T cross another threshold: still only 1 fired-threshold total.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 5, turnEpoch: 1, payload: { tokens: 10, usd: 0.01 } }));
  const w1 = state.workers.get('w1');
  assert.deepEqual([...w1.budgetThresholdsFired].sort(), [0.5]);

  // Cross 80% and 100% in two more steps.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 6, turnEpoch: 1, payload: { tokens: 250, usd: 0.25 } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TOKENS, seq: 7, turnEpoch: 1, payload: { tokens: 200, usd: 0.2 } }));
  const w1Final = state.workers.get('w1');
  assert.deepEqual([...w1Final.budgetThresholdsFired].sort(), [0.5, 0.8, 1.0]);
});

// ===========================================================================
// 10/11. looping
// ===========================================================================

test('three consecutive COMMAND_EXEC events with identical failing {cmd, exitCode!=0} trigger looping', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  for (let i = 0; i < 3; i++) {
    state = foldEvent(
      state,
      ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 3 + i, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } })
    );
  }
  const signals = computeSignals(state, { now: BASE_TS });
  assert.ok(signals.some((s) => s.type === 'looping' && s.worker === 'w1'));
});

test('three identical commands with a passing exit code in the middle do NOT trigger looping', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 3, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 4, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 0 } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 5, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } }));
  const signals = computeSignals(state, { now: BASE_TS });
  assert.ok(!signals.some((s) => s.type === 'looping' && s.worker === 'w1'));
});

test('TURN_STARTED resets the loop-detection window across a turn boundary', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  // 2 identical failures in turn 1.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 3, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 4, turnEpoch: 1, payload: { cmd: 'npm test', exitCode: 1 } }));
  // New turn boundary.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 5, turnEpoch: 2, actor: 'orchestrator', payload: {} }));
  // 1 identical failure in turn 2 — total would be 3 across turns, but window reset means no loop yet.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.COMMAND_EXEC, seq: 6, turnEpoch: 2, payload: { cmd: 'npm test', exitCode: 1 } }));
  const signals = computeSignals(state, { now: BASE_TS });
  assert.ok(!signals.some((s) => s.type === 'looping' && s.worker === 'w1'));
});

// ===========================================================================
// 12. out-of-scope edits
// ===========================================================================

test('a FILE_EDIT outside brief.pathScope.include produces out_of_scope; one inside does not', () => {
  let state = initialState();
  const brief = makeBrief({ pathScope: { include: ['src/auth/**'], exclude: [] } });
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));

  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.FILE_EDIT, seq: 3, turnEpoch: 1, payload: { path: 'src/payments/x.js' } }));
  let signals = computeSignals(state, { now: BASE_TS });
  assert.ok(signals.some((s) => s.type === 'out_of_scope' && s.worker === 'w1'));

  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.FILE_EDIT, seq: 4, turnEpoch: 1, payload: { path: 'src/auth/login.js' } }));
  const w1 = state.workers.get('w1');
  assert.ok(!w1.outOfScopePaths.has('src/auth/login.js'));
});

// ===========================================================================
// 13. stalled
// ===========================================================================

test('stalled = quiet too long per injected clock for a working worker; not asserted for blocked/input_required/stopping', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, tsMs: 0, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, tsMs: 0, turnEpoch: 1, actor: 'orchestrator', payload: {} }));

  const farFuture = BASE_TS + DEFAULT_STALL_MS + 1;
  let signals = computeSignals(state, { now: farFuture });
  assert.ok(signals.some((s) => s.type === 'stalled' && s.worker === 'w1'));

  // Not yet stalled before the threshold.
  const notYet = BASE_TS + DEFAULT_STALL_MS - 1;
  signals = computeSignals(state, { now: notYet });
  assert.ok(!signals.some((s) => s.type === 'stalled' && s.worker === 'w1'));

  // A blocked worker is legitimately waiting — never "stalled" even after a long quiet period.
  let blockedState = initialState();
  blockedState = foldEvent(blockedState, ev({ worker: 'w2', kind: KIND.SPAWNED, seq: 1, tsMs: 0, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't2', brief: makeBrief() } }));
  blockedState = foldEvent(blockedState, ev({ worker: 'w2', kind: KIND.TURN_STARTED, seq: 2, tsMs: 0, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  blockedState = foldEvent(blockedState, ev({ worker: 'w2', kind: KIND.APPROVAL_REQUESTED, seq: 3, tsMs: 0, turnEpoch: 1, payload: { id: 'a1', kind: 'x' } }));
  const blockedSignals = computeSignals(blockedState, { now: farFuture });
  assert.ok(!blockedSignals.some((s) => s.type === 'stalled' && s.worker === 'w2'));
});

// ===========================================================================
// 14. path scope collisions
// ===========================================================================

test('pathScopeCollisions() finds an entry when two working workers overlap pathScope.include and both edited the overlap', () => {
  let state = initialState();
  const briefA = makeBrief({ pathScope: { include: ['src/shared/**'], exclude: [] } });
  const briefB = makeBrief({ pathScope: { include: ['src/shared/**'], exclude: [] } });

  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: briefA } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.FILE_EDIT, seq: 3, turnEpoch: 1, payload: { path: 'src/shared/util.js' } }));

  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't2', brief: briefB } }));
  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.FILE_EDIT, seq: 3, turnEpoch: 1, payload: { path: 'src/shared/util.js' } }));

  const collisions = pathScopeCollisions(state);
  assert.ok(collisions.some((c) => c.type === 'path_scope_collision'));
});

test('pathScopeCollisions() finds nothing when scopes do not overlap', () => {
  let state = initialState();
  const briefA = makeBrief({ pathScope: { include: ['src/a/**'], exclude: [] } });
  const briefB = makeBrief({ pathScope: { include: ['src/b/**'], exclude: [] } });

  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: briefA } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.FILE_EDIT, seq: 3, turnEpoch: 1, payload: { path: 'src/a/x.js' } }));

  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't2', brief: briefB } }));
  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.FILE_EDIT, seq: 3, turnEpoch: 1, payload: { path: 'src/b/x.js' } }));

  assert.deepEqual(pathScopeCollisions(state), []);
});

// ===========================================================================
// 15/16. narrative determinism & ordering
// ===========================================================================

test('narrative() is a pure function of state: called twice with no new ingests, returns byte-identical strings', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  const s1 = renderNarrative(state, { now: BASE_TS });
  const s2 = renderNarrative(state, { now: BASE_TS });
  assert.equal(s1, s2);
});

test('same events -> same story: feeding the identical scripted event stream twice into fresh compilers yields identical narratives', () => {
  const events = [
    ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, tsMs: 0, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }),
    ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, tsMs: 100, turnEpoch: 1, actor: 'orchestrator', payload: {} }),
    ev({ worker: 'w1', kind: KIND.TOKENS, seq: 3, tsMs: 200, turnEpoch: 1, payload: { tokens: 600, usd: 0.6 } }),
    ev({ worker: 'w1', kind: KIND.FILE_EDIT, seq: 4, tsMs: 300, turnEpoch: 1, payload: { path: 'src/auth/x.js' } }),
    ev({ worker: 'w1', kind: KIND.TURN_COMPLETED, seq: 5, tsMs: 400, turnEpoch: 1, actor: 'policy', payload: { status: 'completed' } }),
  ];

  const c1 = new StoryCompiler({ now: () => BASE_TS + 1000 });
  c1.ingestBatch(events);
  const n1 = c1.narrative({ now: BASE_TS + 1000 });

  const c2 = new StoryCompiler({ now: () => BASE_TS + 1000 });
  c2.ingestBatch(events);
  const n2 = c2.narrative({ now: BASE_TS + 1000 });

  assert.equal(n1, n2);
});

test('narrative() orders workers-with-warnings before workers-without, stable by ascending spawnedAtSeq within each group', () => {
  let state = initialState();
  // w1 spawns first, will stall.
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, tsMs: 0, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, tsMs: 0, turnEpoch: 1, actor: 'orchestrator', payload: {} }));

  // w2 spawns second, stays healthy (idle, no warnings).
  state = foldEvent(state, ev({ worker: 'w2', kind: KIND.SPAWNED, seq: 1, tsMs: 10, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't2', brief: makeBrief() } }));

  const farFuture = BASE_TS + DEFAULT_STALL_MS + 1;
  const narrative = renderNarrative(state, { now: farFuture });

  const w1Idx = narrative.indexOf('w1');
  const w2Idx = narrative.indexOf('w2');
  assert.ok(w1Idx >= 0 && w2Idx >= 0);
  assert.ok(w1Idx < w2Idx, 'worker with an active warning (w1, stalled) must render before a warning-free worker (w2)');
});

test('no workers renders "No workers active."', () => {
  const state = initialState();
  assert.equal(renderNarrative(state, { now: BASE_TS }), 'No workers active.');
});

// ===========================================================================
// 17. reset
// ===========================================================================

test('StoryCompiler.reset() returns the compiler to initialState()', () => {
  const compiler = new StoryCompiler({ now: () => BASE_TS });
  compiler.ingest(ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  assert.ok(compiler.workerState('w1') !== null);
  compiler.reset();
  assert.equal(compiler.workerState('w1'), null);
  assert.equal(compiler.narrative({ now: BASE_TS }), 'No workers active.');
});

// ===========================================================================
// 18. unknown kinds
// ===========================================================================

test('an unrecognized kind does not throw and updates only lastEventSeq/lastEventTs bookkeeping', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  const before = state.workers.get('w1');
  assert.doesNotThrow(() => {
    state = foldEvent(state, ev({ worker: 'w1', kind: 'totally.unknown.kind', seq: 2, tsMs: 500, turnEpoch: 1, payload: { whatever: true } }));
  });
  const after = state.workers.get('w1');
  assert.equal(after.lastEventSeq, 2);
  assert.equal(after.lastEventTs, tsAt(500));
  // Status/taskId/brief untouched by the unknown kind.
  assert.equal(after.status, before.status);
  assert.equal(after.taskId, before.taskId);
});

// ===========================================================================
// 19. exited/crashed
// ===========================================================================

test('EXITED sets status:exited from any prior state, including mid-turn', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.EXITED, seq: 3, turnEpoch: 1, payload: {} }));
  assert.equal(state.workers.get('w1').status, 'exited');
});

test('CRASHED sets status:exited even while blocked', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.APPROVAL_REQUESTED, seq: 3, turnEpoch: 1, payload: { id: 'a1', kind: 'x' } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.CRASHED, seq: 4, turnEpoch: 1, payload: { reason: 'oom' } }));
  assert.equal(state.workers.get('w1').status, 'exited');
});

// ===========================================================================
// StoryCompiler class wiring sanity
// ===========================================================================

test('StoryCompiler.ingestBatch is equivalent to sequential ingest() calls', () => {
  const events = [
    ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, tsMs: 0, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }),
    ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, tsMs: 10, turnEpoch: 1, actor: 'orchestrator', payload: {} }),
  ];
  const c1 = new StoryCompiler({ now: () => BASE_TS });
  for (const e of events) c1.ingest(e);

  const c2 = new StoryCompiler({ now: () => BASE_TS });
  c2.ingestBatch(events);

  assert.deepEqual(c1.snapshot(), c2.snapshot());
});

test('StoryCompiler.snapshot() returns a plain deep-copy, not the live Map', () => {
  const compiler = new StoryCompiler({ now: () => BASE_TS });
  compiler.ingest(ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  const snap = compiler.snapshot();
  assert.ok(!(snap instanceof Map));
  // Mutating the snapshot must not affect the compiler's live state.
  if (snap.workers && snap.workers.w1) {
    snap.workers.w1.status = 'exited';
  }
  assert.notEqual(compiler.workerState('w1').status, 'exited');
});

test('renderNarrative/computeSignals never mutate the StoryState passed to them', () => {
  let state = initialState();
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.SPAWNED, seq: 1, turnEpoch: 0, actor: 'orchestrator', payload: { taskId: 't1', brief: makeBrief() } }));
  state = foldEvent(state, ev({ worker: 'w1', kind: KIND.TURN_STARTED, seq: 2, turnEpoch: 1, actor: 'orchestrator', payload: {} }));
  const before = JSON.stringify(Array.from(state.workers.entries()), replacer);
  renderNarrative(state, { now: BASE_TS });
  computeSignals(state, { now: BASE_TS });
  const after = JSON.stringify(Array.from(state.workers.entries()), replacer);
  assert.equal(before, after);
});

// Helper to JSON.stringify Maps/Sets deterministically for equality checks.
function replacer(_key, value) {
  if (value instanceof Set) return { __set: [...value].sort() };
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}
