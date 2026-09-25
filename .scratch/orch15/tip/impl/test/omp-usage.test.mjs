import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OmpTurnUsageAccumulator, OMP_TOKEN_METRIC } from '../src/omp-usage.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msgEnd(provider, model, { totalTokens, costTotal, stopReason = 'end_turn', role = 'assistant' } = {}) {
  const usage = {};
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (costTotal !== undefined) usage.cost = { total: costTotal };
  return {
    type: 'message_end',
    message: { role, provider, model, usage, stopReason },
  };
}

function msgStart() { return { type: 'message_start', message: { role: 'assistant' } }; }

function acc(worker = 'w', epoch = 1, gen = 1) {
  return new OmpTurnUsageAccumulator(worker, epoch, gen);
}

// ---------------------------------------------------------------------------
// API contract: consumeMessageEnd returns delta for that call
// ---------------------------------------------------------------------------

test('DELTA: consumeMessageEnd returns resourceTokens for the specific call, not an accumulation', () => {
  const a = acc('w', 1);
  const r1 = a.consumeMessageEnd(msgEnd('deepseek', 'deepseek-v4-flash', { totalTokens: 100, costTotal: 0.001 }));
  const r2 = a.consumeMessageEnd(msgEnd('deepseek', 'deepseek-v4-flash', { totalTokens: 200, costTotal: 0.002 }));

  assert.equal(r1.ok, true);
  assert.equal(r1.resourceTokens?.tokens, 100, 'first call returns 100, not accumulated total');
  assert.ok(Math.abs(r1.resourceTokens?.usd - 0.001) < 1e-12);

  assert.equal(r2.ok, true);
  assert.equal(r2.resourceTokens?.tokens, 200, 'second call returns 200, not 300');
  assert.ok(Math.abs(r2.resourceTokens?.usd - 0.002) < 1e-12);
});

test('DELTA: finalize returns null resourceTokens when message_end coverage exists', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 50 }));
  const { resourceTokens } = a.finalize();
  assert.equal(resourceTokens, null, 'deltas already emitted; finalize produces no additional delta');
});

test('DELTA: resourceTokens counterId is stable across all calls in the turn', () => {
  const a = new OmpTurnUsageAccumulator('myworker', 5, 2);
  const r1 = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10 }));
  const r2 = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 20 }));
  const expected = 'omp:myworker:5:2';
  assert.equal(r1.resourceTokens?.counterId, expected);
  assert.equal(r2.resourceTokens?.counterId, expected);
  assert.equal(a.finalize().seal?.counterId, expected);
});

// ---------------------------------------------------------------------------
// Role filtering
// ---------------------------------------------------------------------------

test('ROLE: user-role message_end is skipped (not an error)', () => {
  const a = acc();
  const userEvent = { type: 'message_end', message: { role: 'user', provider: 'p', model: 'm', usage: { totalTokens: 999 } } };
  const r = a.consumeMessageEnd(userEvent);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'non_assistant_role');
  assert.equal(r.resourceTokens, null);
  // messageEndCount only counts assistant-role events
  assert.equal(a.messageEndCount, 0);
});

test('ROLE: tool-role message is skipped, assistant-role counted and returned', () => {
  const a = acc();
  const toolEvent = { type: 'message_end', message: { role: 'tool', provider: 'p', model: 'm', usage: { totalTokens: 50 } } };
  a.consumeMessageEnd(toolEvent);
  assert.equal(a.messageEndCount, 0);

  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 80 }));
  assert.equal(a.messageEndCount, 1);
  assert.equal(r.resourceTokens?.tokens, 80);
});

test('ROLE: user messages in agent_end.messages are excluded from fallback', () => {
  const a = acc('fb', 3);
  const { resourceTokens } = a.finalize({
    isTerminal: true,
    terminalMessages: [
      { role: 'user', provider: 'p', model: 'm', usage: { totalTokens: 9999, cost: { total: 99.9 } } },
      { role: 'assistant', provider: 'deepseek', model: 'deepseek-v4-flash', usage: { totalTokens: 150, cost: { total: 0.001 } } },
    ],
  });
  assert.ok(resourceTokens !== null);
  assert.equal(resourceTokens.tokens, 150, 'only the assistant message counted');
  assert.ok(Math.abs(resourceTokens.usd - 0.001) < 1e-12);
});

// ---------------------------------------------------------------------------
// Identity: every call observed, not just first
// ---------------------------------------------------------------------------

