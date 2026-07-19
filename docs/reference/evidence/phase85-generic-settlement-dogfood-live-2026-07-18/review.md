# Adversarial review — context unit `b52e8e093394d60cffd9421698d93c3f19731fc1512fec12edf15d0e98c12295`

## Finding: failed effect settlements are forced to misreport permanent failures as retryable

**Severity: High — settlement/replay correctness**

`_validateContextEffectCallSettlementPayload` derives `state === 'failed'` whenever any settled child is not accepted, but its failed-result branch then accepts only `termination.code === 'context_child_failed'` with `termination.retryable === true`. It never derives retryability from `children` or `providerResults`. Consequently, a permanent provider/child failure cannot be represented truthfully: a settlement carrying `retryable: false` is rejected, while an accepted settlement and its evidence are required to assert that retry is safe.

This corrupts exact terminal-result truth and can cause replay/orchestration to retry a permanently failed effect call, including re-entering already accepted sibling provider effects or cleanup paths. The aggregate termination should derive and validate retryability from the settled child/provider outcomes (and bind that value through the result, evidence, and settlement digest), with coverage for permanent and mixed-retryability failures.
