# Phase 84 context successor wave review

Reviewed only immutable partition `context-partition:f5775995bd5413666a8fd0dde45ef1d1957094b9ae5128746571572cf67a7cc7` (`impl/test/phase84-context-map-wave-red.test.mjs`, bytes 12288–24576).

## Finding

### High — CM84-W6 accepts a stopped phase without proving failed descendants were reaped

CM84-W6 reads `events.jsonl` before calling `workflow.stop()`, verifies only that no `context.call_settled` event exists, then calls `stop()` and accepts `workflow.status().phase === 'stopped'` as the entire reap check. It never reloads the post-stop events or asserts a `task.resources_released` receipt for each failed mapped child, valid release digests/cleanup attestation, or zero remaining descendants. Consequently, an implementation can mark the workflow stopped while leaking failed Context-map child resources and this test still passes—despite the stop reason claiming `Reap failed Context map children.`

Require the post-stop event log and Context-call state to prove exactly-once release of every failed child, with authenticated release evidence and no remaining cleanup targets; replay should preserve that same stopped/reaped truth without new provider effects.
