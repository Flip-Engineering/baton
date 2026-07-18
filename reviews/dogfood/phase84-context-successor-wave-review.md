# Phase 84 context successor wave review — partition 2/2

## Finding: `CM84-W6` does not prove that stop reaps failed map descendants

Severity: High

`CM84-W6` ends with `workflow.stop('Reap failed Context map children.')` but its only post-stop assertion is that `workflow.status().phase` equals `stopped`. The test does establish the failed call's result truth before stopping: there is no aggregate output, settlement is rejected with `context_map_child_failed`, failure evidence attributes every partition, and no `context.call_settled` event exists. It does not, however, inspect any child after the stop or require child cleanup/release evidence.

Consequently, an implementation can pass this case by changing only the parent phase to `stopped` while a failed mapped-child process, session, worktree, runtime, or cleanup authority remains live. The stop reason promises descendant reap, but the assertion proves neither the exact descendants reaped nor their resource-release truth. That leaves Phase 84 vulnerable to a stop/reap overclaim despite the result and settlement checks immediately above it.

The case should retain the failed call/partition identities and, after `workflow.stop`, assert that every mapped child reached the expected terminal cleanup state and that release evidence is bound to the same task/run and descendant identity. It should also reject a stopped parent when any mapped descendant lacks valid cleanup authority.

Source basis: immutable partition `context-partition:3446a7664c3fbc7612058ee039ea75ee551699e67f4f7b4466e429c54a0a60cd`, specifically the complete `CM84-W6` body supplied in chunk 2. No claim depends on the truncated remainder of `CM84-W7`.
