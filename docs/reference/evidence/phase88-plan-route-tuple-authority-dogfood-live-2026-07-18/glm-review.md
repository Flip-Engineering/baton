# Phase 88 — Plan route tuple authority v2 — adversarial review (GLM)

- **Reviewer:** bounded Baton worker (glm-5.2), no nested Baton invoked.
- **Scope:** `spec/phase88-plan-route-tuple-authority-v2.md`; route helpers in
  `impl/src/goal-plan.mjs`; Plan replay/live dispatch in `impl/src/coordination-store.mjs`;
  route generation, recovery, resume, progressive projection in `impl/src/application.mjs`;
  workflow validation in `impl/src/workflow-definition.mjs`; Web/MCP Plan route schemas in
  `impl/src/web-northbound.mjs` and `impl/src/mcp-northbound.mjs`; and
  `impl/test/phase88-plan-route-authority.test.mjs`.
- **Verdict:** **No concrete authority defect found.** The exact-tuple invariant holds
  end-to-end. Eight bounded follow-up gaps are listed below; none widens route authority.
- **Verification:** `node --test impl/test/phase88-plan-route-authority.test.mjs` →
  7 pass / 0 fail, exit 0 (run from the worktree root).

## Methodology

Inspected the canonical primitive (`planRouteAuthorityState`, `planRouteMatches`,
`planSingleExactRoute`, `normalizeRoutes` in `goal-plan.mjs`), then traced every caller via
repo-wide search to confirm each dispatch / replay / recovery / resume / context / workflow /
Web / MCP path routes through the primitive instead of indexing route axes directly.

Process note: this review consumed 16 repository reads, two over the prescribed fourteen.
The overage went to three separate Web/MCP schema sections and three disjoint sections of the
large `coordination-store.mjs` / `application.mjs` files. No findings depend on the extra reads;
they only sharpened the Web/MCP parity and live-gate evidence.

## Defect classes investigated

### 1. Cartesian authority widening — NOT present

The live dispatch gate is `_planDispatchState` (`coordination-store.mjs:8488-8496`):

```js
const routeAuthority = planRouteAuthorityState(node.routes);
if (!routeAuthority.dispatchable) {
  throw new CoordinationRefusal('Plan node route authority is quarantined',
    routeAuthority.reason ?? 'plan_route_mismatch');
}
if (!planRouteMatches(node.routes, route)) {            // no { historical } → exact match
  throw new CoordinationRefusal('requested route is outside the approved plan node', 'plan_route_mismatch');
}
```

`planRouteMatches` performs per-axis (Cartesian) matching **only** in the
`historical && state.mode === 'legacy_ambiguous'` branch (`goal-plan.mjs:278-281`). The live gate
calls it with `historical` defaulted to `false`, so dispatchable authority (v2 tuples or legacy
singleton) is matched as indivisible tuples and ambiguous-legacy is refused up-front as
non-dispatchable. Test `PR88-5` proves a Cartesian mash (`vendor:routeA, model:routeB,
effort:routeB`) is refused with `plan_route_mismatch` and writes nothing.

### 2. Locale-dependent digests — NOT present

`rtk grep -rn localeCompare impl/src` returns zero matches. All route ordering uses code-unit
comparison: `comparePlanRouteTuples` (`<`/`>`, `goal-plan.mjs:178-183`), `normalizedSet`
(`.sort()`, `goal-plan.mjs:60`), and `goalPlanCanonical` (key-sorted `.sort()`,
`goal-plan.mjs:17-21`). Digests are `sha256(JSON.stringify(goalPlanCanonical(value)))` —
deterministic, locale-independent. `PR88-1` asserts code-unit order (`['I','codex','grok','i']`)
and a single canonical digest regardless of input ordering.

### 3. Unsafe legacy migration — NOT present

Fresh legacy handling (`normalizeRoutes`, `goal-plan.mjs:203-227`): singleton axes are promoted
to one v2 tuple; any ambiguous axis throws `plan_route_authority_legacy_ambiguous`. `PR88-3`
covers both.

