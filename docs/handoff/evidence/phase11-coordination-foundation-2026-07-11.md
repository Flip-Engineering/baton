# Phase 11.4 coordination foundation evidence — 2026-07-11

## Verdict

PASS for the CK1–CK7 implementation slice and the current CK8 public wiring; CK9 adversarial and
recursive gates remain active work.

- `CoordinationStore` owns a separately validated, globally sequenced coordination event stream.
- Idempotency keys replay the original event; append failure leaves event and projection state
  unchanged.
- Startup rejects truncated JSON, sequence gaps, duplicate keys, and unsupported schema versions.
- Task creation persists the exact brief/deps/refinement/type/request/reserved-handle record.
- Claims are expected-version CAS operations with typed, no-event refusals.
- Queued tasks with no per-worker operational log survive a full `createDriver()` reconstruction
  with exact dependency readiness and null durable assignee.
- `createDriver()` returns the mandatory `coordination` substrate.
- Blocking input/resolution, crashes, verification outcomes, confirmed cancellation, persistent
  follow-up refinement, integration, and publication write durable task/evidence/driver records.
- Captured commits, verification verdicts, independent reviews, and integration reports are
  immutable task-linked manifests.
- Scratch facts/claims are immutable-tree scoped, conservatively conflict checked, cross-tree
  warned, and expired only by explicit events.
- Typed causal nodes/edges support bitemporal queries, supersession/invalidation, logged pull-only
  reads, affected-reader tracing, contamination records, and a metric-breakdown audit.
- Task/artifact events materialize graph nodes; verified outcomes and integrate/publish decisions
  promote deterministically.

Validation:

```text
node --test impl/test/phase11-coordination-store.test.mjs
17/17 passing

cd impl && node --test
519/519 passing
```

The recursive exact-model Grok review preceding implementation passed every lifecycle check and is
stored under `docs/reference/evidence/phase11-coordination-spec-review-2026-07-11/`. Its first run
was correctly budget-stopped and fully reaped; the measured rerun was verified and integrated by
Baton itself.

## Remaining before CK9

The fresh adversarial implementation review, atomic multi-event invalidation/contamination seam,
complete recovery/restart association for refinement tasks, forced coordination-write failure at
each public state boundary, and recursive provider implementation proof are not yet claimed.
