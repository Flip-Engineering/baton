# Phase 84 context successor wave review — partition 4/6

Source authority: `context-partition:de6c5fceffadc222116d695325715293b2029e33134c5eb6f9047144a7c646c6`, `impl/src/coordination-store.mjs`, bytes 454656–466944, digest `95eb86fe25cca7e22ca8e0e9fb468f4fb29adff4328054613c8cc8f52d6ac3ff`.

## Finding: failed stop application leaves a partially advanced projection

`run.stop_admitted` is not atomic when replay-time target integrity checks fail. After `_validateRunStopAdmission`, the handler immediately writes the stop as `stopping`, writes every `_runStopByTarget` entry, and cancels matching pending result exports. It then mutates Context sessions and cells one at a time. For schema version 3 it finally mutates Context calls one at a time.

The later loops can throw `run_stop_integrity`: schema version 2 rejects a missing or non-active session or a missing or non-admitted cell, and schema version 3 rejects a missing, completed, or stopped call. Those checks occur after the earlier writes; a later invalid target can also follow already-mutated valid targets in the same loop. The partition shows no rollback around any of these mutations.

Consequently, a stop event that fails application can still remain observable in the same projection as `stopping`, own target-route mappings, cancel pending exports, and stop a prefix of its Context targets. Replay has rejected the event while stop and cleanup state already reflect some of it, so exact route, result, and cleanup truth are no longer aligned.

Preflight every referenced session, cell, and call—and prepare all export and target updates—before the first collection mutation. Apply the prepared updates only after the complete target set passes, or stage them in a disposable projection and atomically commit it. A regression should place an invalid target after a valid one and assert that the thrown integrity error leaves `_runStops`, `_runStopByTarget`, `_runResultExports`, `_contextSessions`, `_contextCells`, and `_contextCalls` unchanged.
