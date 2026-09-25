// claude-session-accounting.test.mjs — native-frame accounting tests for ClaudeSessionCli.
//
// THE SEMANTICS UNDER TEST (verified against the installed Claude Code 2.1.269 bundle, not
// assumed): one `result` frame carries TWO counters with DIFFERENT meanings.
//
//   * `usage`          — the ResultUsage schema is annotated "MAIN AGENT LOOP ONLY — ... and is
//                        per-turn in streaming-input sessions" → additive as-is (a delta).
//   * `total_cost_usd` — the costLedger's `totalCostUSD()` process/session CUMULATIVE accumulator
//                        (`recordCost(e,t,o){ this.#l[o]=t; this.#e+=e }`) → NOT a per-turn value.
//
// The D3 resource contract is canonical ADDITIVE `tokens`/`usd` and the Coordinator's delta path
// folds each `resource.tokens` payload directly, so re-emitting a cumulative reading as
// `accounting:'delta'` multiplies real spend by the turn count — the live runaway-budget finding
// (short completion replies drove four-figure totals against a ~$24 native reading).
//
// These tests drive the REAL wire-ingestion path (`_onData` → `_handleWireObject` → `_handleResult`
// → `_emit`) with native frame shapes and NO child process, so every assertion is on the exact
// coordinator-facing event stream. Zero quota, deterministic, and no fixture edits: the existing
// fake binary emits a CONSTANT cost per turn, which cannot express cumulative wire semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSessionCli } from '../src/claude-session.mjs';

const CLAUDE_TOKEN_METRIC = 'anthropic_input_plus_output_tokens_excluding_cache';

function makeCli(opts = {}) {
  // No child is ever spawned here: cmd/versionProbe are pinned so construction is pure.
  return new ClaudeSessionCli({ cmd: '/fixture/claude', versionProbe: () => '2.1.269', ...opts });
}

function harness(opts = {}) {
  const cli = makeCli(opts);
  const events = [];
  cli.onEvent((event) => events.push(event));
  return { cli, events };
}

/** The fields `_handleResult`/`_emit` touch, mirroring a live session's shape. */
function sessionStub(overrides = {}) {
  return {
    worker: 'acct',
    pid: 4242,
    processGeneration: 1,
    turnEpoch: 1,
    turnInFlight: false,
    discardNextResult: false,
    pendingInterrupt: null,
    retryCount: 0,
    lastTurnText: null,
    deadEmitted: false,
    terminal: false,
    stopping: false,
    processFailure: null,
    discardingFrame: null,
    buf: '',
    spawnedEmitted: false,
    sessionIdWire: null,
    bootstrapTurnPending: false,
    pendingBrief: null,
    claudeCostNanos: null,
    modelRequested: 'claude-sonnet-5',
    modelObserved: 'claude-sonnet-5',
    ...overrides,
  };
}

function initFrame(sessionId = 'native-session') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5', tools: [] };
}

/** A native `result` frame; omitted fields are genuinely absent from the wire object. */
function resultFrame({ cost, usage, isError = false, text = 'ok' } = {}) {
  const frame = {
    type: 'result', subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError, result: text, stop_reason: null,
  };
  if (cost !== undefined) frame.total_cost_usd = cost;
  if (usage !== undefined) frame.usage = usage;
  return frame;
}

function feed(cli, events, session, ...frames) {
  const start = events.length;
  for (const frame of frames) cli._onData(session, `${JSON.stringify(frame)}\n`);
  return events.slice(start);
}

function feedTurn(cli, events, session, epoch, frame) {
  session.turnEpoch = epoch;
  return feed(cli, events, session, frame);
}

const tokensOf = (batch) => batch.find((event) => event.kind === 'resource.tokens');
const terminalOf = (batch) => batch.find((event) => event.kind === 'lifecycle.turn_completed');
const sum = (values) => values.reduce((total, value) => total + value, 0);
const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;

// ---------------------------------------------------------------------------
// The bug: one cumulative reading must not be re-added on every turn.
// ---------------------------------------------------------------------------

