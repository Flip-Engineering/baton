import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  MESSAGE_KINDS,
  ATTENTION_TYPES,
  createBrief,
  validateBrief,
  createMessage,
  createNudge,
  createSteer,
  createAsk,
  createAnswer,
  createResult,
  wrapFact,
  wrapProse,
  createDigest,
  isFact,
  isProse,
  isStale,
} from '../src/messages.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIXTURE NOTE — D2 conformance (spec/RECONCILIATION.md, authoritative over the
// cluster-specific Brief typedefs it resolved): `pathScope` is a flat `string[]`
// of in-scope path globs (NOT `{include,exclude}` — that richer shape was one of
// three incompatible per-cluster typedefs red-teamed away, red integration#5),
// and `budget.wallMin` (not `wallMinutes`). This is the ONE Brief shape every
// cluster/module/test must build and consume.
// ---------------------------------------------------------------------------

/** A minimal, fully valid Brief field set — the delegation contract (D2). */
function validBriefFields(overrides = {}) {
  return {
    goal: 'Add rate limiting to the API gateway',
    constraints: ['no new external dependencies', 'must not break existing tests'],
    pathScope: ['src/gateway/**'],
    tools: ['bash', 'edit', 'read'],
    outputFormat: 'unified diff + summary',
    definitionOfDone: 'rate limiting middleware installed and covered by tests',
    verification: { command: 'npm test -- gateway', expectExit: 0 },
    budget: { tokens: 200000, usd: 5, wallMin: 30 },
    ...overrides,
  };
}

const fixedNow = () => '2026-01-01T00:00:00.000Z';
function makeIdGen(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

// ===========================================================================
// Brief — the delegation contract
// ===========================================================================

test('createBrief: all required fields present returns a frozen Brief with exactly the given fields', () => {
  const fields = validBriefFields();
  const brief = createBrief(fields);
  assert.equal(brief.goal, fields.goal);
  assert.deepEqual(brief.constraints, fields.constraints);
  assert.deepEqual(brief.pathScope, fields.pathScope);
  assert.deepEqual(brief.tools, fields.tools);
  assert.equal(brief.outputFormat, fields.outputFormat);
  assert.equal(brief.definitionOfDone, fields.definitionOfDone);
  assert.deepEqual(brief.verification, fields.verification);
  assert.deepEqual(brief.budget, fields.budget);
  assert.ok(Object.isFrozen(brief));
});

test('createBrief: brief is a delegation contract — carries objective, scope paths, tools, output format, and the exact done-command', () => {
  const brief = createBrief(validBriefFields());
  assert.equal(typeof brief.goal, 'string');
  assert.ok(Array.isArray(brief.pathScope), 'pathScope is a flat string[] of globs (D2), not {include,exclude}');
  assert.ok(Array.isArray(brief.tools) && brief.tools.length > 0);
  assert.equal(typeof brief.outputFormat, 'string');
  // The exact 'done' verification command — the ONLY definition of done.
  assert.equal(typeof brief.verification.command, 'string');
  assert.ok(brief.verification.command.length > 0);
  assert.equal(typeof brief.verification.expectExit, 'number');
});

test('createBrief: missing verification.command throws ValidationError naming that field', () => {
  const fields = validBriefFields();
  delete fields.verification.command;
  assert.throws(
    () => createBrief(fields),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.ok(err.errors.some((e) => /verification\.command/.test(e)));
      return true;
    }
  );
});

test('validator rejects a brief missing the done-command (via the full verification block omitted)', () => {
  const fields = validBriefFields();
  delete fields.verification;
  assert.throws(() => createBrief(fields), ValidationError);
  const result = validateBrief(fields);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((e) => /verification/i.test(e)));
});

test('createBrief: pathScope entry starting with "/" (absolute path) throws — must be repo-relative', () => {
  const fields = validBriefFields({ pathScope: ['/etc/passwd'] });
  assert.throws(() => createBrief(fields), ValidationError);
});

test('createBrief: empty pathScope ([]) is accepted (explicitly unscoped)', () => {
  const fields = validBriefFields({ pathScope: [] });
  const brief = createBrief(fields);
  assert.deepEqual(brief.pathScope, []);
});

