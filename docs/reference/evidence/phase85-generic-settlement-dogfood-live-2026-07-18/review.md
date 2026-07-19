# Adversarial review — context map unit 5/5

Immutable unit: `context-unit:69caef1d3e14a4baf38447953c33c13966036e70a3034197a865471c99fffa7c`  
Source: `impl/src/coordination-store.mjs`, bytes 577536–589824, digest `8418c4c23c6010806fa3194ba96bfb6ac78c3ec9bdc1370ac6e3ca603b0f7f89`

## Finding

**[P1] Completed settlements silently erase termination input and collapse distinct replays.** The shared settlement path copies `fields.result.termination` only when its derived child state is `failed`. When every child is accepted, a caller can nevertheless supply any `termination`; it is removed while constructing `result`, so neither `_validateContextEffectCallSettlementPayload` nor `_validateContextMapCallSettlementPayload` can reject the contradictory input because each receives only the already-truncated payload. The idempotency check also compares that truncated payload, so a retry under the same key with a different `termination` is reported as `idempotent` instead of `*_settlement_conflict`. Generic settlement therefore does not preserve exact result or replay truth. Reject `termination` for completed requests (or bind the complete normalized request, including its presence/value, before projection and replay comparison).
