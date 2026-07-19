# Adversarial review — context unit 1afa5f92628d340a50ef5d72c99999395778112143b9a344fae4d9eaeae90d79

## Finding: an effect-route lookup miss is reported as a map-route miss

`_settleContextCall` derives `generic`, `kind`, and `codePrefix` from the looked-up `call` before testing whether that call exists. For an unknown `callId`, `call` is `undefined`, so `generic` becomes false and `codePrefix` becomes `context_map_call`. Consequently, the explicit `settleContextEffectCall(..., 'effect')` route throws `context_map_call_not_found`, not `context_call_not_found`.

This loses exact route truth at the public compatibility wrapper: effect clients can misclassify the refusal or apply map-specific retry/error handling. The missing-call prefix must be selected from `expectedKind` when a typed wrapper supplied it, with the projected call kind used only once a call exists (or for the untyped compatibility entry point).
