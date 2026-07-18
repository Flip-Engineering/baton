# Phase 84 context successor wave review

Reviewed partition: `context-partition:bf09e707ebcc4912a083cae9384abee6ce74553e3e871538ad8a5c064d3734a9` (`impl/test/phase84-context-map-wave-red.test.mjs`, bytes 12288–24576).

## Finding: CM84-W6 can pass while failed Context-map descendants are not reaped

`CM84-W6` proves that failed children do not produce aggregate output or a `context.call_settled` event. It then calls `workflow.stop('Reap failed Context map children.')` and checks only that `workflow.status().phase` is `stopped`. The event log is read before that stop, and the test never re-reads it afterward to verify releases for the failed descendants.

This leaves stop/reap truth unprotected. An implementation could mark the workflow stopped while leaking a failed child's resources, releasing only some descendants, or recording duplicate or unauthenticated releases, and this test would still pass. The same partition demonstrates the missing durable checks in `CM84-W4`: it binds each terminal child to a `task.resources_released` event, a safe `releaseEvent`, a hashed `releaseDigest`, cleanup attestation, zero `remainingCount`, and replay without a second settlement. No corresponding post-stop proof exists for the failed-child path.

Strengthen `CM84-W6` by retaining the failed child identities/count, re-reading durable events after `workflow.stop()`, and requiring exactly one authenticated resource release for every failed mapped child with no descendants remaining. Then reopen the deployment and verify that replay preserves the same stopped/failure/cleanup result without new provider effects or duplicate releases. The failed call should continue to have no aggregate output and no successful `context.call_settled` event.
