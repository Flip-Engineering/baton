import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  validateApplicationCommandArgs,
} from '../src/application.mjs';

const principal = Object.freeze({ actor: 'operator', principalId: 'operator', sessionId: 'phase67' });

function fixture({ cursor = 7, phase = 'executing', authorize = async () => true, waitAfter } = {}) {
  let viewCursor = cursor;
  let viewPhase = phase;
  const events = [];
  const current = {
    goal: { runId: 'run-change-aware', digest: 'a'.repeat(64) },
    plan: null,
    approval: null,
    profile: {
      risk: 'low',
      followPolicy: { mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8, maxResponseBytes: 64 * 1024, maxScanEvents: 32 },
    },
  };
  const app = Object.create(BatonApplication.prototype);
  Object.assign(app, {
    ready: Promise.resolve(),
    principals: { observer: principal },
    authorize,
    repoId: 'repo-phase67',
    _closed: null,
    _detached: false,
    _followControllers: new Set(),
    _runDeliveryRegistrations: new Map(),
    _semanticActions: () => [],
    _findRun: () => current,
    _buildView: async () => ({
      cursor: viewCursor, phase: viewPhase, narrative: 'bounded', progress: {}, attention: [],
      route: null, budget: null, ownership: { workers: 0 }, stop: null,
    }),
    driver: {
      coordination: {
        waitAfter: waitAfter ?? (async () => ({ advanced: false, upperBound: viewCursor })),
        events: (fromCursor, limit) => events.filter((event) => event.seq >= fromCursor).slice(0, limit),
        task: () => null,
      },
      drainAndClose: async () => ({ state: 'closed' }),
    },
  });
  return {
    app,
    current,
    advance(next = viewCursor + 1, event = { kind: 'run.result_selected', payload: { runId: current.goal.runId } }) {
      viewCursor = next;
      events.push({ seq: next, ...event });
    },
    terminal(next = 'completed') { viewPhase = next; },
  };
}

test('inspect schema accepts its numeric cursor and requires the cursor/wait pair', () => {
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].inputSchema.properties.cursor.type, 'integer');
  assert.throws(
    () => validateApplicationCommandArgs('run.inspect', { runId: 'run-change-aware', waitMs: 10 }),
    { code: 'application_inspect_cursor_wait_invalid' },
  );
  assert.throws(
    () => validateApplicationCommandArgs('run.inspect', { runId: 'run-change-aware', cursor: 1 }),
    { code: 'application_inspect_cursor_wait_invalid' },
  );
});

test('inspect waits once on durable notification and returns changed bounded outline', async () => {
  let calls = 0;
  let harness;
  harness = fixture({ waitAfter: async (afterCursor) => {
    calls += 1;
    assert.equal(afterCursor, 7);
    harness.advance();
    return { advanced: true, upperBound: 8 };
  } });
  const first = await harness.app.inspect({ runId: 'run-change-aware' }, principal);
  const result = await harness.app.inspect({ runId: 'run-change-aware', cursor: first.cursor, waitMs: 100 }, principal);
  assert.equal(calls, 1);
  assert.equal(result.cursor, 8);
  assert.equal(result.changed, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.terminal, false);
  assert.equal(JSON.stringify(result).includes('workerIds'), false);
});

test('inspect waits through another Run notification until this Run durably changes', async () => {
  let calls = 0;
  let harness;
  harness = fixture({ waitAfter: async (afterCursor) => {
    calls += 1;
    if (calls <= 2) {
      const next = 7 + calls;
      assert.equal(afterCursor, next - 1);
      harness.advance(next, { kind: 'run.result_selected', payload: { runId: `run-unrelated-${calls}` } });
      return { advanced: true, upperBound: next };
    }
    assert.equal(afterCursor, 9);
    harness.advance(10);
    return { advanced: true, upperBound: 10 };
  } });
  const result = await harness.app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 100 }, principal);
  assert.equal(calls, 3);
  assert.equal(result.cursor, 10);
  assert.equal(result.changed, true);
  assert.equal(result.timedOut, false);
});

test('inspect marks timeout and returns terminal state immediately', async () => {
  let calls = 0;
  const harness = fixture({ waitAfter: async () => { calls += 1; return { advanced: false, upperBound: 7 }; } });
  const timeout = await harness.app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 10 }, principal);
  assert.equal(timeout.timedOut, true);
  harness.terminal();
  const terminal = await harness.app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 10 }, principal);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.timedOut, false);
  assert.equal(calls, 1);
});

test('inspect rejects cursor-ahead and deployment-bound requests with typed errors', async () => {
  const { app } = fixture();
  await assert.rejects(app.inspect({ runId: 'run-change-aware', cursor: 8, waitMs: 10 }, principal), {
    code: 'application_inspect_cursor_ahead',
  });
  await assert.rejects(app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 1_001 }, principal), {
    code: 'application_inspect_policy_violation',
  });
});

test('inspect reauthorizes after wait and observes revocation', async () => {
  let authorizations = 0;
  const { app } = fixture({ authorize: async () => { authorizations += 1; return authorizations === 1; } });
  await assert.rejects(app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 10 }, principal), {
    code: 'application_unauthorized',
  });
  assert.equal(authorizations, 2);
});

test('application shutdown cancels an outstanding inspect wait', async () => {
  const waitAfter = (_cursor, _waitMs, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'coordination_wait_aborted' })), { once: true });
  });
  const { app } = fixture({ waitAfter });
  const waiting = app.inspect({ runId: 'run-change-aware', cursor: 7, waitMs: 1_000 }, principal);
  const cancelled = assert.rejects(waiting, { code: 'application_inspect_cancelled' });
  await Promise.resolve();
  await Promise.resolve();
  await app.shutdown(principal);
  await cancelled;
});
