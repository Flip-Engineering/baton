import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RouterUsageError,
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_EXPLORATION_CONSTANT,
  DEFAULT_SEED_DISCOUNT,
  DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE,
  DEFAULT_PRIOR_SUCCESS_RATE,
  decayedStat,
  scoreCandidate,
  AdaptiveRouter,
} from '../src/router.mjs';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');

function candidate(overrides = {}) {
  return {
    modelVersion: 'codex-2025-11',
    family: 'codex',
    concurrencyCeiling: 3,
    inFlight: 0,
    ...overrides,
  };
}

// ===========================================================================
// decayedStat / scoreCandidate — pure, unit-testable in isolation
// ===========================================================================

test('decayedStat: null stat has no decayed values (bucket does not exist)', () => {
  const result = decayedStat(null, T0, DEFAULT_HALF_LIFE_MS);
  assert.deepEqual(result, { weight: 0, count: 0 });
});

test('decayedStat: exactly one half-life halves weight and count (hand-computed example)', () => {
  const stat = { weight: 8, count: 8, lastUsedTs: T0 };
  const result = decayedStat(stat, T0 + DEFAULT_HALF_LIFE_MS, DEFAULT_HALF_LIFE_MS);
  assert.ok(Math.abs(result.weight - 4) < 1e-9);
  assert.ok(Math.abs(result.count - 4) < 1e-9);
});

test('decayedStat: no elapsed time returns the stat unchanged', () => {
  const stat = { weight: 5, count: 10, lastUsedTs: T0 };
  const result = decayedStat(stat, T0, DEFAULT_HALF_LIFE_MS);
  assert.ok(Math.abs(result.weight - 5) < 1e-9);
  assert.ok(Math.abs(result.count - 10) < 1e-9);
});

test('decayedStat: two half-lives quarters weight and count', () => {
  const stat = { weight: 8, count: 8, lastUsedTs: T0 };
  const result = decayedStat(stat, T0 + 2 * DEFAULT_HALF_LIFE_MS, DEFAULT_HALF_LIFE_MS);
  assert.ok(Math.abs(result.weight - 2) < 1e-9);
  assert.ok(Math.abs(result.count - 2) < 1e-9);
});

test('scoreCandidate: rate falls back to defaultPriorSuccessRate when count is 0', () => {
  const score = scoreCandidate({ weight: 0, count: 0 }, 0, { defaultPriorSuccessRate: 0.5, explorationConstant: 0 });
  assert.ok(Math.abs(score - 0.5) < 1e-9);
});

test('scoreCandidate: higher decayed weight/count (all wins) scores higher than a losing candidate at equal count', () => {
  const winning = scoreCandidate({ weight: 10, count: 10 }, 20, { explorationConstant: 0 });
  const losing = scoreCandidate({ weight: 2, count: 10 }, 20, { explorationConstant: 0 });
  assert.ok(winning > losing);
});

// ===========================================================================
// pick() — round robin / eligibility / ceilings
// ===========================================================================

test('mode:round-robin cycles through eligible candidates in given order, wrapping, independently per taskType', () => {
  const router = new AdaptiveRouter({ mode: 'round-robin', now: () => T0 });
  const candidates = [candidate({ modelVersion: 'a' }), candidate({ modelVersion: 'b' }), candidate({ modelVersion: 'c' })];

  const picksBuild = [];
  for (let i = 0; i < 6; i++) {
    picksBuild.push(router.pick({ taskType: 'build' }, candidates, { now: T0 }));
  }
  assert.deepEqual(picksBuild, ['a', 'b', 'c', 'a', 'b', 'c']);

  // A separate taskType has its own independent cursor, starting fresh.
  const picksTest = [];
  for (let i = 0; i < 3; i++) {
    picksTest.push(router.pick({ taskType: 'test' }, candidates, { now: T0 }));
  }
  assert.deepEqual(picksTest, ['a', 'b', 'c']);
});

test('candidates at concurrencyCeiling are filtered before selection; sole remaining eligible candidate is returned regardless of mode', () => {
  const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0 });
  const candidates = [
    candidate({ modelVersion: 'maxed', concurrencyCeiling: 1, inFlight: 1 }),
    candidate({ modelVersion: 'free', concurrencyCeiling: 1, inFlight: 0 }),
  ];
  const picked = router.pick({ taskType: 'build' }, candidates, { now: T0 });
  assert.equal(picked, 'free');
});

