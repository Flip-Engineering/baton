# Phase 84 context successor-wave review

Scope: only `context-partition:77b375bbe2c6b2d418696c8c44070cb17856315daff9b887e164af0f20277ef4` (`impl/test/phase84-context-map-wave-red.test.mjs`, bytes 36864–49152).

## P1 — Stop can attest complete Context cleanup without targeting the mapped source cell

`CM84-W6` creates `parts` with `workflow.context().chunk(...)` and maps that cell with `workflow.context().map(parts, ...)`. The same partition establishes that a Context call source can carry a durable `cellId` (`context-cell-route-truth`). Nevertheless, the failure-stop assertions require `targetContextCellIds: []`, bind that empty array into `targetDigest`, and accept a receipt reporting both `targetCellCount: 0` and `remainingCellCount: 0`. Unlike task and worker IDs, no pre-stop cell set is independently derived, and no source-cell terminal or reap state is checked.

This permits a stop admission and its digest-valid receipt to be internally consistent while omitting the cell that supplied the mapped partitions. A leaked or still-owned source cell would therefore be outside the admitted cleanup authority while the receipt still claims zero remaining Context cells. The separate aggregate `ownedCount: 0` assertion cannot recover the omitted cell identity or prove that stop was authorized to reap it. Exact cleanup truth is lost on the failed-child path.

Derive the run-owned Context cell IDs before stop just as the test derives task and worker IDs. Include that exact set in `targetContextCellIds`, `targetDigest`, and the receipt counts, then verify every targeted cell is terminal/reaped. If chunk cells are intentionally released before stop, require durable pre-stop release evidence and assert that release before accepting an empty target set.