test('IDENTITY: modelObserved returned per-call from consumeMessageEnd', () => {
  const a = acc();
  const r1 = a.consumeMessageEnd(msgEnd('deepseek', 'deepseek-v4-flash', { totalTokens: 10 }));
  const r2 = a.consumeMessageEnd(msgEnd('glm', 'glm-5.2', { totalTokens: 20 }));

  assert.equal(r1.modelObserved, 'deepseek/deepseek-v4-flash', 'first call identity');
  assert.equal(r2.modelObserved, 'glm/glm-5.2', 'second call — route change observed on this call');
});

test('IDENTITY: model already carrying provider prefix is not double-qualified', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('deepseek', 'deepseek/deepseek-v4-flash', { totalTokens: 5 }));
  assert.equal(r.modelObserved, 'deepseek/deepseek-v4-flash', 'no double-prefix');
});

test('IDENTITY: missing provider yields null modelObserved', () => {
  const a = acc();
  const r = a.consumeMessageEnd({ type: 'message_end', message: { role: 'assistant', model: 'flash', usage: {} } });
  assert.equal(r.modelObserved, null);
});

test('IDENTITY: missing model yields null modelObserved', () => {
  const a = acc();
  const r = a.consumeMessageEnd({ type: 'message_end', message: { role: 'assistant', provider: 'deepseek', usage: {} } });
  assert.equal(r.modelObserved, null);
});

// ---------------------------------------------------------------------------
// stopReason pass-through
// ---------------------------------------------------------------------------

test('STOPREASON: stopReason is returned on each consumeMessageEnd', () => {
  const a = acc();
  const r1 = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10, stopReason: 'end_turn' }));
  const r2 = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 20, stopReason: 'error' }));
  const r3 = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 30, stopReason: 'aborted' }));
  assert.equal(r1.stopReason, 'end_turn');
  assert.equal(r2.stopReason, 'error');
  assert.equal(r3.stopReason, 'aborted');
});

test('STOPREASON: missing stopReason yields null (not invented)', () => {
  const a = acc();
  const event = { type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm', usage: { totalTokens: 5 } } };
  const r = a.consumeMessageEnd(event);
  assert.equal(r.stopReason, null);
});

// ---------------------------------------------------------------------------
// Partial mutation: token failure does not suppress USD and vice versa
// ---------------------------------------------------------------------------

test('PARTIAL: absent totalTokens does not suppress valid cost.total', () => {
  const a = acc();
  const event = { type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm', usage: { cost: { total: 0.003 } } } };
  const r = a.consumeMessageEnd(event);
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r.resourceTokens, 'tokens'), false, 'tokens absent');
  assert.ok(Math.abs(r.resourceTokens.usd - 0.003) < 1e-12, 'USD still reported');
  assert.equal(r.resourceTokens.tokenMetric, undefined, 'no tokenMetric without tokens');
});

test('PARTIAL: absent cost.total does not suppress valid totalTokens', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 400 }));
  assert.equal(r.resourceTokens?.tokens, 400);
  assert.equal(Object.hasOwn(r.resourceTokens, 'usd'), false, 'USD absent');
});

test('PARTIAL: negative totalTokens (invalid) omitted; USD from same event still emitted', () => {
  const a = acc();
  const event = { type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm',
    usage: { totalTokens: -5, cost: { total: 0.001 } } } };
  const r = a.consumeMessageEnd(event);
  assert.equal(r.ok, true);
  assert.equal(Object.hasOwn(r.resourceTokens, 'tokens'), false, 'negative tokens omitted');
  assert.ok(Math.abs(r.resourceTokens.usd - 0.001) < 1e-12, 'USD still present');
});

test('PARTIAL: negative cost (invalid) omitted; tokens from same event still emitted', () => {
  const a = acc();
  const event = { type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm',
    usage: { totalTokens: 300, cost: { total: -0.001 } } } };
  const r = a.consumeMessageEnd(event);
  assert.equal(r.resourceTokens?.tokens, 300);
  assert.equal(Object.hasOwn(r.resourceTokens, 'usd'), false);
});

test('PARTIAL: both dimensions absent → no_usage code, null resourceTokens', () => {
  const a = acc();
  const r = a.consumeMessageEnd({ type: 'message_end', message: { role: 'assistant', provider: 'p', model: 'm', usage: {} } });
  assert.equal(r.ok, true);
  assert.equal(r.code, 'no_usage');
  assert.equal(r.resourceTokens, null);
});

// ---------------------------------------------------------------------------
// Seal: tokens with no USD must never set tokenMetric to null when tokens=reported
// ---------------------------------------------------------------------------

