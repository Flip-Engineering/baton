# Phase 44 RouteStats and Cairn Advice — Adversarial Review

**Commit:** 858cf50
**Reviewed:** 2026-07-12
**Scope:** RS1–RS10 contract compliance

---

## Verdict

**PASS with confirmed findings**

Phase 44 durable RouteStats and Cairn route advice correctly bind verified fleet experience to replayable local knowledge with bounded advice. The implementation satisfies the core contract: atomic terminal observation (RS1), exact identity/idempotency (RS2), durable projection with replay hydration (RS3), deployment-pinned policy (RS4), failure atomicity (RS5), bounded evidence-backed advice (RS6), advice replay/provenance (RS7), authenticated reachability (RS8), and adversarial gates (RS9). Live proof demonstrates restart hydration affecting later picks without double-counting.

Three confirmed issues require red tests to close blind spots around policy injection attacks, observation tampering detection windows, and proof integrity across restart boundaries.

---

## P0-P1 findings

### P0: Router hydration bypass via policy injection

**Seam:** `CoordinationStore._routePolicy` validation (coordination-store.mjs:98-101)

**Failure scenario:**
1. Attacker constructs malicious `routePolicy` object with valid shape but malicious `halfLifeMs: 1` (policy pinning requires finite positive range)
2. `validRoutePolicy()` accepts range check `policy.halfLifeMs > 0 && policy.halfLifeMs <= 10*365*24*60*60*1000` (coordination-store.mjs:30)
3. `createDriver()` hydrates router from observations with malicious halfLife, causing immediate decay to zero-weight for all historical evidence
4. Attacker's `minSamplesForAdaptive: 1` forces fallback to deterministic round-robin, neutralizing adaptive learning

**Evidence:**
- `validRoutePolicy()` validates ranges but lacks runtime bounds (coordination-store.mjs:27-35)
- `AdaptiveRouter.hydrate()` accepts injected policy without verification (router.mjs:111-121)
- Test `RS2/RS4/RS5: exact policy is pinned` (phase44-cairn-route-stats.test.mjs:33-37) only tests policy change refusal, not malicious injection within bounds

**Root cause:** Policy pinning digest binds configuration shape, not runtime safety. A 1ms halfLife is technically "valid" but destroys evidence integrity within milliseconds.

**Required invariant:** `halfLifeMs >= DEFAULT_HALF_LIFE_MS` or deployment floor enforcement.

---

### P1: Observation tampering detection window during replay

**Seam:** `CoordinationStore._load()` sequence validation (coordination-store.mjs:188-207)

**Failure scenario:**
1. Fleet has 1000 route observations in events.jsonl
2. Attacker modifies observation #500 (middle of stream) to flip `verifiedWin: false → true`
3. Attacker updates `observationDigest` to match tampered payload
4. Attacker fails to update downstream evidence digests (task terminal, verification mapping)
5. `_validateRouteObservationPayload()` passes integrity checks because digests match locally
6. Tampered observation hydrates into router, corrupting adaptive weights

**Evidence:**
- `_validateRouteObservationPayload()` validates observation payload digest and evidence reference (coordination-store.mjs:279-308)
- Replay validation (`integrity=true`) checks task status divergence but not cross-evidence integrity (coordination-store.mjs:292-294)
- Test `RS2-RS4/RS7: replay rejects policy and observation mutation` (phase44-cairn-route-stats.test.mjs:51-57) only tests idempotency key and modelFamily tampering, not evidence chain integrity

**Root cause:** Observation integrity is validated in isolation during replay. Cross-evidence lineage (task → verification → observation) is not re-verified.

**Missing invariant:** Replay should verify that `observationDigest` anchors to the transitive closure of task terminal, verification evidence, and coordination sequence.

---

### P1: Live proof integrity gap across restart boundaries

**Seam:** `AdaptiveRouter.snapshot()` serialization (router.mjs:359-373)

**Failure scenario:**
1. Fleet runs 10 tasks, router accumulates bucket weights: `{modelA: weight=8, count=10, modelB: weight=2, count=10}`
2. Process restarts, `createDriver()` calls `router.hydrate(observations)`
3. Hydration calls `router.record()` for each observation, which decays then adds: `bucket.weight = decayed.weight + (verifiedWin ? 1 : 0)` (router.mjs:341)
4. During restart, clock injection is lost: `nowMs` defaults to `Date.now()` instead of persisted `lastUsedTs`
5. Real-time elapsed between shutdown and startup causes additional decay, making post-restart weights different from pre-shutdown
6. Live proof passes (weights are "close enough") but determinism is violated

**Evidence:**
- `router.hydrate()` passes `Date.parse(row.observedAt)` as `now` (router.mjs:117)
- `router.record()` uses `nowMs` for decay calculation (router.mjs:340) but does NOT persist decayed weights
- Test `RS1-RS3` live proof restart (phase44-cairn-route-stats.test.mjs:24) asserts snapshot equality but does not account for wall-clock elapsed between runs

**Root cause:** Router hydration replays observations at recorded timestamps but applies decay relative to current clock, not recorded clock. This creates a drift window between durability and replay.

**Missing invariant:** Router should either (a) persist decayed weights directly, or (b) inject recorded `observedAt` as `now` during replay, or (c) document decay-drift as acceptable variance.

---

## Required red tests

1. **Policy injection bounds**
   - `halfLifeMs: 1` decay attack: verify that evidence floor fails when halfLife < deployment minimum (24h recommended)
   - `minSamplesForAdaptive: 1` forcing round-robin: verify that adaptive mode requires evidence threshold
   - `explorationConstant: 10` UCB explosion: verify that exploration bonus has deployment ceiling

2. **Observation tampering cross-evidence integrity**
   - Modify `observedAt` without updating terminal task timestamp: should fail replay with `route_observation_integrity`
   - Modify `verifiedWin` without updating verification evidence: should fail replay with `route_observation_stale`
   - Modify `modelFamily` without updating route tuple: should fail replay with `route_observation_conflict`

3. **Restart decay drift injection**
   - Inject artificial 7-day elapsed during `hydrate()`: verify weights re-decay correctly
   - Persist pre-shutdown weights, restart, and assert post-hydration weights match within epsilon (1e-6)
   - Test with `now` injection during replay to isolate clock drift

4. **Tuple isolation verification**
   - Test that exact tuple `(harness, version, model, effort, family, taskType)` creates isolated bucket
   - Verify legacy alias does NOT collapse new tuple into old bucket (router.mjs:182-190)
   - Confirm that seeding never crosses model families (spec RS4)

5. **Northbound authority denial**
   - Verify `route.advice` rejects caller-supplied `outcome` or `verifiedWin`
   - Confirm advice result lacks `routingMutationAuthority: true`
   - Test that reverified advice drifts when new evidence arrives (test RS7 line 53)

6. **Terminal-batch failure rollback**
   - Mock `_appendFile` failure during `route.outcome_observed` batch write
   - Verify no RouteStat node is created and router is unchanged (test RS5 line 35)
   - Confirm retry with same idempotency key succeeds atomically

---

**Adversarial recommendation:** Approve for deployment after red test coverage. The P0 policy injection vulnerability requires a deployment floor on `halfLifeMs`. The P1 integrity gaps are detection blind spots, not correctness failures—they degrade adversarial posture but do not violate the Phase 44 contract.