# KG Tiered-Loop Surveyor Report — run-lineage.mjs

- **Survey target:** `impl/src/run-lineage.mjs` (run-orchestrator lease machinery)
- **Attempt:** kg-loop-2026-08-01T06:16:12.963Z
- **Scope note:** `run-lineage.mjs` is 63 lines; it is the policy/capability/revocation contract surface for the run-orchestrator lease machinery (the admission guard itself, `_assertRunAdmissionOpen`, lives in the caller). All references below are to this file as surveyed.

## Lease issuance

- A run-orchestrator lease binds a working parent task carrying the `baton_orchestrator` capability. The capability set an orchestrator must hold is closed at `impl/src/run-lineage.mjs:14-16` — `RUN_ORCHESTRATOR_CAPABILITIES = ['run.context', 'run.start', 'run.status', 'run.stop']`.
- A lease is time-bounded: `leaseTtlMs` (default `30 * 60 * 1_000` = 30 minutes) is a required policy field (`run-lineage.mjs:1-2`, `run-lineage.mjs:27`), validated as a positive safe integer (`run-lineage.mjs:49-50`) and capped at 24 h (`run-lineage.mjs:58`).
- Issuance is gated on a normalized policy: `normalizeRunLineagePolicy` accepts only the base 5-field or extended 6-field key set at `schemaVersion: 1` and rejects non-integer/out-of-ceiling values (`run-lineage.mjs:39-62`). The REPL opt-in field leaves the 5-field policy digest byte-identical to pre-REPL deployments (`run-lineage.mjs:5-12`).

## Revocation

- Revocation is a closed taxonomy, not a free-form status: `RUN_ORCHESTRATOR_REVOCATION_REASONS = ['operator', 'parent_terminal', 'parent_run_stopping', 'session_revoked', 'superseded']` (`run-lineage.mjs:18-20`).
- `parent_run_stopping` is a first-class revocation reason (`run-lineage.mjs:19`). Because it exists, the settle-time ritual must complete before the parent run stops; a stop racing ahead of settlement would leave the parent's leases un-revoked and uncategorized.
- The remaining reasons cover manual intervention (`operator`), a terminal parent (`parent_terminal`), session teardown (`session_revoked`), and replacement (`superseded`).

## What the orchestrator must guarantee

- It must hold all four capabilities (`run.context`, `run.start`, `run.status`, `run.stop`) before issuing a lease (`run-lineage.mjs:14-16`).
- It must respect the lineage ceilings: `maxDepth` (default 4), `maxChildrenPerRun` (default 8), `maxDescendantsPerRoot` (default 32), and `leaseTtlMs` (default 30 min) (`run-lineage.mjs:22-28`), and must never run with an un-normalized policy (`run-lineage.mjs:39-48`).
- It must refuse a new lease for a parent whose run is stopping: the `parent_run_stopping` revocation reason (`run-lineage.mjs:19`) implies the admission guard — `_assertRunAdmissionOpen`, which throws `run_stopping` for stopped runs — must run at lease-issue time, so the settle-time ritual runs before run stop, not after.
