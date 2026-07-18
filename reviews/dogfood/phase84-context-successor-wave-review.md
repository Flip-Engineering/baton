# Phase 84 context successor-wave review

Immutable evidence: `context-partition:68d959d63e6e997674824e5279f69562dffb68957ac5a310c4570ef9ab892558`, bytes 0–12288 of `impl/test/phase84-context-map-wave-red.test.mjs`.

## [P1] Crash replay does not prove the recovered successor's authority

CM84-W2 intentionally retains one `context.call_admitted` event while throwing before `Coordinator.proposePlan`. After reopening, however, its only dispatch proof is `tracker.calls.length === 2 + partitionCount`; its only ledger proof is one call admission and two plan proposals. It never asserts that the recovered second plan has the first plan's digest as predecessor, that every node names the retained `callId` and its corresponding admitted `partitionId`, or that the node and provider brief preserve the exact selected route and immutable partition. Those bindings are asserted only in CM84-W1's uninterrupted path.

Consequently, recovery may substitute an unrelated successor plan or dispatch the right number of children with wrong routes or partitions and CM84-W2 will still pass. The replay would preserve counts while losing the admitted authority and exact route/result truth.

Require CM84-W2, after reopen and approval, to compare the recovered plan with the retained admission: exact predecessor digest; exactly one node per admitted partition; exact `contextCall.callId` and `partitionId`; exact route arrays; and each new provider brief's `contextInput.value`, `contextInput.partitionId`, and `contextCall.partition.partitionId`. Also reject any extra provider effects.
