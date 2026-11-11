# Phase 84 context successor-wave review

Source reviewed: immutable context partition `0bbb4632be1f56f494984db60165c31926adc7c8129feb27f2fde2cf904735bc`, from `impl/src/coordination-store.mjs`.

## Finding: terminal failures cannot record resource release

**Severity: High — stop/reap truth is rejected for valid terminal outcomes.**

`_contextMapSettlementChildren` treats a child as terminal through `TERMINAL.has(task.status)` and then explicitly distinguishes `completed` from “failed or cancelled” children. In the same partition, `_validateTaskResourceReleasePayload` rejects a release unless `task.status === 'completed'`, reporting every other status as a stale target.

Consequently, a failed or cancelled task can be terminal, retain an exact `taskVersion`, `terminalEvent`, assignee, and operational cleanup attestation, yet its resource-release record is categorically refused before the detailed process, worktree, runtime, and session proofs are evaluated. A stop or failure path therefore cannot durably preserve its truthful cleanup result through this validator; only successful execution can do so.

The validator should admit every terminal status represented by `TERMINAL` while retaining its existing exact bindings to task version, terminal event, worker, run, mapped evidence, and release digest. Failed and cancelled cases should be checked to confirm that valid cleanup evidence is accepted and stale or mismatched evidence remains refused.