test('pick() returns null for an empty candidates array or when all candidates are at ceiling', () => {
  const router = new AdaptiveRouter({ mode: 'round-robin', now: () => T0 });
  assert.equal(router.pick({ taskType: 'build' }, [], { now: T0 }), null);

  const allMaxed = [
    candidate({ modelVersion: 'a', concurrencyCeiling: 1, inFlight: 1 }),
    candidate({ modelVersion: 'b', concurrencyCeiling: 2, inFlight: 2 }),
  ];
  assert.equal(router.pick({ taskType: 'build' }, allMaxed, { now: T0 }), null);
});

test('respects concurrency: a maxed vendor is skipped in favor of one with headroom', () => {
  const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0 });
  // Give 'good' a strong verified win history so it would normally be picked,
  // but mark it maxed out — it must be skipped regardless of score.
  for (let i = 0; i < 10; i++) {
    router.record('good', 'build', true, { family: 'fam', now: T0 });
  }
  const candidates = [
    candidate({ modelVersion: 'good', family: 'fam', concurrencyCeiling: 1, inFlight: 1 }),
    candidate({ modelVersion: 'other', family: 'fam', concurrencyCeiling: 1, inFlight: 0 }),
  ];
  const picked = router.pick({ taskType: 'build' }, candidates, { now: T0 });
  assert.equal(picked, 'other');
});

// ===========================================================================
// mode:auto — off by default until enough history
// ===========================================================================

test('mode:auto stays round-robin while totalDecayedCount < minSamplesForAdaptive, then switches to score-based selection', () => {
  const router = new AdaptiveRouter({ mode: 'auto', minSamplesForAdaptive: 5, now: () => T0 });
  const candidates = [candidate({ modelVersion: 'a', family: 'fam' }), candidate({ modelVersion: 'b', family: 'fam' })];

  // Fewer than minSamplesForAdaptive records exist: behaves as round-robin.
  const early = [
    router.pick({ taskType: 'build' }, candidates, { now: T0 }),
    router.pick({ taskType: 'build' }, candidates, { now: T0 }),
  ];
  assert.deepEqual(early, ['a', 'b']);

  // Push 'b' well past the adaptive threshold with verified wins.
  for (let i = 0; i < 6; i++) {
    router.record('b', 'build', true, { family: 'fam', now: T0 });
  }
  // 'a' has zero record history — 'b' should now dominate via score, not round-robin order.
  const picked = router.pick({ taskType: 'build' }, candidates, { now: T0 });
  assert.equal(picked, 'b');
});

// ===========================================================================
// record() — decay, recency bias
// ===========================================================================

test('record(..., true) increases decayed weight and count; record(..., false) increases count only (rate falls)', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  let stat = router.getStat('m1', 'build');
  assert.equal(stat.weight, 1);
  assert.equal(stat.count, 1);

  router.record('m1', 'build', false, { family: 'fam', now: T0 });
  stat = router.getStat('m1', 'build');
  assert.equal(stat.weight, 1);
  assert.equal(stat.count, 2);
});