test('SEAL: tokens reported → tokenMetric is OMP_TOKEN_METRIC', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10 }));
  const { seal } = a.finalize();
  assert.equal(seal.tokens, 'reported');
  assert.equal(seal.tokenMetric, OMP_TOKEN_METRIC);
});

test('SEAL: USD only → tokenMetric is null in seal', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', { costTotal: 0.001 }));
  const { seal } = a.finalize();
  assert.equal(seal.tokens, 'unavailable');
  assert.equal(seal.tokenMetric, null);
  assert.equal(seal.usd, 'reported');
  assert.equal(seal.counterId, 'omp:w:1:1');
});

test('SEAL: nothing reported → unavailable seal with null counterId', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', {})); // no usage
  const { seal } = a.finalize();
  assert.deepEqual(seal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
});

test('SEAL: counterId is null when no events at all', () => {
  const { seal } = acc().finalize();
  assert.equal(seal.counterId, null);
});

// ---------------------------------------------------------------------------
// snapshot() — usable on crash / interrupt boundary
// ---------------------------------------------------------------------------

test('SNAPSHOT: reflects what has been reported so far via consumeMessageEnd', () => {
  const a = acc('snap', 7, 3);
  assert.deepEqual(a.snapshot().seal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
    'no events yet');

  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10 }));
  const s1 = a.snapshot().seal;
  assert.equal(s1.tokens, 'reported');
  assert.equal(s1.usd, 'unavailable');
  assert.equal(s1.counterId, 'omp:snap:7:3');

  a.consumeMessageEnd(msgEnd('p', 'm', { costTotal: 0.002 }));
  const s2 = a.snapshot().seal;
  assert.equal(s2.tokens, 'unavailable', 'partial token reporting cannot certify the full turn');
  assert.equal(s2.usd, 'unavailable', 'known individual costs survive, but the full-turn seal is incomplete');
});

test('SNAPSHOT: callable after finalize without throwing', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 5 }));
  a.finalize();
  // finalize sets #finalized but snapshot reads #any* flags which were set before finalize
  // snapshot() is read-only; it does not throw for a finalized accumulator
  assert.doesNotThrow(() => a.snapshot());
});

// ---------------------------------------------------------------------------
// Non-terminal agent_end must not seal
// ---------------------------------------------------------------------------

test('NON-TERMINAL: isTerminal===false returns null seal and null resourceTokens', () => {
  const a = acc();
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 100 }));
  const result = a.finalize({ isTerminal: false });
  assert.equal(result.resourceTokens, null);
  assert.equal(result.seal, null, 'no terminal seal for non-terminal agent_end');
});

// ---------------------------------------------------------------------------
// agent_end.messages fallback
// ---------------------------------------------------------------------------

test('MESSAGES FALLBACK: used when zero message_end coverage', () => {
  const a = acc('fb', 1);
  const { resourceTokens, seal, modelObserved } = a.finalize({
    isTerminal: true,
    terminalMessages: [
      { role: 'assistant', provider: 'deepseek', model: 'deepseek-v4-flash',
        usage: { totalTokens: 250, cost: { total: 0.002 } }, stopReason: 'end_turn' },
    ],
  });

  assert.ok(resourceTokens !== null);
  assert.equal(resourceTokens.source, 'agent_end_messages');
  assert.equal(resourceTokens.tokens, 250);
  assert.ok(Math.abs(resourceTokens.usd - 0.002) < 1e-12);
  assert.equal(resourceTokens.tokenMetric, OMP_TOKEN_METRIC);
  assert.equal(resourceTokens.counterId, 'omp:fb:1:1');
  assert.equal(seal.tokens, 'reported');
  assert.equal(seal.usd, 'reported');
  assert.equal(modelObserved, 'deepseek/deepseek-v4-flash');
});

test('MESSAGES FALLBACK: multiple assistant messages are summed', () => {
  const a = acc();
  const { resourceTokens } = a.finalize({
    isTerminal: true,
    terminalMessages: [
      { role: 'assistant', provider: 'p', model: 'm', usage: { totalTokens: 100, cost: { total: 0.001 } } },
      { role: 'assistant', provider: 'p', model: 'm', usage: { totalTokens: 200, cost: { total: 0.002 } } },
    ],
  });
  assert.equal(resourceTokens.tokens, 300);
  assert.ok(Math.abs(resourceTokens.usd - 0.003) < 1e-12);
});