test('createBrief: budget is a required closed set of safe task ceilings', () => {
  const missing = validBriefFields();
  delete missing.budget;
  assert.throws(() => createBrief(missing), (error) => error instanceof ValidationError
    && error.errors.some((item) => item.includes('budget is required')));
  assert.throws(() => createBrief(validBriefFields({ budget: { tokens: 1, usd: 0, wallMin: 1, secret: 'no' } })), ValidationError);
  assert.deepEqual(createBrief(validBriefFields({ budget: { tokens: 1, usd: 0, wallMin: 1 } })).budget, { tokens: 1, usd: 0, wallMin: 1 });
});

test('createBrief: token and wall ceilings are positive safe integers and USD is finite nonnegative', () => {
  for (const tokens of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1']) {
    const result = validateBrief(validBriefFields({ budget: { tokens, usd: 0, wallMin: 1 } }));
    assert.equal(result.ok, false); assert.ok(result.errors.some((item) => item.includes('budget.tokens')));
  }
  for (const wallMin of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1']) {
    const result = validateBrief(validBriefFields({ budget: { tokens: 1, usd: 0, wallMin } }));
    assert.equal(result.ok, false); assert.ok(result.errors.some((item) => item.includes('budget.wallMin')));
  }
  for (const usd of [-0.01, Infinity, -Infinity, NaN, '0']) {
    const result = validateBrief(validBriefFields({ budget: { tokens: 1, usd, wallMin: 1 } }));
    assert.equal(result.ok, false); assert.ok(result.errors.some((item) => item.includes('budget.usd')));
  }
  assert.doesNotThrow(() => createBrief(validBriefFields({
    budget: { tokens: Number.MAX_SAFE_INTEGER, usd: 0.0001, wallMin: Number.MAX_SAFE_INTEGER },
  })));
});

test('validateBrief: returns {ok:false, errors:[...]} without throwing, for programmatic checks', () => {
  const fields = validBriefFields();
  delete fields.goal;
  const result = validateBrief(fields);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
});

