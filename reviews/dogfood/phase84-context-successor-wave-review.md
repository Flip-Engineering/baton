# Phase 84 Context Successor Wave Review

Source reviewed: immutable partition `context-partition:b5a03cde27070f5661ecc2690fca9bb8567d1224503f197732ed0931ea3f8ce4`, chunk 2 of `impl/test/phase84-context-map-wave-red.test.mjs` (content digest `72d39b2f8b546b56a02797bb865ca4dd5d2c478608bd225820fa0c136d4f7029`).

## Finding: CM84-W6 admits empty failed-child attribution

CM84-W6 asserts that a `context_call_failure` row exists, then validates its children only with `failure.value.every(...)`. JavaScript's `every` returns `true` for an empty array. Consequently, an implementation can emit `context_call_failure` with `value: []` and still satisfy the test's route/state assertion. The other checks—failed call state, absent aggregate output, rejected settlement, no `context_call_evidence`, and no `context.call_settled` event—do not establish that any failed descendant appears in the failure evidence.

This leaves a concrete result-truth gap: failed mapped children may be omitted from durable evidence, losing their exact route attribution, while CM84-W6 passes and stop/reap still reaches `stopped`.

Require `failure.value` to be an array whose length equals the expected mapped-child count, then compare the complete child identity/partition set and each child's `failed` state and exact route. A non-empty assertion alone would still permit partial attribution.
