# Phase 84 context successor wave review — partition 2/2

Scope: only `context-partition:cc3124b51120508943bb8dafc98165b90db3872eeb1cbf9e0ce723dfb1cd0c44` (`impl/test/phase84-context-map-wave-red.test.mjs`, bytes 12288–24576).

## Finding: failed-child stop/reap has no exact cleanup oracle

**Severity: High.** CM84-W6 considers the failed-map stop path correct after asserting only that `workflow.stop(...)` leaves the workflow in phase `stopped`. It does not assert that every failed mapped child was released exactly once, that release evidence is bound to the admitted child/partition and route, that no resources remain, or that those facts survive replay.

The omission is concrete when compared with CM84-W4 in the same partition. The successful path requires one `context.call_settled`, `targetCount === partitionCount`, `remainingCount === 0`, one `task.resources_released` per partition, per-target release event/digest and `resource.worker_cleanup_attested` evidence, child-to-release binding, exact replay, and pre-effect rejection of tampered cleanup. CM84-W6 checks failed state, absence of aggregate output and settlement, route-attributed failure evidence, and then only the top-level stopped phase. Because a failed call intentionally has no `context.call_settled` receipt, none of W4's settlement assertions prove cleanup for W6.

Consequently, this partition's oracle would pass if stop marked the workflow stopped while a failed descendant remained allocated, was released twice, was released under the wrong authority, or replay lost or fabricated its cleanup truth. The visible portion of CM84-W7 contains only fixture setup, so it supplies no reviewable assertion that closes this gap.

## Required correction

Extend the failed-child stop/reap case to retain the partition count and child identities, then assert after stop that:

- each failed child has exactly one durable `task.resources_released` record bound to its partition/resource and admitted route;
- every release has a valid event, digest, and `resource.worker_cleanup_attested` evidence, with zero remaining targets in the authoritative stop/reap receipt;
- reopening preserves the failed call without aggregate output and preserves the stopped state without another provider call or duplicate release; and
- release or cleanup tampering fails replay before adapter/provider effects.

The failure path should continue to emit no successful `context.call_settled`; cleanup truth must instead be carried by the durable stop/reap authority.

## Verification status

Not run, as instructed. The specified deployment verification command (`node`) was not executed, so this report does not claim deployment-verified completion.