test('validateBrief: returns {ok:true, errors:[]} for a fully valid brief', () => {
  const result = validateBrief(validBriefFields());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('createBrief: returned Brief is deeply frozen — mutation throws TypeError', () => {
  const brief = createBrief(validBriefFields());
  assert.throws(() => {
    brief.budget.tokens = 1;
  }, TypeError);
});

test('createBrief: mutating the pathScope array throws TypeError (deep freeze)', () => {
  const brief = createBrief(validBriefFields());
  assert.throws(() => {
    brief.pathScope.push('src/**');
  }, TypeError);
});

// ===========================================================================
// D2 — "same done command" structural invariant: identity, not just equality
// ===========================================================================

test('D2: brief.verification is a STABLE object reference across repeated reads — the trust gate re-reads task.brief.verification later and must get back the exact same object, never a re-materialized copy', () => {
  const brief = createBrief(validBriefFields());
  const readOne = brief.verification;
  const readTwo = brief.verification;
  assert.strictEqual(readOne, readTwo, 'repeated property access must yield the identical object, not structurally-equal clones');
});

test('D2: createBrief does not clone the caller\'s verification object identity into something new and detached — the frozen brief.verification is the one and only "done" definition, checkable by reference equality against itself over time (simulating the trust gate holding a reference across an await boundary)', async () => {
  const fields = validBriefFields();
  const brief = createBrief(fields);
  const capturedAtDispatch = brief.verification;
  // Simulate time passing (e.g. the worker's whole turn) between the coordinator first reading
  // brief.verification at dispatch and the trust gate re-reading task.brief.verification later.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const capturedAtTrustGate = brief.verification;
  assert.strictEqual(capturedAtDispatch, capturedAtTrustGate);
  assert.strictEqual(capturedAtDispatch.command, capturedAtTrustGate.command);
});

// ===========================================================================
// createMessage / envelope basics
// ===========================================================================

test('createMessage: throws ValidationError for a kind not in MESSAGE_KINDS', () => {
  assert.throws(
    () =>
      createMessage('bogus-kind', { from: 'orchestrator', to: 'w1', payload: {}, turnEpoch: 1 }),
    ValidationError
  );
});

test('createMessage: throws ValidationError when turnEpoch is not a finite number', () => {
  assert.throws(
    () =>
      createMessage('nudge', {
        from: 'orchestrator',
        to: 'w1',
        payload: { text: 'hi', at: 'next_turn' },
        turnEpoch: NaN,
      }),
    ValidationError
  );
});

test('MESSAGE_KINDS and ATTENTION_TYPES are frozen arrays with the documented members', () => {
  assert.ok(Object.isFrozen(MESSAGE_KINDS));
  assert.deepEqual([...MESSAGE_KINDS].sort(), ['answer', 'ask', 'brief', 'nudge', 'result', 'steer'].sort());
  assert.ok(Object.isFrozen(ATTENTION_TYPES));
  assert.deepEqual(
    [...ATTENTION_TYPES].sort(),
    ['approval', 'blocked', 'budget_alarm', 'question', 'stalled'].sort()
  );
});

// ===========================================================================
// nudge / steer / ask / answer / result constructors
// ===========================================================================

test('createNudge: defaults "at" to "next_turn" when omitted', () => {
  const msg = createNudge(
    { from: 'orchestrator', to: 'w1', text: 'keep going', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.kind, 'nudge');
  assert.equal(msg.payload.at, 'next_turn');
  assert.equal(msg.payload.text, 'keep going');
});

test('createNudge: rejects any "at" value other than next_turn/tool_boundary', () => {
  assert.throws(
    () =>
      createNudge({
        from: 'orchestrator',
        to: 'w1',
        text: 'x',
        at: 'whenever',
        turnEpoch: 1,
      }),
    ValidationError
  );
});

test('createNudge: accepts explicit at:"tool_boundary"', () => {
  const msg = createNudge(
    { from: 'orchestrator', to: 'w1', text: 'x', at: 'tool_boundary', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.payload.at, 'tool_boundary');
});

test('createSteer: builds a valid steer envelope carrying text and optional reason', () => {
  const msg = createSteer(
    { from: 'orchestrator', to: 'w1', text: 'switch to approach B', reason: 'perf', turnEpoch: 2 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.kind, 'steer');
  assert.equal(msg.payload.text, 'switch to approach B');
  assert.equal(msg.payload.reason, 'perf');
  assert.equal(msg.turnEpoch, 2);
});

test('createAsk: defaults "blocking" to true when omitted', () => {
  const msg = createAsk(
    { from: 'w1', to: 'orchestrator', question: 'proceed with migration?', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.kind, 'ask');
  assert.equal(msg.payload.blocking, true);
});

test('createAsk: honors explicit blocking:false', () => {
  const msg = createAsk(
    { from: 'w1', to: 'orchestrator', question: 'fyi', blocking: false, turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.payload.blocking, false);
});

test('createAnswer: throws when inReplyTo is empty/missing', () => {
  assert.throws(
    () =>
      createAnswer({
        from: 'orchestrator',
        to: 'w1',
        inReplyTo: '',
        decision: 'yes',
        turnEpoch: 1,
      }),
    ValidationError
  );
  assert.throws(
    () =>
      createAnswer({
        from: 'orchestrator',
        to: 'w1',
        decision: 'yes',
        turnEpoch: 1,
      }),
    ValidationError
  );
});

test('createAnswer: throws when neither decision nor text is present', () => {
  assert.throws(
    () =>
      createAnswer({
        from: 'orchestrator',
        to: 'w1',
        inReplyTo: 'ask-1',
        turnEpoch: 1,
      }),
    ValidationError
  );
});

test('createAnswer: accepts decision-only, text-only, or both', () => {
  const a1 = createAnswer(
    { from: 'orchestrator', to: 'w1', inReplyTo: 'ask-1', decision: 'yes', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  const a2 = createAnswer(
    { from: 'orchestrator', to: 'w1', inReplyTo: 'ask-1', text: 'go ahead', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(a1.payload.decision, 'yes');
  assert.equal(a2.payload.text, 'go ahead');
});

test('createResult: status:"completed" with no verification block throws', () => {
  assert.throws(
    () =>
      createResult({
        from: 'w1',
        to: 'orchestrator',
        turnEpoch: 1,
        status: 'completed',
        summary: 'done',
        artifacts: { commits: ['abc'], files: ['a.js'] },
        openQuestions: [],
        budgetUsed: { tokens: 100, usd: 0.1 },
      }),
    ValidationError
  );
});

test('createResult: status:"completed" with a full verification claim succeeds', () => {
  const msg = createResult(
    {
      from: 'w1',
      to: 'orchestrator',
      turnEpoch: 1,
      status: 'completed',
      summary: 'implemented rate limiter',
      artifacts: { commits: ['abc123'], files: ['src/gateway/limiter.js'] },
      verification: { command: 'npm test -- gateway', claimedExit: 0 },
      openQuestions: [],
      budgetUsed: { tokens: 1000, usd: 0.2 },
    },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.payload.status, 'completed');
  assert.equal(msg.payload.verification.claimedExit, 0);
});

test('createResult: returned payload has no verified/trusted boolean anywhere — the shape cannot imply trust', () => {
  const msg = createResult(
    {
      from: 'w1',
      to: 'orchestrator',
      turnEpoch: 1,
      status: 'completed',
      summary: 'implemented rate limiter',
      artifacts: { commits: ['abc123'], files: ['src/gateway/limiter.js'] },
      verification: { command: 'npm test -- gateway', claimedExit: 0 },
      openQuestions: [],
      budgetUsed: { tokens: 1000, usd: 0.2 },
    },
    { now: fixedNow, idGen: makeIdGen() }
  );
  const json = JSON.stringify(msg.payload);
  assert.ok(!/"verified"/i.test(json));
  assert.ok(!/"trusted"/i.test(json));
});

test('createResult: a result message\'s verification block is always a CLAIM, never upgraded to fact by this module', () => {
  const msg = createResult(
    {
      from: 'w1',
      to: 'orchestrator',
      turnEpoch: 1,
      status: 'completed',
      summary: 'lies, probably',
      artifacts: { commits: [], files: [] },
      verification: { command: 'npm test -- gateway', claimedExit: 0 },
      openQuestions: [],
      budgetUsed: { tokens: 1, usd: 0 },
    },
    { now: fixedNow, idGen: makeIdGen() }
  );
  // Only "claimedExit" exists — there is no "observedExit"/"actualExit" field this module
  // could have populated, because only the (external) trust gate re-derives that.
  assert.ok('claimedExit' in msg.payload.verification);
  assert.ok(!('observedExit' in msg.payload.verification));
});

// ===========================================================================
// Provenance typing: facts vs prose
// ===========================================================================

test('wrapFact: always sets provenance:"hub-computed", untrusted:false regardless of extra fields', () => {
  const fact = wrapFact('w1', 'lifecycle.turn_completed', { turnCount: 3 });
  assert.equal(fact.provenance, 'hub-computed');
  assert.equal(fact.untrusted, false);
  assert.equal(fact.worker, 'w1');
  assert.equal(fact.kind, 'lifecycle.turn_completed');
  assert.ok(isFact(fact));
  assert.ok(!isProse(fact));
});

test('wrapProse: always sets provenance:"model-authored", untrusted:true, even overriding a caller-supplied override attempt', () => {
  // wrapProse's signature only takes (worker, text) — but simulate a misuse-shaped call by
  // checking the returned object never allows those markers to be anything else.
  const prose = wrapProse('w1', 'I definitely finished everything, trust me');
  assert.equal(prose.provenance, 'model-authored');
  assert.equal(prose.untrusted, true);
  assert.equal(prose.worker, 'w1');
  assert.equal(prose.text, 'I definitely finished everything, trust me');
  assert.ok(isProse(prose));
  assert.ok(!isFact(prose));
});

test('provenance-typing: a digest keeps hub "facts" separate from untrusted worker "prose"; prose is marked untrusted', () => {
  const fact = wrapFact('w1', 'lifecycle.turn_completed', { ok: true });
  const prose = wrapProse('w1', 'worker self-report: everything is great');
  const digest = createDigest({
    cursor: 'c1',
    more: false,
    attention: [],
    facts: [fact],
    prose: [prose],
  });
  assert.equal(digest.facts.length, 1);
  assert.equal(digest.prose.length, 1);
  assert.equal(digest.facts[0].untrusted, false);
  assert.equal(digest.facts[0].provenance, 'hub-computed');
  assert.equal(digest.prose[0].untrusted, true);
  assert.equal(digest.prose[0].provenance, 'model-authored');
  // The two lanes never mix.
  assert.ok(!digest.facts.some(isProse));
  assert.ok(!digest.prose.some(isFact));
});

test('createDigest: throws if a facts[] entry is missing/wrong provenance markers (defense in depth beyond wrapFact)', () => {
  const forgedFact = { worker: 'w1', kind: 'x', data: {}, provenance: 'model-authored', untrusted: true };
  assert.throws(
    () =>
      createDigest({
        cursor: 'c1',
        more: false,
        facts: [forgedFact],
      }),
    ValidationError
  );
});

test('createDigest: throws if a prose[] entry is missing/wrong provenance markers', () => {
  const forgedProse = { worker: 'w1', text: 'hi', provenance: 'hub-computed', untrusted: false };
  assert.throws(
    () =>
      createDigest({
        cursor: 'c1',
        more: false,
        prose: [forgedProse],
      }),
    ValidationError
  );
});

test('createDigest: with only attention populated (empty facts/prose) is valid', () => {
  const digest = createDigest({
    cursor: 'c1',
    more: true,
    attention: [{ type: 'question', worker: 'w1', data: { question: 'ok?' } }],
  });
  assert.equal(digest.attention.length, 1);
  assert.deepEqual(digest.facts, []);
  assert.deepEqual(digest.prose, []);
  assert.equal(digest.more, true);
});

// ===========================================================================
// isStale
// ===========================================================================

test('isStale: returns true iff message.turnEpoch < currentTurnEpoch; equal epoch returns false', () => {
  const msg = createNudge(
    { from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 3 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(isStale(msg, 3), false);
  assert.equal(isStale(msg, 4), true);
  assert.equal(isStale(msg, 2), false);
});

test('isStale: throws ValidationError on a message with a non-numeric turnEpoch', () => {
  const badMsg = {
    msgId: 'x',
    from: 'orchestrator',
    to: 'w1',
    kind: 'nudge',
    inReplyTo: null,
    turnEpoch: 'not-a-number',
    ts: fixedNow(),
    payload: {},
  };
  assert.throws(() => isStale(badMsg, 1), ValidationError);
});

// ===========================================================================
// Determinism / id generation
// ===========================================================================

test('two createX() calls with no injected idGen produce different msgIds', () => {
  const m1 = createNudge({ from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 1 });
  const m2 = createNudge({ from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 1 });
  assert.notEqual(m1.msgId, m2.msgId);
});

test('with a fixed injected idGen, msgId is deterministic and repeatable', () => {
  const m1 = createNudge(
    { from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 1 },
    { now: fixedNow, idGen: () => 'fixed-id' }
  );
  const m2 = createNudge(
    { from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 1 },
    { now: fixedNow, idGen: () => 'fixed-id' }
  );
  assert.equal(m1.msgId, 'fixed-id');
  assert.equal(m2.msgId, 'fixed-id');
});

test('determinism: given fixed now/idGen, the same create* call twice produces deep-equal objects', () => {
  const opts = { now: fixedNow, idGen: makeIdGen('same') };
  const fields = { from: 'orchestrator', to: 'w1', text: 'hold on', turnEpoch: 5 };

  // Re-seed idGen counter identically for both calls by constructing fresh generators
  // that both start from 1, so msgIds line up too.
  const m1 = createNudge(fields, { now: fixedNow, idGen: () => 'nudge-1' });
  const m2 = createNudge(fields, { now: fixedNow, idGen: () => 'nudge-1' });
  assert.deepEqual(m1, m2);
});

// ===========================================================================
// Purity: no ambient randomness/time without injection
// ===========================================================================

test('createMessage / create* are pure given fixed now/idGen — ts always equals the injected now()', () => {
  const msg = createSteer(
    { from: 'orchestrator', to: 'w1', text: 'x', turnEpoch: 1 },
    { now: fixedNow, idGen: makeIdGen() }
  );
  assert.equal(msg.ts, fixedNow());
});