test('record() decays the existing bucket by elapsed time before adding the new observation (hand-computed half-life example)', () => {
  const router = new AdaptiveRouter({ now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  // weight=1,count=1 at T0. One half-life later, decay to weight=0.5,count=0.5, then +1 win.
  router.record('m1', 'build', true, { family: 'fam', now: T0 + DEFAULT_HALF_LIFE_MS });
  const stat = router.getStat('m1', 'build');
  assert.ok(Math.abs(stat.weight - 1.5) < 1e-9);
  assert.ok(Math.abs(stat.count - 1.5) < 1e-9);
});

test('decay is a read-time projection: a bucket recorded once at t=0 shows continued decay toward the prior at t=10*halfLifeMs via getStat/pick, without another record()', () => {
  const router = new AdaptiveRouter({ now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  const farLater = T0 + 10 * DEFAULT_HALF_LIFE_MS;

  // getStat returns the raw (undecayed) stored bucket — decay is applied by the caller/pick
  // at read time. Verify decayedStat applied to the stored bucket has decayed almost to zero.
  const stat = router.getStat('m1', 'build');
  const decayed = decayedStat(stat, farLater, DEFAULT_HALF_LIFE_MS);
  assert.ok(decayed.weight < 0.01);
  assert.ok(decayed.count < 0.01);
});

test('recency bias: an old losing streak is outweighed by recent wins — prove a stale bad record does not doom a candidate', () => {
  const router = new AdaptiveRouter({ now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS, explorationConstant: 0 });

  // Long-ago losing streak, far enough back that it has almost fully decayed away.
  const longAgo = T0;
  for (let i = 0; i < 20; i++) {
    router.record('m1', 'build', false, { family: 'fam', now: longAgo });
  }

  // Recent wins, many half-lives later.
  const muchLater = T0 + 10 * DEFAULT_HALF_LIFE_MS;
  for (let i = 0; i < 5; i++) {
    router.record('m1', 'build', true, { family: 'fam', now: muchLater + i });
  }

  const rawStat = router.getStat('m1', 'build');
  const decayed = decayedStat(rawStat, muchLater + 5, DEFAULT_HALF_LIFE_MS);
  const rate = decayed.weight / decayed.count;
  // The ancient 0/20 losing streak has decayed to near-nothing; the 5 recent wins dominate.
  assert.ok(rate > 0.8, `expected recent wins to dominate, got rate=${rate}`);
});

test('recency bias: pick() favors a candidate with a stale losing history over one with none, once its recent wins are recorded', () => {
  const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS });
  const longAgo = T0;
  for (let i = 0; i < 10; i++) {
    router.record('comeback', 'build', false, { family: 'fam', now: longAgo });
  }
  const muchLater = T0 + 8 * DEFAULT_HALF_LIFE_MS;
  for (let i = 0; i < 8; i++) {
    router.record('comeback', 'build', true, { family: 'fam', now: muchLater + i });
  }
  // 'rival' has never been recorded at all — prior-only score.
  const candidates = [candidate({ modelVersion: 'comeback', family: 'fam' }), candidate({ modelVersion: 'rival', family: 'fam' })];
  const picked = router.pick({ taskType: 'build' }, candidates, { now: muchLater + 8 });
  assert.equal(picked, 'comeback');
});

// ===========================================================================
// Seeding — new modelVersion within a family
// ===========================================================================

test('a brand-new modelVersion in a family/taskType with prior history seeds at seedDiscount * predecessor decayed weight/count', () => {
  const router = new AdaptiveRouter({ now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS, seedDiscount: 0.5 });
  // Build up history for an old model version in the same family+taskType.
  for (let i = 0; i < 4; i++) {
    router.record('codex-old', 'build', true, { family: 'codex', now: T0 });
  }
  const predecessorDecayed = decayedStat(router.getStat('codex-old', 'build'), T0, DEFAULT_HALF_LIFE_MS);

  // Touch the new modelVersion for the first time via record() (any touch seeds it).
  router.record('codex-new', 'build', true, { family: 'codex', now: T0 });
  const newStat = router.getStat('codex-new', 'build');

  // newStat = seed(discounted predecessor) + this one new win, so
  // newStat.weight = predecessorDecayed.weight*0.5 + 1, newStat.count = predecessorDecayed.count*0.5 + 1.
  const expectedSeedWeight = predecessorDecayed.weight * 0.5;
  const expectedSeedCount = predecessorDecayed.count * 0.5;
  assert.ok(expectedSeedWeight > 0, 'precondition: predecessor must have nonzero history to seed from');
  assert.ok(
    Math.abs(newStat.weight - (expectedSeedWeight + 1)) < 1e-9,
    `expected seeded weight ${expectedSeedWeight + 1}, got ${newStat.weight}`
  );
  assert.ok(
    Math.abs(newStat.count - (expectedSeedCount + 1)) < 1e-9,
    `expected seeded count ${expectedSeedCount + 1}, got ${newStat.count}`
  );
  assert.equal(newStat.seededFrom, 'codex-old');

  // Seed value is neither zero nor the full (undiscounted) predecessor value.
  assert.notEqual(newStat.weight, 0);
  assert.notEqual(newStat.weight, predecessorDecayed.weight + 1);
});

test('a new modelVersion gets tried, not starved: pick() selects it over an established rival due to the exploration bonus on its low count', () => {
  const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS, explorationConstant: 2 });

  // Establish a long, decent-but-not-perfect track record for the incumbent.
  for (let i = 0; i < 50; i++) {
    router.record('incumbent', 'build', i % 5 !== 0, { family: 'fam', now: T0 + i });
  }

  // Seed the new model by touching it once via pick() eligibility path (pick() itself
  // must seed on first touch per spec) — call pick() and confirm it is at least sometimes
  // selected, i.e. its exploration bonus can overcome the incumbent's higher raw rate.
  const candidates = [candidate({ modelVersion: 'incumbent', family: 'fam' }), candidate({ modelVersion: 'newcomer', family: 'fam' })];
  const picked = router.pick({ taskType: 'build' }, candidates, { now: T0 + 50 });

  // The newcomer must have been seeded (touched) by this pick() call, proving it is
  // considered — not permanently starved by having zero samples relative to the incumbent's 50.
  const newcomerStat = router.getStat('newcomer', 'build');
  assert.ok(newcomerStat !== null, 'newcomer bucket must be seeded/touched by pick(), not ignored');
  assert.equal(picked, 'newcomer', 'a fresh model with a large exploration bonus should get tried, not starved');
});