test('native frames: cumulative total_cost_usd is emitted as THIS turn\'s delta, and the terminal result echoes the same delta', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  const turn1 = feedTurn(cli, events, session, 1, resultFrame({ cost: 0.10, usage: { input_tokens: 10, output_tokens: 2 } }));
  const turn2 = feedTurn(cli, events, session, 2, resultFrame({ cost: 0.25, usage: { input_tokens: 5, output_tokens: 3 } }));
  const turn3 = feedTurn(cli, events, session, 3, resultFrame({ cost: 0.25, usage: { input_tokens: 1, output_tokens: 1 } }));

  const u1 = tokensOf(turn1); const u2 = tokensOf(turn2); const u3 = tokensOf(turn3);
  assert.deepEqual(u1.payload, {
    source: 'result', accounting: 'delta', tokens: 12, usd: 0.10,
    counterId: 'claude:acct:1', tokenMetric: CLAUDE_TOKEN_METRIC,
    usage: { input_tokens: 10, output_tokens: 2 }, pid: 4242,
    modelRequested: 'claude-sonnet-5', modelObserved: 'claude-sonnet-5',
  });
  assert.deepEqual(u2.payload, {
    source: 'result', accounting: 'delta', tokens: 8, usd: 0.15,
    counterId: 'claude:acct:2', tokenMetric: CLAUDE_TOKEN_METRIC,
    usage: { input_tokens: 5, output_tokens: 3 }, pid: 4242,
    modelRequested: 'claude-sonnet-5', modelObserved: 'claude-sonnet-5',
  });
  // A repeated cumulative snapshot (retransmit) contributes ZERO usd; the per-turn tokens still
  // ride the wire as reported (tokens are not a cumulative counter — no invented dedup).
  assert.deepEqual(u3.payload, {
    source: 'result', accounting: 'delta', tokens: 2, usd: 0,
    counterId: 'claude:acct:3', tokenMetric: CLAUDE_TOKEN_METRIC,
    usage: { input_tokens: 1, output_tokens: 1 }, pid: 4242,
    modelRequested: 'claude-sonnet-5', modelObserved: 'claude-sonnet-5',
  });

  // The coordinator-facing envelope is exactly the D3 shape.
  assert.deepEqual(Object.keys(u1).sort(), ['actor', 'harness', 'kind', 'payload', 'turnEpoch', 'worker']);
  assert.equal(u1.harness, 'claude-code');
  assert.equal(u1.actor, 'worker');
  assert.equal(u1.worker, 'acct');
  assert.equal(u1.turnEpoch, 1);

  // Usage is authoritative and ordered BEFORE the terminal, and the terminal's budgetUsed is the
  // SAME additive delta — never the cumulative value (that echo is the double-count).
  const expectations = [
    [turn1, u1, { tokens: 12, usd: 0.10 }],
    [turn2, u2, { tokens: 8, usd: 0.15 }],
    [turn3, u3, { tokens: 2, usd: 0 }],
  ];
  for (const [batch, usageEvent, budgetUsed] of expectations) {
    const terminal = terminalOf(batch);
    assert.ok(batch.indexOf(usageEvent) < batch.indexOf(terminal), 'resource.tokens precedes lifecycle.turn_completed');
    assert.deepEqual(terminal.payload.result.budgetUsed, budgetUsed);
    assert.deepEqual(terminal.payload.usageSeal, {
      tokens: 'reported', usd: 'reported',
      counterId: usageEvent.payload.counterId, tokenMetric: CLAUDE_TOKEN_METRIC,
    });
  }

  const deltas = [u1.payload.usd, u2.payload.usd, u3.payload.usd];
  assert.ok(close(sum(deltas), 0.25), `additive deltas must land on the final cumulative 0.25, got ${sum(deltas)}`);
  assert.ok(sum(deltas) < 1, 'three short turns can never synthesize a four-figure total');
});

// ---------------------------------------------------------------------------
// Missing usage: unavailable stays unavailable, and the baseline survives.
// ---------------------------------------------------------------------------

