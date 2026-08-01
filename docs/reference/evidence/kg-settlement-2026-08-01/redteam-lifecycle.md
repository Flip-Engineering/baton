# KG settlement contract v0.9 — LIFECYCLE + ORDERING red-team (2026-08-01)

**Contract under attack:** `kg-settlement-decisions.md` (D1–D5, the settle-window ritual).
**Angle:** lifecycle (who lives, who dies, when) and ordering (what precedes what, what survives a crash).
**Grounding:** every claim is file:line against `impl/src/…` and the contract/gap-receipt docs.
**Method:** adversarial trace of the six attacks below against the shipped code (coordination-store.mjs,
coordinator.mjs, application.mjs, application-semantics.mjs, wave-driver.mjs, run-lineage.mjs) and the
demo receipt (`kg-tiered-loop-2026-08-01/kg-loop-verdict.md`).

## Verdict summary

| # | Attack | Verdict | Amendment? |
|---|--------|---------|-----------|
| 1 | Member claimed-terminal with pending scratchpad writes | _TBD_ | |
| 2 | Settlement task un-reaped after driver exit (promote never comes) | _TBD_ | |
| 3 | Default-on ledger growth worst case | _TBD_ | |
| 4 | D4 skips plan+link vs issue #59 re-drive continuity | _TBD_ | |
| 5 | Crash mid-hook exactly-once re-drive | _TBD_ | |
| 6 | Doubts elevate but never candidate — silent sink | _TBD_ | |

## Attack 1 — claimed-terminal while the scratchpad partition has pending writes

**Claim.** _TBD_

### Evidence trace
- wave-driver.mjs:660-680 settle window: _TBD_
- `turn.paused` vs terminal: _TBD_
- elevateTaskScratchpad's terminal precondition: _TBD_

### Verdict
**CONFIRMED-HOLE / DEFENDED / NEEDS-AMENDMENT** — _TBD_

**Amendment:** _TBD_

## Attack 2 — the settlement task stays working after driver exit (promote never comes)

**Claim.** _TBD_

### Evidence trace
- Lease TTL 30 min: run-lineage.mjs:22-28: _TBD_
- `parent_terminal` revocation: _TBD_
- Lingering task/lease rows: _TBD_

### Verdict
_TBD_

**Amendment:** _TBD_

## Attack 3 — default-on ledger growth per wave (worst case)

**Claim.** _TBD_

### Evidence trace
- MAX_SCRATCHPAD_SHARED_ENTRIES: _TBD_
- Per-member elevation + settle receipts + board items: _TBD_

### Verdict
_TBD_

**Amendment:** _TBD_

## Attack 4 — D4 skips plan+link; issue #59 re-drive continuity destroyed?

**Claim.** _TBD_

### Evidence trace
- D4 selection rule: contract D4 / D3:99: _TBD_
- Issue #59 re-drive continuity (run-lineage / recovery): _TBD_
- createAndClaimRecoveryRefinement:12128: _TBD_

### Verdict
_TBD_

**Amendment:** _TBD_

## Attack 5 — crash mid-hook: exactly-once re-drive?

**Claim.** _TBD_

### Evidence trace
- Crash between steps 2 and 3 (elevation vs settle): _TBD_
- Crash between lease materialization and board post: _TBD_
- waveId/runId derived keys (run-settlement:<waveId>, wave-settlement:<waveId>): _TBD_
- Idempotency mechanics in issueRunOrchestratorLease / elevateTaskScratchpad / admitWorkflowFinding: _TBD_

### Verdict
_TBD_

**Amendment:** _TBD_

## Attack 6 — doubts elevate but never candidate — silent sink?

**Claim.** _TBD_

### Evidence trace
- D3:104-106 note-only candidacy: _TBD_
- elevateTaskScratchpad doubt handling: _TBD_
- Disposition ledger for doubts: _TBD_

### Verdict
_TBD_

**Amendment:** _TBD_

## Cross-cutting findings

### Ordering: run_stopping enforcement vs settle-window
_TBD_

### Ordering: admission (16b lease revoke) vs task completion
_TBD_

### The one-act promote: lease revoke + task complete atomicity
_TBD_

## Appendix A — anchor map
_TBD_

## Appendix B — verdict-to-contract change list
_TBD_
