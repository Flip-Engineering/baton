# Phase 11.4 coordination foundation evidence — 2026-07-11

## Verdict

PASS for the CK1/CK2 foundation slice; CK3–CK9 remain active work.

- `CoordinationStore` owns a separately validated, globally sequenced coordination event stream.
- Idempotency keys replay the original event; append failure leaves event and projection state
  unchanged.
- Startup rejects truncated JSON, sequence gaps, duplicate keys, and unsupported schema versions.
- Task creation persists the exact brief/deps/refinement/type/request/reserved-handle record.
- Claims are expected-version CAS operations with typed, no-event refusals.
- Queued tasks with no per-worker operational log survive a full `createDriver()` reconstruction
  with exact dependency readiness and null durable assignee.
- `createDriver()` returns the mandatory `coordination` substrate.

Validation:

```text
node --test impl/test/phase11-coordination-store.test.mjs
7/7 passing

cd impl && node --test
509/509 passing
```

The recursive exact-model Grok review preceding implementation passed every lifecycle check and is
stored under `docs/reference/evidence/phase11-coordination-spec-review-2026-07-11/`. Its first run
was correctly budget-stopped and fully reaped; the measured rerun was verified and integrated by
Baton itself.

## Remaining before CK9

Durable terminal/input/recovery transitions, operational evidence mapping, artifact manifests,
Scratch, the bitemporal KG, read contamination, and the complete built-not-wired event matrix are
not claimed by this slice.