test('MESSAGES FALLBACK: NOT used when message_end coverage exists (no double-count)', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 50, costTotal: 0.001 }));
  assert.equal(r.resourceTokens?.tokens, 50);
  // finalize with fallback messages — should be ignored
  const { resourceTokens } = a.finalize({
    isTerminal: true,
    terminalMessages: [
      { role: 'assistant', provider: 'p', model: 'm', usage: { totalTokens: 9999, cost: { total: 99.9 } } },
    ],
  });
  assert.equal(resourceTokens, null, 'fallback ignored when message_end coverage present');
});

test('MESSAGES FALLBACK: empty terminalMessages yields unavailable seal', () => {
  const { resourceTokens, seal } = acc().finalize({ isTerminal: true, terminalMessages: [] });
  assert.equal(resourceTokens, null);
  assert.equal(seal.tokens, 'unavailable');
  assert.equal(seal.counterId, null);
});

test('MESSAGES FALLBACK: modelObserved is last assistant message provider/model', () => {
  const a = acc();
  const { modelObserved } = a.finalize({
    isTerminal: true,
    terminalMessages: [
      { role: 'user', provider: 'p', model: 'm', usage: {} },
      { role: 'assistant', provider: 'deepseek', model: 'deepseek-v4-flash', usage: { totalTokens: 5 } },
      { role: 'assistant', provider: 'glm', model: 'glm-5.2', usage: { totalTokens: 10 } },
    ],
  });
  assert.equal(modelObserved, 'glm/glm-5.2', 'last assistant message wins');
});

// ---------------------------------------------------------------------------
// message_start / message_end boundary
// ---------------------------------------------------------------------------

test('BOUNDARY: start+end pair accounts once', () => {
  const a = acc();
  a.consumeMessageStart(msgStart());
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 100 }));
  assert.equal(r.ok, true);
  assert.equal(r.resourceTokens?.tokens, 100);
  assert.equal(a.messageEndCount, 1);
});

test('BOUNDARY: end without preceding start is no-start fallback (ok, documented assumption)', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 50 }));
  // Still succeeds under no-start fallback
  assert.equal(r.ok, true);
  assert.equal(r.resourceTokens?.tokens, 50);
  assert.equal(a.messageEndCount, 1);
});

test('BOUNDARY: second start without intervening end resets (prior start abandoned)', () => {
  const a = acc();
  a.consumeMessageStart(msgStart());
  a.consumeMessageStart(msgStart()); // abandons first
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 70 }));
  assert.equal(r.ok, true);
  assert.equal(r.resourceTokens?.tokens, 70);
});

test('BOUNDARY: start after finalize is rejected', () => {
  const a = acc();
  a.finalize();
  assert.equal(a.consumeMessageStart(msgStart()).ok, false);
  assert.equal(a.consumeMessageStart(msgStart()).code, 'already_finalized');
});

// ---------------------------------------------------------------------------
// processGeneration in counterId
// ---------------------------------------------------------------------------

test('PROCGEN: different processGenerations produce different counterIds', () => {
  const a1 = new OmpTurnUsageAccumulator('w', 1, 1);
  const a2 = new OmpTurnUsageAccumulator('w', 1, 2);
  assert.notEqual(a1.counterId, a2.counterId);
});

test('PROCGEN: counterId format encodes worker+epoch+generation', () => {
  const a = new OmpTurnUsageAccumulator('worker-x', 3, 5);
  assert.equal(a.counterId, 'omp:worker-x:3:5');
});

test('PROCGEN: very long worker name hashes to omp-h: prefix within 256 bytes', () => {
  const longWorker = 'a'.repeat(300);
  const a = new OmpTurnUsageAccumulator(longWorker, 1, 1);
  assert.ok(a.counterId !== null);
  assert.ok(a.counterId.startsWith('omp-h:'));
  assert.ok(Buffer.byteLength(a.counterId) <= 256);
  // Same inputs produce same hash (stable)
  const b = new OmpTurnUsageAccumulator(longWorker, 1, 1);
  assert.equal(a.counterId, b.counterId);
  // Different generation = different hash
  const c = new OmpTurnUsageAccumulator(longWorker, 1, 2);
  assert.notEqual(a.counterId, c.counterId);
});

// ---------------------------------------------------------------------------
// No-events path
// ---------------------------------------------------------------------------

