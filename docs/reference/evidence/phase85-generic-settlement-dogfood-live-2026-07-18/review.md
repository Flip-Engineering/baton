# Adversarial review — context unit 5/5

## Finding: effect-settlement misses are mislabeled as map-call misses

`_settleContextCall` derives `generic`, `kind`, and `codePrefix` from `call?.kind` before checking whether `call` exists. A missing call therefore makes `generic` false and selects `context_map_call`. Consequently, `settleContextEffectCall(...)` with an unknown `callId` throws `context_map_call_not_found`, even though the requested route is the effect-settlement route. The same mislabeling occurs for a known map call supplied to the effect-only wrapper because the error prefix follows the stored call rather than `expectedKind`.

This breaks exact route truth and can make compatibility clients apply map-specific retry, diagnostics, or error handling to an effect settlement. Choose the missing-call error namespace from `expectedKind` when it is present (and use the generic namespace for the unspecialized wrapper); only use the stored kind after existence has been established.