test('a result that omits usage reports unavailable (never a fabricated zero) and leaves the cumulative baseline intact', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  const turn1 = feedTurn(cli, events, session, 1, resultFrame({ cost: 0.20, usage: { input_tokens: 4, output_tokens: 6 } }));
  const turn2 = feedTurn(cli, events, session, 2, resultFrame({ text: 'no telemetry on this frame' }));
  const turn3 = feedTurn(cli, events, session, 3, resultFrame({ cost: 0.30, usage: { input_tokens: 1, output_tokens: 1 } }));

  assert.equal(tokensOf(turn1).payload.usd, 0.20);
  assert.equal(tokensOf(turn2), undefined, 'no wire usage → no resource.tokens claim at all');
  const term2 = terminalOf(turn2);
  assert.deepEqual(term2.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
  assert.deepEqual(term2.payload.result.budgetUsed, { tokens: 0, usd: 0 });

  // The missing reading must NOT reset the baseline: turn 3 is measured against 0.20 (the last
  // observed cumulative), so it contributes 0.10 instead of re-counting the whole 0.30.
  assert.equal(tokensOf(turn3).payload.usd, 0.10);
  assert.equal(terminalOf(turn3).payload.result.budgetUsed.usd, 0.10);
  assert.ok(close(tokensOf(turn1).payload.usd + tokensOf(turn3).payload.usd, 0.30));
});

// ---------------------------------------------------------------------------
// Resets: a lower reading is a placeholder, not a decrease; a fresh process re-bases.
// ---------------------------------------------------------------------------

test('a lower cumulative reading clamps to zero without moving the baseline; a respawned process re-bases on its owned generation', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  const turn1 = feedTurn(cli, events, session, 1, resultFrame({ cost: 0.40, usage: { input_tokens: 2, output_tokens: 2 } }));
  // The CLI's own synthesized error results carry total_cost_usd: 0 — a placeholder, not a
  // ledger decrease. It must add nothing and must not corrupt the baseline.
  const turn2 = feedTurn(cli, events, session, 2, resultFrame({ cost: 0, usage: { input_tokens: 1, output_tokens: 1 }, isError: true, text: 'boom' }));
  const turn3 = feedTurn(cli, events, session, 3, resultFrame({ cost: 0.55, usage: { input_tokens: 1, output_tokens: 1 } }));

  assert.equal(tokensOf(turn1).payload.usd, 0.40);
  assert.equal(tokensOf(turn2).payload.usd, 0);
  assert.equal(terminalOf(turn2).payload.result.status, 'failed', 'a failed turn still carries its (zero-delta) accounting');
  assert.equal(tokensOf(turn3).payload.usd, 0.15, 'the placeholder did not zero the 0.40 baseline');
  assert.ok(close(tokensOf(turn1).payload.usd + tokensOf(turn2).payload.usd + tokensOf(turn3).payload.usd, 0.55));

  // A respawned child emits its own system/init and owns a fresh cost ledger. Without the re-base
  // its low first reading (0.02 < 0.55) would be silently suppressed — an under-count.
  session.processGeneration += 1;
  feed(cli, events, session, initFrame('respawned-session'));
  const respawned = feedTurn(cli, events, session, 4, resultFrame({ cost: 0.02, usage: { input_tokens: 1, output_tokens: 1 } }));
  const u4 = tokensOf(respawned);
  assert.equal(u4.payload.usd, 0.02);
  assert.equal(u4.turnEpoch, 4);
  assert.equal(terminalOf(respawned).payload.result.budgetUsed.usd, 0.02);
});

// ---------------------------------------------------------------------------
// Discarded (interrupted) + failed results keep their accounting exactly once.
// ---------------------------------------------------------------------------

