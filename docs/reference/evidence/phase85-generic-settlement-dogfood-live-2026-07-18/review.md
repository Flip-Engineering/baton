# Adversarial review — context partition 5/5

## P2 — Preserve the typed effect route when the call is absent

`_settleContextCall` derives `generic`, `kind`, and `codePrefix` from `call?.kind` before its not-found check (`impl/src/coordination-store.mjs:7924-7932`). For `settleContextEffectCall` with an unknown `callId`, `call` is absent, so the code selects `kind = 'map'` and `codePrefix = 'context_map_call'`; the explicit `expectedKind = 'effect'` then takes the rejection path and emits `context_map_call_not_found`. The effect settlement route is therefore exposed as a map failure, losing exact route truth and breaking clients that branch on the documented error family for replay or compatibility handling. When `expectedKind` is supplied, it must determine the not-found route/error prefix rather than an unavailable stored call.

Source: immutable partition `context-partition:4e89eae8b8fb7241bfc618f1d6b23d7b05a719da23412686897648ebb8ca7993` (`contentDigest:661a7ea7feb5817e66d8f093a9773f80b08c916de2443097b6225d306b08e556`).