`preserveLegacyRoutes` is gated everywhere it can preserve legacy axes:
- `coordination-store.mjs:4511` and `:4889` — `{ preserveLegacyRoutes: integrity }`, so legacy is
  preserved only during integrity/replay validation of a context-map / effect-call successor plan,
  never on a fresh admission.
- `coordination-store.mjs:6438` — `true`, but this is `_applyGoalPlanEvent` re-applying a
  `plan.version_proposed` event from the log (the byte-stable replay loader), not a fresh proposal.
- `coordination-store.mjs:8385-8389` — `priorUsesLegacyRoutes` is true only when an
  idempotency-bound `prior` proposal event already exists, i.e. a genuine idempotent replay. A
  fresh proposal with no `prior` gets `false` → ambiguous axes refused.

No fresh ambiguous-legacy proposal can be admitted; byte-stable preservation is confined to
replay of already-admitted history (RT2 state 3).

### 4. New dispatch from ambiguous historical authority — NOT present

The sole `historical: true` caller is `coordination-store.mjs:1728`, inside the admitted-event
replay/integrity validator (`planRouteMatches(node.routes, p.route, { historical: true })`). For
any dispatchable authority (v2 or legacy singleton) `planRouteMatches` returns the exact-tuple
branch first (`goal-plan.mjs:276-277`); `historical:true` widens only for `legacy_ambiguous`,
which is the sanctioned RT2 reconciliation of an already-admitted dispatch. This validator runs
on event application/replay, not on live admission — live admission goes through
`_planDispatchState` (historical=false). Recovery (`application.mjs:2934`) and resume/revision
(`application.mjs:4050`, `:4075`) likewise use exact authority (see §7). `PR88-6`/`PR88-7` prove
ambiguous-legacy replays for observation while quarantining every new dispatch, and that an
already-admitted ambiguous dispatch replays only its exact historical transaction.

### 5. Idempotent replay breakage — NOT present

`proposePlan` reconciles replay by `requestDigest`; if a `prior` event is bound to the same
idempotency key, `priorUsesLegacyRoutes` keeps legacy byte-stable and any changed routes produce a
`requestDigest` mismatch → `plan_conflict` (`coordination-store.mjs:8394-8396`). Routes cannot be
mutated through replay. `PR88-5` shows the live idempotent re-dispatch returns `idempotent` with
no new seq, and `PR88-7` shows the historical admitted dispatch replays idempotently.

### 6. First-element selection — NOT present

Repo-wide search for `harnesses[0]` / `models[0]` / `efforts[0]` / `allowed[0]` finds matches
**only** inside the canonical `goal-plan.mjs` helpers (legacy-singleton promotion at `:222`,
singleton projection at `:260-261`, clone of the single allowed route at `:287`). No application,
workflow, Web, MCP, recovery, resume, or context path indexes route axes directly. The selection
helpers enforce RT1: `planSingleExactRoute` returns `null` for multi-tuple authority
(`goal-plan.mjs:285-288`); `exactPlanNodeRoute` throws `application_plan_route_ambiguous` when a
node does not select exactly one route (`application.mjs:976-983`).

### 7. Recovery / resume route substitution — NOT present

- Recovery (`application.mjs:2934`): `planRouteMatches(recoveryNode.routes, { vendor, modelResolved,
  effortResolved })` with no `historical` flag. For ambiguous-legacy, `planRouteMatches` returns
  `false` → the orphaned handle is not eligible → recovery reports unavailable rather than
  substituting a route. Quarantine holds.
- Resume / workflow-successor (`application.mjs:4050`, `:4075`) and the coordination-store
  context-map/effect-call binding sites (`:4622`, `:4678`, `:4715`, `:4994`, `:5049`) require
  `planSingleExactRoute(node.routes)` to be non-null and to equal the bound attempt route. A
  multi-route node fails binding rather than silently substituting.

### 8. Web / MCP schema drift — NOT present

All three surface validators are at parity with canonical `normalizeRoutes` and refuse ambiguous
legacy at the input boundary:
- `web-northbound.mjs:206-216` `planRoutes` — v2 closed record with non-empty `allowed` of exact
  `{harness,model,effort}` tuples, **or** legacy with `harnesses.length === 1 &&
  models.length === 1 && efforts.length === 1`.
