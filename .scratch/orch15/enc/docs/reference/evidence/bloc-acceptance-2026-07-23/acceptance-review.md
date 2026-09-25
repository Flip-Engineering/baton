# Bloc acceptance review — reflexive-orchestration arc (c164532..3866fcc)

_Reviewer: acceptance gate. Read-only against the binding contracts (docs/32, 33, 34; the
repl-kg-wave and mcp-reflex-live decisions docs). Every claim below carries file:line evidence.
Deployment verification gate `node --test impl/test/wave-driver-red.test.mjs` is green (10/10)._

## Verdict

**Conditional accept.** The arc is overwhelmingly sound: the REPL-1 authority layer is coherent
under replay, the issue #30 decision-gate fix is correct and non-over-reaching, the MCP surface
enforces its registration and answer-shape guards, and the decision-live receipts honestly close
issue #16. One landed contract rule is **not** enforced as its own red-team resolution claims —
the KG-1 union-fence (area 4). It is currently latent (no live consumer wired this epic) but the
"P1-1 fixed" acceptance claim is materially false and its regression test is vacuous. Accept the
arc; require the KG-1 fence correction (or an honest scope note) before KG-1 horizons are wired
to any consumer.

Per-area verdicts:

- **(1) Contract rules claimed vs enforced** — PASS, except area (4). Disjoint digest bases
  (`kind` inside the digested body, context-program.mjs:330-346), two-level idempotency
  (coordination-store.mjs:9333-9361), lease run-pinning (:9313-9316), worker store-equality
  (:9318-9323), and replay-time re-validation (:8201-8205 → :9223-9268) are all genuinely
  enforced, not merely asserted.
- **(2) REPL-1 authority layer under replay** — PASS. All coupled sites carry integrity-mode
  kind branches keyed to the settled `repl.manifest_admitted` record, which folds first.
- **(3) REPL-2/3 integration splice** — PASS. No residual divergence; `cell:` coordinates are
  baked into the admission payload so replay reconstructs identical branches with zero store
  lookups.
- **(4) KG union-fence coverage** — **FAIL (P1).** `queryKnowledge({})` output changes on many
  event kinds that advance no component of the task/workflow horizon fence.
- **(5) MCP registration + answer-shape guard** — PASS. `{decision:'allow'}` is refused
  `invalid_arguments` pre-dispatch; kind-matching stays hub-side.
- **(6) issue #30 pending-record guard** — PASS. No turn-completion ordering is misclassified.
- **(7) decision-live receipts** — PASS. The settled framing propagated into worker output; not
  theatrical.
- **(8) new red suites** — PASS on green (all focused suites 0-skip), with one **vacuous test**
  called out under P1 (the KG-1a/KG-1b fence tests exercise only the whitelisted events).

## P0-P1 findings

### P1-1 — KG-1 union-fence under-covers `queryKnowledge` inputs; the "P1-1 fixed" claim is false

