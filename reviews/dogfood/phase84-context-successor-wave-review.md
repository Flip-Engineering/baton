# Phase 84 Context Successor Wave Review

Scope: immutable partition `context-partition:4b477137387f6f6d1b82fc961f796f4bbc5433bbfb18f3506ac7797228dc65e6` only (`impl/test/phase84-context-map-wave-red.test.mjs`, lines 802–1041 in blob `3e5d251403a206ebea1484796b077bd30eab39fa`).

## Finding — High: CM84-W6 permits over-broad Run-stop authority

The test requires `targetContextCallIds` to equal `[mapped.id]` (line 862), but it checks `targetTaskIds` and `targetWorkerIds` only with `includes` for each failed descendant (lines 863–866). The later receipt and cleanup assertions iterate over whatever worker set the admission already contains (lines 868–898), so they do not close this gap.

Consequently, a stop implementation can add an unrelated task or worker to the durable target snapshot, reap that worker, and still satisfy every shown assertion. The receipt will simply count and digest the over-broad set. That loses exact cleanup and authority truth: the Context call is exact while its descendant stop authority is not.

Require canonical equality between the admitted task/worker target arrays and the task/worker IDs projected from `failedDescendants` (including cardinality and order, or a documented canonical sort), and assert the receipt target count/digest against that independently derived exact set.