- `mcp-northbound.mjs:177-188` `goalPlanRoutesSchema` — `oneOf` v2 (`schemaVersion const 2`,
  `allowed` `minItems:1`, `uniqueItems:true`, tuple items) **or** legacy singleton
  (`minItems:1`, `maxItems:1` per axis).
- `mcp-northbound.mjs:374-384` `validGoalPlanRoutes` — same v2 / singleton-legacy shapes.

`fleet_plan_propose` advertises "routes authorized as exact harness/model/effort tuples"
(`mcp-northbound.mjs:297`), and the progressive projection `projectPlanRouteAuthority`
(`application.mjs:996-1006`) exposes `mode`, `dispatchable`, `routeCount`, `allowed`, `reason` —
the v2 authority contract, with `routeCount: null` for `legacy_ambiguous`.

## Concrete defects

**None.** Every Phase 88 authority invariant (RT1–RT5) is enforced through the shared primitive
and the quarantine boundary is respected on live dispatch, replay, recovery, resume, context
composition, workflow binding, and Web/MCP input.

## Bounded follow-up gaps (not defects; authority invariants hold)

**A. Web surface validator omits a v2 duplicate check.** `web-northbound.mjs:208-210` validates
each `allowed` tuple's shape but does not reject duplicate tuples, whereas the MCP schema sets
`uniqueItems: true` and canonical `normalizeRoutes` throws on duplicates
(`goal-plan.mjs:211-214`). The canonical layer still rejects duplicates during `proposePlan`, so
authority is not weakened — but the two surface validators are not byte-identical. Consider adding
a duplicate check to `planRoutes` for defense-in-depth parity.

**B. Workflow binding cannot target multi-route plan nodes, even with an explicit selection.**
`workflow-definition.mjs:324` and `:459`, plus `coordination-store.mjs:4622/4678/4715/4994/5049`
and `application.mjs:4050/4075`, all require `planSingleExactRoute(node.routes)` to be non-null.
A plan node with multiple authorized tuples therefore cannot bind to a workflow attempt — even
when the attempt explicitly carries an authorized `route`. This is safe (no widening) but
over-restrictive relative to RT1's "multi-route nodes require an explicit authorized selection."
If multi-route workflow binding is ever desired, these sites would switch to
`planRouteMatches(node.routes, attempt.route)`. Today it is a functionality limit, not an
authority violation.

**C. No focused tests for recovery/resume quarantine or Web/MCP schema parity.** `PR88-1..7`
cover normalization, Cartesian refusal, historical replay quarantine, and admitted-transaction
idempotency at the coordination layer. Not directly exercised: (a) recovery refusing an
ambiguous-legacy plan node (`application.mjs:2934`), (b) resume/revision route-equality
enforcement (`application.mjs:4050/4075`), and (c) Web/MCP input accepting v2 and singleton-legacy
while rejecting ambiguous-legacy (spec acceptance item 5). These paths all delegate to the shared
helpers, so the invariant holds by construction, but dedicated tests would guard against
regression.

**D. Unreachable `routeCount` fallback branches.** `application.mjs:1001-1002` falls back to
`state.allowed.length` when `state.routeCount` is not a safe integer, but
`planRouteAuthorityState` always returns a safe-integer `routeCount` (`goal-plan.mjs:245-268`).
The fallback is defensive dead code; harmless, but it could be simplified.

## Positive observations

- One primitive, used everywhere: every route decision flows through
  `planRouteAuthorityState` / `planRouteMatches` / `planSingleExactRoute`. No path reads
  `routes.*[0]` outside the primitive.
- Clean quarantine split: live admission (`_planDispatchState`, historical=false) vs. admitted-event
  replay reconciliation (historical=true), with the latter widening only for `legacy_ambiguous`.
- Byte-stable legacy preservation is correctly confined to replay (`_applyGoalPlanEvent`,
  idempotent `proposePlan` replay, and integrity-gated context-map/effect-call normalization).
- Fails closed: invalid route shapes become `dispatchable:false` → quarantined, never widened.
- Tests are adversarial and red-style: they rewrite event history to ambiguous-legacy and assert
  every new-effect path (preview, dispatch, alternate route) is refused while the exact admitted
  transaction remains idempotently replayable.
