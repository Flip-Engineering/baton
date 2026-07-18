# Phase 84 context successor wave review — partition 2/2

Reviewed only `context-partition:3228e3ffcf8f0f080a1dabb39c9886ed04528c0272bc4f0615bf1c59f9257433` (`impl/test/phase84-context-map-wave-red.test.mjs`, bytes 12288–24576).

## High — CM84-W4 does not prove successful replay is provider-effect-free

CM84-W4 says the settled Context map must “replay exactly,” but after closing and reopening the deployment it asserts only that the call remains completed, its output is deeply equal to the original output, and the log still contains one `context.call_settled` event. It does not snapshot or compare `tracker.calls` around this successful reopen and lookup.

That omission is observable in the partition: the same test later uses `tracker.calls.length` to prove that release- and settlement-tampered replays fail before provider effects. Consequently, a replay path that invokes mapped-child provider work again, then returns the durable output and deduplicates `context.call_settled`, would satisfy the successful-replay assertions. Duplicate provider work would execute without fresh Context-call admission while the test still reports exact replay, so route/effect authority is not preserved by the claimed coverage.

Capture `tracker.calls.length` after the original call settles and before reopening, then assert it is unchanged after `openBaton(...)` and `replay.context().call(mapped.id).outline()`. Keeping the existing output and single-settlement assertions alongside that check would bind replay to both the durable result and zero repeated provider effects.