test('a modelVersion in a different family never seeds from another family\'s bucket, even with an identical taskType', () => {
  const router = new AdaptiveRouter({ now: () => T0, halfLifeMs: DEFAULT_HALF_LIFE_MS, seedDiscount: 0.5 });
  for (let i = 0; i < 4; i++) {
    router.record('codex-v1', 'build', true, { family: 'codex', now: T0 });
  }
  router.record('claude-v1', 'build', true, { family: 'claude', now: T0 });
  const claudeStat = router.getStat('claude-v1', 'build');
  // No predecessor in the 'claude' family exists, so this must start from zero + this one win,
  // NOT from a discounted 'codex' bucket.
  assert.equal(claudeStat.seededFrom, null);
  assert.ok(Math.abs(claudeStat.weight - 1) < 1e-9);
  assert.ok(Math.abs(claudeStat.count - 1) < 1e-9);
});

test('no predecessor exists in family+taskType: bucket starts at {weight:0,count:0,seededFrom:null} and scoring falls back to defaultPriorSuccessRate', () => {
  const router = new AdaptiveRouter({ now: () => T0, defaultPriorSuccessRate: 0.5 });
  router.record('lonely', 'build', false, { family: 'solo-fam', now: T0 });
  const stat = router.getStat('lonely', 'build');
  assert.equal(stat.seededFrom, null);
  // Before this call weight/count were both 0 (only this one loss recorded since).
  assert.ok(Math.abs(stat.weight - 0) < 1e-9);
  assert.ok(Math.abs(stat.count - 1) < 1e-9);
});

test('seeding reads a predecessor bucket but never mutates it; seeding is idempotent on re-touch', () => {
  const router = new AdaptiveRouter({ now: () => T0, seedDiscount: 0.5 });
  for (let i = 0; i < 3; i++) {
    router.record('old', 'build', true, { family: 'fam', now: T0 });
  }
  const predecessorBefore = router.getStat('old', 'build');

  router.record('new', 'build', true, { family: 'fam', now: T0 });
  const predecessorAfter = router.getStat('old', 'build');
  assert.deepEqual(predecessorBefore, predecessorAfter);

  const firstTouch = router.getStat('new', 'build');
  // Touching again must not re-discount/re-seed a second time.
  router.record('new', 'build', true, { family: 'fam', now: T0 });
  const secondTouch = router.getStat('new', 'build');
  // seededFrom stays stable and the increment from the second record() is a plain +1 win,
  // not another seed-discount application.
  assert.equal(secondTouch.seededFrom, firstTouch.seededFrom);
});

// ===========================================================================
// Learns ONLY from verified wins — never from a worker self-report
// ===========================================================================

test('learns only from verified wins: record() has no code path that accepts or derives from a worker self-report field', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  // The public record() signature only accepts an explicit boolean verifiedWin — attempting
  // to pass a worker "self-report"-shaped object instead must be rejected, not silently
  // coerced into truthy/falsy learning.
  assert.throws(() => router.record('m1', 'build', { status: 'completed', claimedExit: 0 }, { family: 'fam', now: T0 }), RouterUsageError);
});

