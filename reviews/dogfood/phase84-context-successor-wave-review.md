# Phase 84 context successor-wave review — partition 2/6

Source: immutable partition `context-partition:290347b46c6bb076b16d5dbaccff5dee4b8ec0fd7f30fa8e6d27a9b202631384`, chunk 21 of `impl/src/coordination-store.mjs`.

## Finding: an out-of-scope orphan Context cell can deny every Context-aware run stop

Severity: high (stop/reap availability and authority isolation).

`_runStopTargets` invokes `_runStopContextTargets(targetRunIds)` for every `contextVersion >= 2`. That helper iterates **all** values in `_contextCells`. For each value it resolves `cell.sessionId` and throws `CoordinationRefusal(..., 'run_stop_integrity')` when the session is absent; only after that global ownership check does it test `targetRunSet.has(session.runId)` and `cell.state === 'admitted'`.

Consequently, one cell whose session is absent blocks target discovery for an unrelated run, including when that cell is not admitted. No route or state predicate limits the refusal to the requested run before it aborts the stop. The run therefore cannot reach an exact target digest or cleanup/reap settlement because unrelated Context state has acquired denial authority over its stop.

Remediation: enumerate cells from a durable per-run/session ownership index (or retain `runId` on the cell) and validate missing ownership only after establishing that the cell is in the requested run subtree. Handle out-of-scope orphans through a separate integrity/reconciliation path. Add coverage in which an orphan cell outside the target subtree coexists with an admitted target cell: target discovery must retain the target cell and must not let the orphan veto that run's stop.
