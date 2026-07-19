# Generic Context settlement adversarial review

## Finding: effect-route refusals are mislabeled as map-call failures

In immutable partition
`context-partition:39ba74151d99002d98f4098fb86e155da85e7dfc7a4b8c258ad9d46f9c4d4be8`,
`_settleContextCall` derives `generic`, `kind`, and `codePrefix` from the looked-up call before it
checks call availability or the route's `expectedKind`. An absent call makes `generic` false, so
`settleContextEffectCall(..., 'effect')` rejects an unknown `callId` with
`context_map_call_not_found`. Cross-kind dispatch is mislabeled too: the effect entry point given an
existing map call emits the map prefix, while the map entry point given an effect call emits
`context_call_not_found`.

This loses exact route truth at the compatibility boundary: consumers cannot reliably classify an
effect-route refusal by its documented error namespace, and the same invoked route changes error
codes according to hidden target existence/type. Derive the refusal prefix from `expectedKind` when
the caller selected a typed entry point (with an explicit fallback for the untyped dispatcher), and
cover missing-call plus both cross-kind cases with regression tests.
