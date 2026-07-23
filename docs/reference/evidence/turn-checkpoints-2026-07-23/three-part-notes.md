# Three-part notes — baton reflexive-orchestration engineering summary (2026-07-23)

Six short notes, one per source document, in reading order. Each section stands alone and cites
one concrete rule or event kind from its source.

## 1. the trap

`docs/35-turn-checkpoints.md` names the defect that started the whole effort: turn-based gating
makes smart systems shallow and brittle. The concrete mechanism was that every provider turn end
fired `lifecycle.turn_completed {status:'completed'}`, which the coordinator treats as an
automatic result claim — launching the trust gate at every turn boundary and killing ordinary
agent pauses (thinking, waiting on tools or suites) as `required_effect_absent`. The fix is
not to remove the gate but to stop firing it blindly at turn boundaries: an adapter card declares
`card().turnCompletion ∈ { 'claim', 'pausable' }` with absent meaning `'claim'` (today's
semantics, so all 77 test-double cards and MockAdapter keep working unchanged), and only the five
interactive production cards declare `'pausable'`. A pausable turn end mints a durable
`turn.paused { workerId, taskId, turnEpoch, changedPathsDigest }` record and moves the task to a
new non-terminal `paused` state, so steering happens programmatically instead of the gate gating
on turn boundaries. The operator's rule is stated plainly: steer, never gate.

## 2. decisions

`docs/32-reflexive-orchestration.md` inventories the reflex loop in both directions and names
four gaps; its first closure (REFLEX-1) is the typed decision channel up from worker to
orchestrator. Today a worker can ask only a free-text question whose answer is uncheckable free
text; the design introduces a durable, single-consumer, fenced `DecisionRequest` with a bounded
option set (`options: exact{id,label,summary}[1..8]`), an optional free-response escape, and a
mandatory `deadlineMs` — a parked worker plus a blocked orchestrator without a deadline is a
permanent cycle, and on expiry the ledger gets `decision.expired`, never an auto-answer.
Settlement is durable-first: pending decision records are ledger-admitted and reconstructed on
replay (fixing the in-memory `_pending` map that wedges a blocking question across restart),
first settle wins with `already_resolved` for everyone else, and duplicate requestIds are
rejected at admission. Worker-authored fields render through the `boundedAttentionText`
discipline as untrusted prose; the settlement, not the provider text, is the authority.

## 3. objects

`docs/33-shared-objects-repl-layer.md` defines what "REPL" means in baton — a read-eval-print
loop over closed, content-addressed objects, never arbitrary code (permanent constraint
§93.1(1)) — and closes three gaps: no manifest authority outside a Workflow, no named binding
namespace, and no cell-as-source composition. The concrete centerpiece of REPL-2 is the named
binding: a map `(scope, name) → cell:<sha256>` with scope `shared` or `worker:<workerId>`,
versioned immutably by the event kinds `repl.binding_set` and `repl.binding_dropped`, and guarded
by a per-scope binding fence — the replay-derivable count of binding events for that scope,
deliberately diverging from the board fence because a namespace's writer must always invalidate
its readers' cache. Workers cite bindings as `repl:<scope>:<name>@<version>`, and citations bind
exact versions, never "latest". Together with ReplManifests and `cell:` branch refs (resolved at
admission, settled cells only), this makes "computed by the Bench, consumed by a worker" an
ordinary replay-safe hand-off instead of a hand-assembled package.

## 4. memory

`docs/34-knowledge-horizons.md` starts from the surprising truth that baton already owns a
complete, durable knowledge graph — the Cairn system with 19 node types, 14 edge types,
bi-temporal validity, and contradiction resolution — so the work is not building a KG but
layering three horizon projections over it and wiring activation. The three horizons are: task
(ephemeral — board items, scratch facts, pending interactions, and the worker's REPL bindings,
dying with the task), workflow (run-scoped — all boards, packages, cells, reports, and decision
settlements for one run), and project (persistent — the Cairn KG itself). Knowledge climbs the
horizons only through designed promotion paths, capped by the orchestrator-admit gate at run
settle: no silent auto-promotion of run-scoped claims into persistent truth. Activation is the
load-bearing lesson borrowed from project-manager — ambient beats query tooling — realized as
`recallPreview`, a non-evented, cached briefing projection that appends nothing and degrades
fail-open to an explicit `briefingUnavailable` marker rather than ever blocking dispatch, with
contradictions ranked first and WARNING-marked.

## 5. manifests

`repl1-decisions.md` is the decisions contract that turns REPL-1's design into fixed shapes: a
`ReplManifest` is a distinct manifest object, not a widened Workflow manifest, with its own
digest basis `kind: 'baton.repl_manifest'` (disjoint from `baton.context_manifest`, so no
Workflow manifest can be reinterpreted as a REPL one) and a `repl: { runId, replRole }`
coordinate in place of the Workflow's goal/plan/node/task block. Authority lives in exactly one
new event kind, `repl.manifest_admitted`, carrying `{ manifestDigest, runId, replRole,
principal, requestDigest }`; for `shared` scope the principal must be the run's orchestrator
authenticated through the existing lease path with the cross-run pin
`lease.parent.runId === payload.runId`, and for `worker:<id>` the store verifies
`manifest.repl.replRole === 'worker:' + auth.principalId` — a worker can admit only into its own
layer, and no caller-supplied authority string is ever trusted. The evaluator stays pure and
untouched; the authority-layer edits are enumerated individually (the `normalizeManifestAny`
dispatcher, the `manifest.kind` branches in the session and cell gates, the fold surface with
`PROJECTION_CHECKPOINT_FIELDS`), and a static kind-inventory test asserts the closed event-kind
set so an incomplete fold fails at test time, not at replay.

## 6. steering

`31b-steering-acts-decisions.md` fixes the mechanics of the three steering acts a live driver
takes on a paused task, each with its own reservation and its own authority op — deliberately
not collapsed into one shared "resolve with a mode flag" entry point. `nudge` is a full
fresh-turn admission (reserve the pause record, `_admitProviderTurn`, `bumpTurn`, unpark to
`working` via `_coordTransition`, clear budget stop, re-arm the watchdog, then expire only
pre-nudge scratch claims with `reason: 'turn_nudged'` — board claims are a category error here,
never the turn fence). `wait` is the legal zero-cost park: it touches no state machine and
appends only a durable `turn.wait_noted {pauseId, actor}` receipt, so a later `nudge` or `claim`
on the same pause record proceeds exactly as if no wait had happened — there is nothing for wait
to have consumed. `claim` (renamed from v1's `settle`, which collides with `wave.settle`)
re-runs the live trust gate `_runTrustGate` against a fresh worktree capture at claim time — the
pause record's `changedPathsDigest` serves attention classification only and is never gate input
— and resolves to the gate's only two terminal verdicts, `completed` or `failed`, touching
neither the fence table nor the watchdog.
