# Phase 92 focused assessment — Episode/workstream facade and resident closure

Date: 2026-07-19

## Outcome

Phase 92 is an implemented candidate. One objective-first Run now projects a progressive,
self-describing Episode and durable workstream surface through the direct API, selector-free CLI,
authenticated Web, MCP, and browser operator. Callers may choose an exact harness, model, and
effort, but do not manage task IDs, fences, receipts, byte limits, sockets, credentials, or cleanup
choreography.

Episode remains an evidence-backed, read-only projection over the existing Goal/Plan, Workflow,
Attempt, Context, Atlas, Cairn, verification, result, and cleanup authorities. Replaceable
summaries do not supersede exact result capsules, source coordinates, routes, lineage, verdicts,
or cleanup receipts. Aggregate Episode may expose the selected result; an exact role/generation
workstream exposes only its own artifact, result, requested/resolved/observed route, verification,
terminal cause, and cleanup evidence.

## Acceptance findings closed

1. `run.episode`, `run.workstreams`, `run.workstream.notify`, and `run.workstream.stop` are shared
   application operations rather than direct-client aliases for generic inspection. Direct, CLI,
   authenticated Web, MCP, and browser round-trip the same topic, generation, depth, output/evidence
   continuation, result settlement, and contextual-help fields.
2. Episode outlines use addressable chapter descriptors. Every advertised help target resolves,
   including compatibility `run.inspect` navigation. Pending result observation is explicit and
   carries continuation; it is not a completed null result.
3. Exact workstream generations and predecessor Episodes remain addressable. Notify and stop bind
   the selected generation and recheck its authority before effects. Two-role regressions prove a
   workstream cannot claim a sibling's task, artifact, Candidate, route, verdict, or cleanup.
4. One narrow Episode context and at most one broad coordination snapshot serve a request. Its
   immutable graph preserves temporal sequence/time, evidence/source coordinates, route and
   lineage across `produced`, `modified`, `derived_from`, `grounded_in`, `contradicted_by`,
   `verified_by`, `covers`, and `releases` edges. `contradicted_by` points from the contradicted
   claim to the contradiction.
5. Operational worker logs have one-load, append-aware indexes. A long-lived reader detects another
   Log instance's append and incrementally parses only new bytes. Coordination startup folds once,
   approved-Run reconciliation uses narrow indexed reads, and Episode does not clone the full store
   per item.
6. Projection checkpoints are parsed-event caches, not authority. Cached events still cross `_apply`
   and every current validator/reverifier. Prefix mismatch or cache corruption falls back truthfully
   to the authoritative ledger; ledger corruption fails closed. Loaded ledger identity advances on
   append, drift prevents persistence, and best-effort checkpoint telemetry cannot block or redefine
   writer-lease release.
7. Ordinary authenticated observations do not durably amplify history. The security/liveness audits
   `readiness_probe`, `readiness_transition`, and `command_status_authorized` remain durable and
   fail closed. Independent Web request execution keeps status/progress/stop responsive during a
   long projection.
8. Stale resident recovery is deployment- and PID-start-specific. A proved stale different-
   deployment selector can be replaced, but a live authority cannot. Ordinary serve and
   `CONFIG_MODULE` now consume the same public deployment factory; the temporary Phase 92 bootstrap
   is not retained.
9. Verification policy distinguishes pass-only from red-green-required. An `accepted:false` verdict
   cannot project an accepted artifact/result. Declared read-only review/research objectives may
   settle an evidence-backed textual result without repository mutation; change objectives retain
   explicit required-effect enforcement. Terminal `run.stop` derives a safe omitted reason.
10. Readiness retains configured-but-blocked routes and explains native Kimi credentials, Grok
    refreshability, Claude login discovery, and unconfigured Kimi-through-Claude. Built-in GLM has
    the sole model `glm-5.2` with exact selectable `low`, `medium`, `high`, `xhigh`, and `max`
    efforts; `xhigh` remains the explicit dogfood choice and no blanket low default was added.
    Requested, resolved, and observed identities remain distinct: provider-omitted Codex model
    observation is null rather than copied from the request.

## Validation

The exact replay/checkpoint/audit/lease regression cluster passed 179/179 with exit code 0. It
includes CK8/CK9; RC2/RC3; EP3/EP5/EP6/EP7 and health; PI3/PI10; AF2/AF3/AF6/AF7/AF10; PF5;
DP3/DP5; SP7/SP9; CO2 canonical ordering; and writer-lease release behavior.

The expanded affected matrix passed 281/281 with exit code 0. It includes Phase16 MCP parity, all
Phase92 tests, Codex observed-route regression, deployment/route discovery, and the same
cross-phase falsifiers.

The complete dispatch verifier passed 2,302/2,302 tests with exit code 0:

```text
npm test --prefix impl
```

It was run from the assigned worktree root with the exact executable/argument contract. The focused
commands do not substitute for this complete verifier.

## Evidence boundary

These deterministic suites establish application/transport contracts, parse counts, bounded
snapshot counts, replay/reverification behavior, synthetic resident races, and simulated cleanup
receipts. They are not live-provider evidence, a live startup-time benchmark, or proof that real
provider/child PIDs exited. The measured 6,218-event, 7.4 MB, 111-second replay is retained as the
defect that motivated the linearity work; no new live timing is inferred from fixture latency.

A separately reported live review stop observed `ownedWorkers:0`, `reaped:true`, provider and child
PIDs gone, and worktree removal. That observation is preserved as reported operational evidence;
this Phase 92 fixture suite neither reproduces nor upgrades it into bundled live-provider/PID proof.

## Next sequence

Phase 93 remains deliberately closed and next in this order: closed canonical Program IR;
event-driven recursive/parallel composition; immutable base plus private overlays; one fenced
integrator; and live multi-harness gates. Workstreams are the substrate. Ambient shared mutable
checkout writes, arbitrary agent-authored recursion, and homelab integration are not introduced.