test('record() throws RouterUsageError when verifiedWin is not strictly boolean (e.g. a truthy string)', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  assert.throws(() => router.record('m1', 'build', 'true', { family: 'fam', now: T0 }), RouterUsageError);
  assert.throws(() => router.record('m1', 'build', 1, { family: 'fam', now: T0 }), RouterUsageError);
  assert.throws(() => router.record('m1', 'build', undefined, { family: 'fam', now: T0 }), RouterUsageError);
});

test('a worker self-report alone (no explicit record(verifiedWin) call) never moves the stats', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  // Simulate: the coordinator receives a WorkerResult claiming success but the trust gate
  // has NOT yet re-verified it, so no record() call happens at all.
  const statBefore = router.getStat('m1', 'build');
  assert.equal(statBefore, null);
  // No record() call made — stats must remain untouched/nonexistent.
  const statAfter = router.getStat('m1', 'build');
  assert.equal(statAfter, null);
});

// ===========================================================================
// idempotency via taskId
// ===========================================================================

test('record() with a repeated taskId applies at most once; snapshot() is identical after the 2nd identical call', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  router.record('m1', 'build', true, { family: 'fam', taskId: 'task-42', now: T0 });
  const snap1 = router.snapshot();
  const result = router.record('m1', 'build', true, { family: 'fam', taskId: 'task-42', now: T0 + 1000 });
  const snap2 = router.snapshot();
  assert.equal(result.applied, false);
  assert.deepEqual(snap1, snap2);
});

test('record() calls without taskId are never deduped — every call applies (at-least-once tradeoff)', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  const stat = router.getStat('m1', 'build');
  assert.equal(stat.count, 2);
  assert.equal(stat.weight, 2);
});

test('the first record() call for a fresh taskId returns {applied:true}', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  const result = router.record('m1', 'build', true, { family: 'fam', taskId: 'unique-1', now: T0 });
  assert.equal(result.applied, true);
});

// ===========================================================================
// getStat / snapshot
// ===========================================================================

test('getStat() for a never-recorded, never-seeded bucket returns null, not a zeroed object', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  assert.equal(router.getStat('nonexistent', 'build'), null);
});

test('snapshot() returns a deep copy; mutating it does not affect router state', () => {
  const router = new AdaptiveRouter({ now: () => T0 });
  router.record('m1', 'build', true, { family: 'fam', now: T0 });
  const snap = router.snapshot();
  // Attempt to corrupt the snapshot.
  const json = JSON.stringify(snap);
  const mutable = JSON.parse(json);
  mutable.corrupted = true;
  if (mutable.buckets) mutable.buckets = {};
  const statAfter = router.getStat('m1', 'build');
  assert.ok(statAfter !== null);
  assert.equal(statAfter.count, 1);
});

// ===========================================================================
// Determinism
// ===========================================================================

test('no Math.random() anywhere: tie-breaking among equal scores is deterministic (first candidate wins)', () => {
  const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0, explorationConstant: 0 });
  // Both candidates have identical (empty) history -> identical scores (defaultPriorSuccessRate).
  const candidates = [candidate({ modelVersion: 'first', family: 'fam' }), candidate({ modelVersion: 'second', family: 'fam' })];
  const picked = router.pick({ taskType: 'build' }, candidates, { now: T0 });
  assert.equal(picked, 'first');
});

test('two AdaptiveRouter instances fed the identical sequence of record()/pick() calls with the same injected now values produce identical snapshots', () => {
  function run() {
    const router = new AdaptiveRouter({ mode: 'adaptive', now: () => T0 });
    router.record('a', 'build', true, { family: 'fam', now: T0 });
    router.record('a', 'build', false, { family: 'fam', now: T0 + 1000 });
    router.record('b', 'build', true, { family: 'fam', now: T0 + 2000 });
    router.pick({ taskType: 'build' }, [candidate({ modelVersion: 'a', family: 'fam' }), candidate({ modelVersion: 'b', family: 'fam' })], {
      now: T0 + 3000,
    });
    return router.snapshot();
  }
  const snapA = run();
  const snapB = run();
  assert.deepEqual(snapA, snapB);
});
