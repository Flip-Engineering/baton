# Phase 44 Cairn durable RouteStats and route advice — 2026-07-12

## Shipped checkpoint

RS1–RS10 close Cairn Rung 1 and the in-memory adaptive-router gap. An opt-in
`createDriver({routeLearningPolicy})` pins exact mode, decay, exploration, seeding, evidence-floor,
and prior-rate fields. A custom router/store must agree with that policy; replay refuses a changed
deployment rather than silently reinterpreting history.

The hub's terminal trust transaction now appends one `route.outcome_observed` only for an
authoritative `verify.reverified` result. Task/version/class/run, exact harness/version/model/effort
tuple, requested/resolved/observed attribution, family, outcome, evidence, event time, policy, and
digest are bound atomically with the task transition and artifact manifests. Worker claims and
pre-verification cancellation contribute nothing; a verified failed check contributes one loss.
Same-key exact retry is zero-effect, while changed terminal, evidence, artifact, or route bytes
refuse. Batch failure updates neither durable state nor the live router.

Each observation projects an immutable verified `RouteStat` node plus `ObservedIn` task lineage.
Startup validates the full event/evidence/task/tuple/time chain, claims the writer lease, hydrates a
fresh router in coordination order, and only then permits dispatch. Task IDs prevent double-counting.

Cairn optionally advertises bounded `route.advice`. Its closed input is one task class plus exact
candidate tuples and current concurrency. Callers cannot provide outcomes, weights, counts, policy,
scores, or selection. The result is a deterministic evidence snapshot with effective mode, selected
eligible tuple, counts/rates/scores/seeding, policy digest, and observation high-water. Advice does
not advance round-robin state or materialize seed buckets, grants no mutation authority, and is
available through the existing direct, authenticated web, and MCP ACI path.

## Verification and live proof

- Phase 44's five grouped adversarial contracts pass **5/5**; the combined router, Cairn, Phase 44,
  web, and MCP gate passes **86/86**.
- The canonical suite passes **978/978** after exact-retry hardening.
- `docs/reference/evidence/phase44-route-stats-live-2026-07-12/summary.json` passes all ten checks:
  two distinct exact tuples, one verified win and loss, atomic graph promotion, writer release,
  byte-identical restart hydration, adaptive advice/pick from durable evidence, read-only advice,
  no replay double-count, and full fleet reap.
- Recomputed-digest outcome tampering still fails the authoritative replay chain. Hydration remains
  byte-identical when the injected restart clock jumps seven days because each observation replays
  at its persisted `observedAt`.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton/GLM review

`docs/reference/evidence/phase44-route-stats-review-2026-07-12/summary.json` records exact
credentialed `glm` / `glm-4.7` / `low` routing on native PID `85358` against clean commit `858cf50`.
The worker used 82,208 tokens and $0.62141, fresh-verified its bounded report, persisted one verified
RouteStat for its own run, received a confirmed native kill, and left no process, worktree, runtime,
branch, or writer authority. Restart hydrated that observation exactly once and Cairn selected the
same GLM route with evidence count one.

The independent report's three severity claims were adjudicated as unsupported. A 1ms half-life is
an explicit deployment-owned policy choice within RS4, not a northbound injection. Replay already
checks terminal status/version, mapped authoritative verification, task identity, tuple fields,
event time, policy, and digest. Hydration explicitly supplies each persisted observation time rather
than the restart clock. The latter two claims became concrete tamper and clock-jump regressions.

## Honest remaining scope

Phase 45 remains supervised startup session recovery/auto-rejoin. Phase 46 remains an attested
representation review packet over the existing AST/CST, symbols/SCIP, CPG/path, behavioral,
structured-merge, IR-decision, and e-graph-decision ladder. Cairn causal audit, temporal
contradiction hardening, and bounded lexical/graph recall follow; none are deleted. Real provider
breadth, positive dependency clearance, deeper evidence ladders, operator depth, and production-core
work remain in their existing ledgers. No homelab or project-manager runtime integration is involved
or desired; project-manager remains local design inspiration for the self-contained causal graph.
