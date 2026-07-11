# Phase 11 control-integrity evidence

Date: 2026-07-11

Scope: CI1-CI6 in `spec/phase11/control-integrity-and-model-selection.md`.

## Red evidence

The first public-boundary suite was 0/9. It reproduced all six audit failures: lost verification
fields and mutable admission, false-success response delivery, kill-after-crash hanging, worker
prose promoted to fact, story task identity erased/double-counted, and replayed automatic IDs
colliding.

## Implemented boundary

- Brief admission validates, recursively snapshots JSON-compatible extension data, and freezes only
  the admission-owned graph.
- Response resolution reserves one consumer but commits only after `Ack{ok:true}`; refusal, missing
  Ack, and exceptions roll back to pending.
- Crash/exit stop is bounded and idempotent. Policy kill performs task cleanup without awaiting an
  impossible second confirmation.
- Digest construction separates hub-observed lifecycle data from model-authored stream and result
  prose.
- Story spawn identity is monotonic and one wire-confirmed turn is counted once.
- Replay advances numeric identity and durably terminalizes unattached in-flight sessions as
  failed/orphaned rather than fabricating control.
- Shipped driver cleanup deletes a terminal non-evidence checkout, metadata file, and task branch.

## Adversarial extensions

The first green pass still left three seams. Review added regressions and fixes for nested unknown
Brief fields retaining caller ownership, result summaries nested inside trusted lifecycle facts,
and restart replay presenting a session as working despite having no attached adapter. A missing
response Ack is also now a refusal rather than implicit success.

## Process-level smoke

The CI3 driver test starts the fake Claude wire as a real detached child through `createDriver()` in
a real temporary Git repository. A 150 ms wall budget produces exactly one timeout crash. Policy
kill then returns boundedly, the PID no longer exists, and `.baton/wt/timeout-reap`, its metadata,
and `baton/timeout-reap` are absent.

This is zero-provider-quota evidence. A provider-backed timeout/reap probe remains required before
recursive live multi-vendor work, and exact model mapping receives its own live probe after
MS1-MS5.

## Validation

- Focused CI suite: 14/14 passing.
- Bare `node --test` from `impl/`: 441/441 passing, 0 failed.
- `git diff --check`: clean.