test('an interrupted turn\'s discarded result is accounted once and advances the baseline; the next turn is not charged again', () => {
  const { cli, events } = harness();
  const pendingInterrupt = { wireConfirmed: false, resultSeen: false, usageSeal: null, emitted: false };
  const session = sessionStub({ discardNextResult: true, pendingInterrupt });
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  const discarded = feedTurn(cli, events, session, 1, resultFrame({ cost: 0.07, usage: { input_tokens: 1, output_tokens: 1 } }));
  assert.deepEqual(discarded.map((event) => event.kind), ['resource.tokens'], 'CS11: no turn_completed for the discarded frame');
  assert.equal(tokensOf(discarded).payload.usd, 0.07);
  assert.equal(pendingInterrupt.resultSeen, true);
  assert.equal(pendingInterrupt.usageSeal.usd, 'reported');

  session.discardNextResult = false;
  session.pendingInterrupt = null;
  const next = feedTurn(cli, events, session, 2, resultFrame({ cost: 0.09, usage: { input_tokens: 1, output_tokens: 1 } }));
  assert.equal(tokensOf(next).payload.usd, 0.02, 'the discarded turn\'s spend is measured once, not re-counted on the next terminal');
});

test('an auth-shaped failed result without a refresh controller is terminal with the per-turn delta (no cumulative echo)', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  feedTurn(cli, events, session, 1, resultFrame({ cost: 0.05, usage: { input_tokens: 3, output_tokens: 3 } }));
  const failed = feedTurn(cli, events, session, 2, resultFrame({
    cost: 0.08, usage: { input_tokens: 2, output_tokens: 1 }, isError: true,
    text: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
  }));

  const terminal = terminalOf(failed);
  assert.equal(terminal.payload.result.status, 'failed');
  assert.deepEqual(terminal.payload.result.failure, { code: 'authentication_refresh_required' });
  assert.deepEqual(terminal.payload.result.budgetUsed, { tokens: 3, usd: 0.03 });
  assert.equal(tokensOf(failed).payload.usd, 0.03);
});

// ---------------------------------------------------------------------------
// The runaway-budget invariant over a longer session.
// ---------------------------------------------------------------------------

test('sum(budgetUsed.usd) over many turns tracks the final cumulative reading instead of multiplying it', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  cli._onData(session, `${JSON.stringify(initFrame())}\n`);

  const cumulativeReadings = [0.01, 0.02, 0.05, 0.05, 0.09];
  const deltas = [];
  for (const [index, cost] of cumulativeReadings.entries()) {
    const batch = feedTurn(cli, events, session, index + 1, resultFrame({ cost, usage: { input_tokens: 1, output_tokens: 1 } }));
    const usageEvent = tokensOf(batch);
    deltas.push(usageEvent.payload.usd);
    assert.equal(terminalOf(batch).payload.result.budgetUsed.usd, usageEvent.payload.usd,
      'the terminal fallback echoes the same additive delta every turn');
  }
  assert.deepEqual(deltas, [0.01, 0.01, 0.03, 0, 0.04]);
  assert.ok(close(sum(deltas), 0.09), `five turns of a $0.09 session must sum to $0.09, got ${sum(deltas)}`);
  assert.ok(sum(deltas) <= 0.09 + 1e-9, 'no turn re-adds the cumulative reading');
});


test('replayed result ids and repeated init frames cannot double-count a process ledger', () => {
  const { cli, events } = harness();
  const session = sessionStub();
  feed(cli, events, session, initFrame());
  const frame = { ...resultFrame({ cost: 0.40, usage: { input_tokens: 2, output_tokens: 2 } }), uuid: 'native-result-1' };
  feedTurn(cli, events, session, 1, frame);
  session.turnInFlight = true;
  const duplicate = feed(cli, events, session, frame);
  assert.equal(duplicate.length, 0, 'native result replay emits neither extra usage nor terminality');
  assert.equal(session.turnInFlight, true, 'old result replay cannot end a later turn');
  feed(cli, events, session, initFrame());
  const next = feedTurn(cli, events, session, 2, { ...frame, uuid: 'native-result-2', total_cost_usd: 0.45 });
  assert.equal(tokensOf(next).payload.usd, 0.05, 'replayed init did not erase already accounted cost');
  assert.equal(tokensOf(next).payload.tokens, 4, 'a distinct result retains its own per-turn tokens');
});
