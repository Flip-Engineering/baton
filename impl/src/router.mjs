/**
 * router.mjs — adaptive, recency-biased routing (docs/20-adaptive-routing.md).
 *
 * Tracks a decayed success rate + decayed evidence count per
 * (family, modelVersion, taskType) bucket. `pick()` selects the best
 * eligible candidate (round-robin with no history, else argmax of
 * recent-success + exploration bonus), respecting concurrency ceilings.
 * `record()` updates a bucket with recency weighting, learning ONLY from a
 * caller-asserted, strictly-boolean `verifiedWin` — never from a worker's
 * self-report. A brand-new modelVersion seeds from a discounted predecessor
 * in the same family+taskType (tried, not starved).
 *
 * Zero dependencies. No Math.random() anywhere — the only non-determinism
 * is real wall-clock time, always overridable via an injected `now`.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RouterUsageError extends Error {}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_HALF_LIFE_MS = 604_800_000; // 7 days
export const DEFAULT_EXPLORATION_CONSTANT = 0.5;
export const DEFAULT_SEED_DISCOUNT = 0.5;
export const DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE = 5;
export const DEFAULT_PRIOR_SUCCESS_RATE = 0.5;
const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pure. Projects a stored stat forward/decayed to `nowMs`, never mutating it.
 * @param {{weight:number,count:number,lastUsedTs:number}|null} stat
 * @param {number} nowMs
 * @param {number} halfLifeMs
 * @returns {{weight:number, count:number}}
 */
export function decayedStat(stat, nowMs, halfLifeMs) {
  if (!stat) return { weight: 0, count: 0 };
  const elapsed = nowMs - stat.lastUsedTs;
  const factor = Math.pow(2, -elapsed / halfLifeMs);
  return { weight: stat.weight * factor, count: stat.count * factor };
}

/**
 * Pure. Score = rate + exploration bonus.
 * @param {{weight:number,count:number}} decayed
 * @param {number} totalDecayedCount
 * @param {{explorationConstant?:number, defaultPriorSuccessRate?:number}} [opts]
 * @returns {number}
 */
export function scoreCandidate(decayed, totalDecayedCount, opts = {}) {
  const explorationConstant = opts.explorationConstant ?? DEFAULT_EXPLORATION_CONSTANT;
  const defaultPriorSuccessRate = opts.defaultPriorSuccessRate ?? DEFAULT_PRIOR_SUCCESS_RATE;
  const rate = decayed.count > 0 ? decayed.weight / decayed.count : defaultPriorSuccessRate;
  const bonus = explorationConstant * Math.sqrt(Math.log(totalDecayedCount + 1) / (decayed.count + EPSILON));
  return rate + bonus;
}

function bucketKey(family, modelVersion, taskType) {
  return `${family}::${modelVersion}::${taskType}`;
}

// ---------------------------------------------------------------------------
// AdaptiveRouter
// ---------------------------------------------------------------------------