test('NO-EVENTS: unavailable seal, null resourceTokens, null modelObserved', () => {
  const { resourceTokens, seal, modelObserved } = acc().finalize();
  assert.equal(resourceTokens, null);
  assert.deepEqual(seal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
  assert.equal(modelObserved, null);
});

// ---------------------------------------------------------------------------
// Invalid constructor
// ---------------------------------------------------------------------------

test('INVALID: empty worker — consumeMessageEnd and finalize fail gracefully', () => {
  const a = new OmpTurnUsageAccumulator('', 1, 1);
  assert.equal(a.counterId, null);
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10 }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_counter');
  const fin = a.finalize();
  assert.equal(fin.resourceTokens, null);
  assert.equal(fin.seal.tokens, 'unavailable');
});

test('INVALID: negative epoch fails gracefully', () => {
  const a = new OmpTurnUsageAccumulator('w', -1, 1);
  assert.equal(a.counterId, null);
});

// ---------------------------------------------------------------------------
// Lifecycle guards
// ---------------------------------------------------------------------------

test('LIFECYCLE: finalize twice throws', () => {
  const a = acc();
  a.finalize();
  assert.throws(() => a.finalize(), /already finalized/);
});

test('LIFECYCLE: consumeMessageEnd after finalize returns already_finalized', () => {
  const a = acc();
  a.finalize();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 5 }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'already_finalized');
  assert.equal(r.resourceTokens, null);
});

// ---------------------------------------------------------------------------
// USD nano precision
// ---------------------------------------------------------------------------

test('USD PRECISION: per-call cost.total is representable to nano-level', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { costTotal: 0.0037 }));
  assert.equal(r.resourceTokens?.usd, 0.0037);
});

test('USD PRECISION: zero cost is reported', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 0, costTotal: 0 }));
  assert.equal(r.resourceTokens?.tokens, 0);
  assert.equal(r.resourceTokens?.usd, 0);
});

// ---------------------------------------------------------------------------
// OMP_TOKEN_METRIC export contract
// ---------------------------------------------------------------------------

test('TOKEN METRIC: OMP_TOKEN_METRIC is a valid bounded identifier', () => {
  assert.equal(typeof OMP_TOKEN_METRIC, 'string');
  assert.ok(OMP_TOKEN_METRIC.length > 0);
  assert.ok(!OMP_TOKEN_METRIC.includes('\0'));
  assert.ok(Buffer.byteLength(OMP_TOKEN_METRIC) <= 256);
  assert.equal(OMP_TOKEN_METRIC, 'message_end.totalTokens');
});

test('TOKEN METRIC: resourceTokens.tokenMetric matches OMP_TOKEN_METRIC when tokens reported', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 10 }));
  assert.equal(r.resourceTokens?.tokenMetric, OMP_TOKEN_METRIC);
});


test('NATIVE PRICE: sub-nanodollar costs round upward to the existing ledger unit', () => {
  const a = acc();
  const r = a.consumeMessageEnd(msgEnd('deepseek', 'deepseek-v4-flash', {
    totalTokens: 32118, costTotal: 0.0044679152,
  }));
  assert.equal(r.resourceTokens.usd, 0.004467916);
  assert.equal(r.resourceTokens.nativeUsd, 0.0044679152);
  assert.equal(r.resourceTokens.usdRounding, 'ceil_nanodollar');
  assert.equal(a.finalize().seal.usd, 'reported');
});

test('NON-TERMINAL: later native calls remain accountable after the intermediate end', () => {
  const a = acc();
  a.consumeMessageStart(msgStart());
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 3, costTotal: 0.001 }));
  assert.equal(a.finalize({ isTerminal: false }).seal, null);
  a.consumeMessageStart(msgStart());
  assert.equal(a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 5, costTotal: 0.002 })).resourceTokens.tokens, 5);
  assert.equal(a.finalize().seal.tokens, 'reported');
});

test('COVERAGE: an unfinished assistant or inconsistently missing dimensions cannot claim a full seal', () => {
  const a = acc();
  a.consumeMessageStart(msgStart());
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 3, costTotal: 0.001 }));
  a.consumeMessageStart({ type: 'message_start', message: { role: 'toolResult' } });
  a.consumeMessageEnd({ type: 'message_end', message: { role: 'toolResult' } });
  assert.equal(a.snapshot().seal.tokens, 'reported', 'tool boundaries are not missing provider usage');
  a.consumeMessageStart(msgStart());
  assert.equal(a.snapshot().seal.tokens, 'unavailable');
  a.consumeMessageEnd(msgEnd('p', 'm', { totalTokens: 5 }));
  assert.equal(a.finalize().seal.usd, 'unavailable');
});
