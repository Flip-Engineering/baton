# Phase 11.4 coordination foundation evidence — 2026-07-11

## Verdict

PASS for CK1–CK9's deterministic zero-quota coordination and public-authority gate. The fresh
recursive real-provider review remains pending Grok reauthentication and is not inferred from
these tests.

- `CoordinationStore` owns a separately validated, globally sequenced coordination event stream.
- Idempotency keys replay the original event; append failure leaves event and projection state
  unchanged.
- Startup rejects truncated JSON, sequence gaps, duplicate keys, and unsupported schema versions.
- Task creation persists the exact brief/deps/refinement/type/request/reserved-handle record.
- Claims are expected-version CAS operations with typed, no-event refusals.
- Queued tasks with no per-worker operational log survive a full `createDriver()` reconstruction
  with exact dependency readiness and null durable assignee.
- `createDriver()` returns the mandatory `coordination` substrate.
- Operational-log append failure is fatal: the triggering mutation fails closed, the coordinator
  is poisoned until restart, and claim-before-spawn replay terminalizes the exact durable task.
- Replay takes deps/status/assignee from coordination state and associates a persistent worker with
  its newest durable refinement rather than reverting to its first turn.
- Blocking input/resolution, crashes, verification outcomes, confirmed cancellation, persistent
  follow-up refinement, integration, and publication write durable task/evidence/driver records.
- Captured commits, verification verdicts, independent reviews, and integration reports are
  immutable task-linked manifests; accepted manifests require digest-validated, accepted
  `verify.reverified` provenance, and `artifact.superseded` records corrections without erasure.
- Scratch facts/claims are immutable-tree scoped, conservatively conflict checked (including a
  glob/glob witness fixture), cross-tree warned, and expired by explicit events. Public coordinator
  methods now mediate claims, facts, and reads: active-task ownership and the current worker fence
  are authoritative, mutations are idempotent, and a `scratch.read` record is durably appended
  before content returns. Confirmed task terminalization emits claim-expiry events.
- Typed causal nodes/edges carry distinct observation/event/valid time, materialize `Informed` and
  `ReadBy` edges, support bitemporal queries, supersession/invalidation, logged pull-only reads,
  affected-reader status joins, contamination records, and a metric-breakdown audit. Coordinator
  recall appends its read record before returning an explicitly untrusted frame.
- Task/artifact events materialize graph nodes; verified outcomes and integrate/publish decisions
  promote deterministically through named `knowledge.promoted` events.
- Failed integration is no longer telemetry-only; it maps evidence and records an audited
  coordination refusal.
- Every coordinator-facing coordination mutator now crosses one fail-closed wrapper. Storage or
  integrity exceptions poison all subsequent public commands and abort live spawn admission;
  typed semantic refusals remain ordinary refusals. Injected task-create failure publishes no
  handle or task projection, while injected claim failure reaches neither adapter nor worktree and
  leaves the durable task pending/unassigned for restart.
- Blocking input becomes pending/blocked only after its mapped durable transition. Persistent
  follow-up and recovery write intent before native calls; if the native session advances or
  attaches but refinement creation fails, Baton records the aborted attempt, kills/quarantines
  that ambiguous transport, and replays it orphaned while preserving the prior verified turn.
- If a native answer/approval is accepted and the following operational append fails, Baton
  commits and releases the in-memory single-consumer reservation, wakes racing responders without
  redelivery, poisons subsequent public commands, and restart terminalizes the unresolved durable
  task as failed.
- Stop intent is durable before interrupt/kill calls. A cancel-terminal append failure returns a
  bounded `coordination_unavailable`, preserves the stop intent, and restart terminalizes the
  durable task instead of hanging or claiming cancellation.
- Review creation inherits task-create authority and is fault-proven to call no reviewer when its
  durable task cannot append. Integration writes intent before retaining refs, stopping/reaping,
  or changing Git. Publication request and exact-fence authorization are durable before the
  publisher; authorization failure invokes no publisher. After the outside effect, publication's
  knowledge decision and driver completion commit atomically. Replay ignores a telemetry-only
  `publication.completed`, reports publication unknown, and never republishes it.
- Adapter callback failures caused by an already-poisoned authoritative store are contained at
  the callback boundary rather than escaping as uncaught process exceptions.

Validation:

```text
node --test impl/test/phase11-coordination-store.test.mjs
28/28 passing

node --test impl/test/phase11-persistent-sessions.test.mjs
20/20 passing

node --test impl/test/phase11-acceptance-integration.test.mjs
20/20 passing

cd impl && node --test
563/563 passing
```

The recursive exact-model Grok spec and implementation reviews passed every Baton lifecycle check.
The implementation review is stored at
`docs/reference/evidence/phase11-coordination-implementation-review-2026-07-11/`; it identified the
dual-stream write, claim-before-spawn, replay-authority, artifact, Scratch, recall, and refusal seams
closed in this hardening slice. The earlier first spec-review run was correctly budget-stopped and
fully reaped; the measured reruns were verified and integrated by Baton itself.

## Remaining beyond the deterministic CK9 gate

Scratch participation is not yet automatically injected into every adapter worker as an ambient
tool/notification channel; automatic scorecards and Scratch promotion candidates remain
incomplete. A second recursive provider review of these repairs is still required before recursive
dogfooding is considered fully re-opened. The requested Grok run remains gated on provider
reauthentication; no authentication bypass or silent model fallback is allowed.

The zero-quota concurrent Grok ACP boundary is now green: two distinct fake-wire child PIDs ran
simultaneously, both kills confirmed, both durable tasks cancelled, and every PID/worktree/branch
was reaped. A real-provider rerun was attempted with isolated credential projection but the
provider credential had expired before `session/new`; that attempt is preserved as
`PENDING-LIVE-grok-reauth` rather than weakening authentication or overwriting the earlier passing
live evidence.