export class AdaptiveRouter {
  /**
   * @param {{mode?:'round-robin'|'adaptive'|'auto', halfLifeMs?:number,
   *   explorationConstant?:number, seedDiscount?:number, minSamplesForAdaptive?:number,
   *   defaultPriorSuccessRate?:number, now?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'auto';
    this.halfLifeMs = opts.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.explorationConstant = opts.explorationConstant ?? DEFAULT_EXPLORATION_CONSTANT;
    this.seedDiscount = opts.seedDiscount ?? DEFAULT_SEED_DISCOUNT;
    this.minSamplesForAdaptive = opts.minSamplesForAdaptive ?? DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE;
    this.defaultPriorSuccessRate = opts.defaultPriorSuccessRate ?? DEFAULT_PRIOR_SUCCESS_RATE;
    this._now = opts.now ?? (() => Date.now());

    /** @type {Map<string, {modelVersion:string, taskType:string, family:string, weight:number, count:number, lastUsedTs:number, firstSeenTs:number, seededFrom:string|null}>} */
    this._buckets = new Map();
    /** @type {Set<string>} applied taskIds, for record() idempotency */
    this._appliedTaskIds = new Set();
    /** @type {Map<string, number>} round-robin cursor per taskType */
    this._rrCursor = new Map();
  }

  _resolveNow(optsNow) {
    return optsNow ?? this._now();
  }

  policy() {
    return {
      mode: this.mode, halfLifeMs: this.halfLifeMs, explorationConstant: this.explorationConstant,
      seedDiscount: this.seedDiscount, minSamplesForAdaptive: this.minSamplesForAdaptive,
      defaultPriorSuccessRate: this.defaultPriorSuccessRate,
    };
  }

  /** Hydrate a fresh router from coordination-ordered verified outcomes. */
  hydrate(observations) {
    if (!Array.isArray(observations) || this._buckets.size > 0 || this._appliedTaskIds.size > 0) throw new RouterUsageError('hydrate() requires a fresh router and ordered observations');
    let priorSeq = 0;
    for (const row of observations) {
      if (!row || !Number.isSafeInteger(row.eventSeq) || row.eventSeq <= priorSeq || typeof row.taskId !== 'string' || typeof row.routeKey !== 'string' || typeof row.taskType !== 'string' || typeof row.modelFamily !== 'string' || typeof row.verifiedWin !== 'boolean' || !Number.isFinite(Date.parse(row.observedAt))) throw new RouterUsageError('hydrate() received an invalid route observation');
      priorSeq = row.eventSeq;
      const applied = this.record(row.routeKey, row.taskType, row.verifiedWin, { family: row.modelFamily, taskId: row.taskId, now: Date.parse(row.observedAt) });
      if (!applied.applied) throw new RouterUsageError('hydrate() received a duplicate task observation');
    }
    return { applied: observations.length };
  }

  /**
   * Find the most-recently-used bucket for the same family+taskType, excluding
   * `excludeModelVersion`. Read-only.
   */
  _findPredecessor(family, taskType, excludeModelVersion) {
    let best = null;
    for (const bucket of this._buckets.values()) {
      if (bucket.family !== family || bucket.taskType !== taskType) continue;
      if (bucket.modelVersion === excludeModelVersion) continue;
      if (!best || bucket.lastUsedTs > best.lastUsedTs) best = bucket;
    }
    return best;
  }

  /**
   * Ensure a bucket exists for (family, modelVersion, taskType), seeding it
   * from a same-family+taskType predecessor on first touch. Never mutates
   * the predecessor. Idempotent — a second touch never re-seeds.
   */
  _ensureBucket(family, modelVersion, taskType, nowMs) {
    const key = bucketKey(family, modelVersion, taskType);
    let bucket = this._buckets.get(key);
    if (bucket) return bucket;

    const predecessor = this._findPredecessor(family, taskType, modelVersion);
    if (predecessor) {
      const decayed = decayedStat(predecessor, nowMs, this.halfLifeMs);
      bucket = {
        modelVersion,
        taskType,
        family,
        weight: decayed.weight * this.seedDiscount,
        count: decayed.count * this.seedDiscount,
        lastUsedTs: nowMs,
        firstSeenTs: nowMs,
        seededFrom: predecessor.modelVersion,
      };
    } else {
      bucket = {
        modelVersion,
        taskType,
        family,
        weight: 0,
        count: 0,
        lastUsedTs: nowMs,
        firstSeenTs: nowMs,
        seededFrom: null,
      };
    }
    this._buckets.set(key, bucket);
    return bucket;
  }

  /**
   * Resolve read-only routing evidence for a candidate. Exact tuple evidence
   * always wins. Legacy aliases are consulted only when that tuple has never
   * been recorded, so upgrades retain useful history without collapsing new
   * harness/model/effort buckets back together.
   */
  _candidateBucket(candidate, taskType) {
    const exact = this._buckets.get(bucketKey(candidate.family, candidate.modelVersion, taskType));
    if (exact) return exact;
    for (const alias of candidate.legacyModelVersions ?? []) {
      const legacy = this._buckets.get(bucketKey(candidate.family, alias, taskType));
      if (legacy) return legacy;
    }
    return null;
  }

  /**
   * @param {{taskType:string}} task
   * @param {RouteCandidate[]} candidates
   * @param {{now?:number}} [opts]
   * @returns {string|null}
   */
  pick(task, candidates, opts = {}) {
    const nowMs = this._resolveNow(opts.now);
    const taskType = task.taskType;

    const eligible = candidates.filter((c) => c.inFlight < c.concurrencyCeiling);
    if (eligible.length === 0) return null;

    const effectiveMode = this._effectiveMode(taskType, eligible, nowMs);

    if (effectiveMode === 'round-robin') {
      return this._pickRoundRobin(taskType, eligible);
    }

    return this._pickAdaptive(taskType, eligible, nowMs);
  }

  _effectiveMode(taskType, eligible, nowMs) {
    if (this.mode === 'round-robin') return 'round-robin';
    if (this.mode === 'adaptive') return 'adaptive';
    // mode === 'auto'
    const totalDecayedCount = eligible.reduce((sum, c) => {
      const bucket = this._candidateBucket(c, taskType);
      return sum + decayedStat(bucket, nowMs, this.halfLifeMs).count;
    }, 0);
    return totalDecayedCount < this.minSamplesForAdaptive ? 'round-robin' : 'adaptive';
  }

  _pickRoundRobin(taskType, eligible) {
    const cursor = this._rrCursor.get(taskType) ?? 0;
    const idx = cursor % eligible.length;
    this._rrCursor.set(taskType, cursor + 1);
    return eligible[idx].modelVersion;
  }

  _pickAdaptive(taskType, eligible, nowMs) {
    // Touch (seed, without mutating storage beyond the seed-on-first-touch
    // semantics already defined in _ensureBucket) each eligible candidate's
    // bucket so scoring/seeding is consistent, then score using decayed
    // projections read at `nowMs`.
    const decoratedCandidates = eligible.map((c) => {
      const bucket = this._candidateBucket(c, taskType)
        ?? this._ensureBucket(c.family, c.modelVersion, taskType, nowMs);
      return { candidate: c, bucket };
    });

    const totalDecayedCount = decoratedCandidates.reduce(
      (sum, { bucket }) => sum + decayedStat(bucket, nowMs, this.halfLifeMs).count,
      0
    );

    let best = null;
    let bestScore = -Infinity;
    for (const { candidate, bucket } of decoratedCandidates) {
      const decayed = decayedStat(bucket, nowMs, this.halfLifeMs);
      // A candidate whose own decayed evidence (real or seeded-from-a-
      // predecessor) hasn't yet reached minSamplesForAdaptive is not "known"
      // enough to trust with a differentiated exploration-bonus score — it
      // scores flat at the prior. Without this gate a freshly-seeded sibling
      // (same rate as its predecessor, but a smaller discounted count) would
      // ALWAYS out-score a mature candidate purely from the UCB-style bonus
      // being monotonically larger at lower counts, which would make a
      // same-family newcomer beat an established performer on every single
      // pick — not the intended "tried, not starved" behavior once a
      // candidate is genuinely well-evidenced (see D5, where the newcomer's
      // seeded count comfortably clears this bar and wins on its own merit).
      //
      // The threshold comparison is EPSILON-tolerant: real-clock decay between
      // when evidence was record()ed and when pick() is later called (even a
      // single elapsed millisecond) shaves a physically-insignificant sliver
      // off decayed.count. Without this tolerance, a candidate that reached
      // exactly minSamplesForAdaptive real (undecayed) samples could
      // nondeterministically flip below the "well-evidenced" bar purely from
      // wall-clock jitter between record() and pick() — the same real
      // evidence must always classify the same way.
      const score =
        decayed.count < this.minSamplesForAdaptive - EPSILON
          ? this.defaultPriorSuccessRate
          : scoreCandidate(decayed, totalDecayedCount, {
              explorationConstant: this.explorationConstant,
              defaultPriorSuccessRate: this.defaultPriorSuccessRate,
            });
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best ? best.modelVersion : null;
  }

  /** Pure read-only advice over a closed candidate set. It never advances round-robin state or
   * materializes prospective seed buckets. */
  advice(task, candidates, opts = {}) {
    const nowMs = this._resolveNow(opts.now); const taskType = task?.taskType;
    if (typeof taskType !== 'string' || !Array.isArray(candidates)) throw new RouterUsageError('advice() requires a task type and candidate list');
    const eligible = candidates.filter((candidate) => candidate.inFlight < candidate.concurrencyCeiling);
    const effectiveMode = eligible.length === 0 ? (this.mode === 'auto' ? 'round-robin' : this.mode) : this._effectiveMode(taskType, eligible, nowMs);
    const projected = candidates.map((candidate) => {
      let bucket = this._candidateBucket(candidate, taskType); let seededFrom = bucket?.seededFrom ?? null;
      if (!bucket) {
        const predecessor = this._findPredecessor(candidate.family, taskType, candidate.modelVersion);
        if (predecessor) { const prior = decayedStat(predecessor, nowMs, this.halfLifeMs); bucket = { ...predecessor, modelVersion: candidate.modelVersion, weight: prior.weight * this.seedDiscount, count: prior.count * this.seedDiscount, lastUsedTs: nowMs, firstSeenTs: nowMs, seededFrom: predecessor.modelVersion }; seededFrom = predecessor.modelVersion; }
      }
      const decayed = decayedStat(bucket, nowMs, this.halfLifeMs); const rate = decayed.count > 0 ? decayed.weight / decayed.count : this.defaultPriorSuccessRate;
      return { candidate, bucket, seededFrom, decayed, rate, eligible: candidate.inFlight < candidate.concurrencyCeiling };
    });
    const eligibleRows = projected.filter((row) => row.eligible); const totalDecayedCount = eligibleRows.reduce((sum, row) => sum + row.decayed.count, 0); let selected = null; let bestScore = -Infinity;
    if (effectiveMode === 'round-robin' && eligibleRows.length > 0) selected = eligibleRows[(this._rrCursor.get(taskType) ?? 0) % eligibleRows.length].candidate.modelVersion;
    else for (const row of eligibleRows) {
      const score = row.decayed.count < this.minSamplesForAdaptive - EPSILON ? this.defaultPriorSuccessRate : scoreCandidate(row.decayed, totalDecayedCount, { explorationConstant: this.explorationConstant, defaultPriorSuccessRate: this.defaultPriorSuccessRate });
      if (score > bestScore) { bestScore = score; selected = row.candidate.modelVersion; }
    }
    return {
      mode: effectiveMode, selected,
      rows: projected.map((row) => {
        const score = !row.eligible ? null : effectiveMode === 'round-robin' ? null : row.decayed.count < this.minSamplesForAdaptive - EPSILON ? this.defaultPriorSuccessRate : scoreCandidate(row.decayed, totalDecayedCount, { explorationConstant: this.explorationConstant, defaultPriorSuccessRate: this.defaultPriorSuccessRate });
        return { modelVersion: row.candidate.modelVersion, family: row.candidate.family, eligible: row.eligible, weight: row.decayed.weight, count: row.decayed.count, rate: row.rate, score, seededFrom: row.seededFrom, selected: row.candidate.modelVersion === selected, reason: !row.eligible ? 'concurrency_saturated' : row.candidate.modelVersion === selected ? (effectiveMode === 'round-robin' ? 'round_robin_selected' : 'highest_adaptive_score') : (effectiveMode === 'round-robin' ? 'round_robin_not_selected' : 'lower_adaptive_score') };
      }),
    };
  }

  /**
   * @param {string} modelVersion @param {string} taskType @param {boolean} verifiedWin
   * @param {{family?:string, taskId?:string, now?:number}} [opts]
   * @returns {{applied:boolean}}
   */
  record(modelVersion, taskType, verifiedWin, opts = {}) {
    if (verifiedWin !== true && verifiedWin !== false) {
      throw new RouterUsageError(
        `record() requires a strictly boolean verifiedWin (a caller-verified trust-gate result), got: ${JSON.stringify(verifiedWin)}`
      );
    }
    const family = opts.family ?? 'default';
    const nowMs = this._resolveNow(opts.now);

    if (opts.taskId !== undefined) {
      if (this._appliedTaskIds.has(opts.taskId)) {
        return { applied: false };
      }
      this._appliedTaskIds.add(opts.taskId);
    }

    const bucket = this._ensureBucket(family, modelVersion, taskType, nowMs);
    const decayed = decayedStat(bucket, nowMs, this.halfLifeMs);
    bucket.weight = decayed.weight + (verifiedWin ? 1 : 0);
    bucket.count = decayed.count + 1;
    bucket.lastUsedTs = nowMs;

    return { applied: true };
  }

  /** @param {string} modelVersion @param {string} taskType @returns {RouteStat|null} */
  getStat(modelVersion, taskType) {
    for (const bucket of this._buckets.values()) {
      if (bucket.modelVersion === modelVersion && bucket.taskType === taskType) {
        return { ...bucket };
      }
    }
    return null;
  }

  /** @returns {Object} plain deep-copy snapshot */
  snapshot() {
    const buckets = {};
    for (const [key, bucket] of this._buckets) buckets[key] = { ...bucket };
    return {
      mode: this.mode,
      halfLifeMs: this.halfLifeMs,
      explorationConstant: this.explorationConstant,
      seedDiscount: this.seedDiscount,
      minSamplesForAdaptive: this.minSamplesForAdaptive,
      defaultPriorSuccessRate: this.defaultPriorSuccessRate,
      buckets,
      appliedTaskIds: [...this._appliedTaskIds].sort(),
      rrCursor: Object.fromEntries(this._rrCursor),
    };
  }
}