**Contract:** docs/34 rule 4 ("Each horizon projection is cached keyed to the **union of its
constituent replay-derivable fences**") and kg12-decisions.md v2 revision **P1-1**: "*union-fence
under-covers projection inputs — fixed. Added a new store-level, replay-derived counter,
`projectionInputFence()` … appended as a fourth component to both the task fence and the workflow
fence.*"

**What landed.** `projectionInputFence()` increments only on a hard-coded allowlist,
`PROJECTION_INPUT_FENCE_EVENTS` (coordination-store.mjs:132-142, applied at :7362):
`knowledge.node_added`, `knowledge.promoted`, `knowledge.edge_added`, `knowledge.promotion_batch`,
`knowledge.scratch_corrected`, `knowledge.workflow_admitted`, `package.admitted`,
`package.attached`, `board.claim_requested`, `board.claim_expired`, `board.report_submitted`.

But `taskHorizon` (coordinator.mjs:9283-9298) and `workflowHorizon` (:9303-9319) each read
`this._coordination.queryKnowledge({})` and `queryKnowledgeEdges({})` — the **entire** live node
and edge set — and their fence tuples (:9291, :9312) contain **no** `eventFence` component (only
`projectHorizon` uses the event-position superset, :9324). `queryKnowledge({})` with no
`observedSeq` filters by validity as-of-now (:13887, :13895), so any node whose validity changes
drops in or out of the result.

Many event kinds mutate that node/edge set and are **absent** from the allowlist (confirmed: a
grep of lines 132-142 for these kinds returns 0):

- `knowledge.invalidated` sets `validTo` on an explicitly-added node (fold at
  coordination-store.mjs:7990-7992) — the node vanishes from `queryKnowledge({})`.
- `knowledge.contradiction_resolved` (fold at :7982) changes edge/node validity.
- `route.outcome_observed` mints a live `RouteStat` node + `ObservedIn` edge on every verified
  outcome (:7653-7654) — a hot-path, per-task event.
- `task.created` mints a live `Task` node (:7616); `artifact.registered` mints a live `Artifact`
  node (:7665); `artifact.superseded` invalidates one.
- `knowledge.representation_produced` (:7678-7700) and the `knowledge.reuse_*` family
  (`reuse_decided`, `reuse_risk_guarded`, `reuse_ttl_invalidated`, `reuse_provider_guarded`,
  `reuse_policy_reconciled`) add/invalidate nodes (e.g. :7398-7419).

**Failure scenario.** Compute `workflowHorizon(run)` for a run; a task in that run completes and
`route.outcome_observed` mints a new `RouteStat` node (or an orchestrator resolves a contradiction
via `knowledge.invalidated`). None of `boardFence`, `bindingFence('shared')`, `decisionSettleCount`,
or `projectionInputFence` advance, so the next `workflowHorizon(run)` call returns the **cached,
stale** node set (coordinator.mjs:9269-9276 returns the cached value when `fenceKey` is unchanged)
— missing the new node, or still showing a now-invalidated one. Even under the narrowest reading
(only explicit KG writes matter), `knowledge.invalidated` and `knowledge.contradiction_resolved`
operate on explicitly-added nodes and still do not advance the fence — directly defeating KG-3's
contradiction-first intent for any consumer that reads these horizons.

**Severity: P1, currently latent.** `taskHorizon`/`workflowHorizon`/`projectHorizon` are defined
in coordinator.mjs but consumed by **no** live surface this epic (docs/34 §5 non-goal: "No
MCP/CLI surfaces in this epic"); only tests call them. The live KG-3 path, `recallPreview`
(coordination-store.mjs:13762), is correctly fenced to the event-position superset
(`_knowledgeProjectFence()` at :13784, queried at :13792) and is **not** affected. So the defect
is a landed, contract-specified correctness bug that no consumer can yet trip — but the
acceptance record's "P1-1 fixed" is false, and shipping a KG-1 consumer against this fence would
serve stale knowledge.

**Vacuous regression test (area 8).** `impl/test/kg12-decisions-red.test.mjs` KG-1a (:75-98) and
KG-1b (:101-113) assert cache-miss only for a direct `knowledge.node_added` "unrelated scope"
write, a board claim/report, and a package admission — i.e. **only** events already in the
allowlist. No test drives a `route.outcome_observed`, `task.created`, `knowledge.invalidated`, or
`knowledge.contradiction_resolved` through the horizon and asserts a cache miss. The test proves
the fix covers what the fix added, not the property P1-1 named ("`queryKnowledge` output changed
⟹ fence advanced"). It therefore gives false confidence and would not catch this regression.

## Required corrections

1. **Make the KG-1 task/workflow horizon fence total over `queryKnowledge` inputs.** Either
   (a) key `taskHorizon`/`workflowHorizon` on the project-horizon fence (`eventFence()`) for their
   KG-node/edge component — the same superset `recallPreview` and `projectHorizon` already use,
   which is trivially total — while keeping the scoped board/binding/interaction components for
   their board/binding inputs; or (b) if a tighter counter is intended for efficiency, replace the
   hand-picked `PROJECTION_INPUT_FENCE_EVENTS` allowlist with a rule that advances on **every**
   event kind whose fold calls `_setKnowledgeNode`/`_setKnowledgeEdge` (route.outcome_observed,
   task.created, artifact.registered/superseded, knowledge.invalidated,
   knowledge.contradiction_resolved, knowledge.representation_produced, knowledge.reuse_*, …),
   derived mechanically rather than enumerated, so a new node-writing kind cannot silently escape
   it. Option (a) is the low-risk correction; option (b) needs its own inventory test.

2. **De-vacuate the KG-1 fence regression test.** Add cases to
   `impl/test/kg12-decisions-red.test.mjs` that mint a node via `route.outcome_observed` (or
   `task.created`) and invalidate a node via `knowledge.invalidated`, then assert
   `taskHorizon`/`workflowHorizon` returns a **fresh** (non-cached) projection reflecting the
   change. Assert the property directly: any mutation visible to `queryKnowledge({})` must produce
   a horizon cache miss.

3. **Correct the acceptance record.** The kg12-decisions.md "P1-1 … fixed" line overstates the
   landed behavior. Either land correction (1) or amend the contract to state explicitly that the
   task/workflow union-fence covers only board/binding/package/explicit-KG-write inputs and is
   **not** total over `queryKnowledge`, with the auto-promoted/invalidation kinds named as a
   known gap gating any KG-1 consumer.

_No other P0/P1 issues found. Areas (1),(2),(3),(5),(6),(7) verified enforced with the evidence
cited in the Verdict; all focused red suites (reflex1/repl1/repl1-kind/repl23/kg12/kg3/kg4/
mcp-reflex-surface/mcp-reflex-board-package/decision-gate) run green with 0 skipped, and the
deployment gate `node --test impl/test/wave-driver-red.test.mjs` is green 10/10._
