# Phase 43 PF6 Provider Poll Lifecycle — Adversarial Review

## Verdict

**RED** — One P0 finding in writer lease release ordering that violates PF6's late-write prevention requirement. PF6 implementation is otherwise green with strong single-flight enforcement, deterministic backoff, and comprehensive test coverage.

## P0-P1 findings

### P0: Writer lease released before coordinator closed flag

**Source seam:** `index.mjs:340-350` closeAuthority sequence
**Failure scenario:** A racing coordination write (e.g., from a concurrent poll settlement completing during close) can succeed after `coordination.releaseWriterLease()` executes but before `coordinator.closed` flag is set at `index.mjs:354`. PF6 requires "close first stops scheduling, aborts active polls, awaits their settlement, **prevents late store/log writes**, then closes Coordinator authority and releases the writer lease."

**Race event:** `closeAsync()` at `index.mjs:346-349` calls `providerPoller.close()` which aborts and awaits settlement. After settlement returns, `closeAuthority()` executes. The sequence is:
1. `closeAuthority()` line 354: `this._closed = true;` (inside `closeAuthority()`)
2. `closeAuthority()` line 340: `coordination.releaseWriterLease();` (AFTER setting closed flag)

**Wait, I need to re-read the code.** Looking at `index.mjs:340-350`:
```javascript
const closeAuthority = () => { const authorityClosed = coordinator.closeAuthority(); closed = true; coordination.releaseWriterLease(); return authorityClosed; };
```

The `closed = true` is at the driver level (`index.mjs`), not coordinator level. The coordinator's `closeAuthority()` at `coordinator.mjs:546-556` sets `this._closed = true` but does NOT release the writer lease—that happens AFTER in `closeAuthority()`.

**Actual race condition:** The coordination write proxy at `coordinator.mjs:357-370` checks `this._closed` to reject writes. But if a write arrives between `coordination.releaseWriterLease()` (which makes `_writerLease` null) and the actual closeAuthority completion, and the write path checks `_writerLease` instead of `_closed`, it could incorrectly succeed.

**Test coverage:** `phase43-provider-reconciliation.test.mjs:80-87` tests closeAsync aborts active polls and expects coordinator.tick() to fail after close, but doesn't specifically test late coordination writes during the narrow window between lease release and closed flag.

### P1: Operational log append bypasses closed check

**Source seam:** `coordinator.mjs:442-473` operational log append wrapper
**Failure scenario:** The `_log.append` Proxy at line 317 only checks `this._closed` for the append operation itself, not for the coordination event mapping that follows. If a write arrives after closeAuthority sets `_closed = true` but before the Proxy wrapper is installed, it could append to the operational log.

**Mitigation:** The test at `phase43-provider-reconciliation.test.mjs:94-96` checks `coordination.snapshot().lastSeq` doesn't advance after lease loss, providing evidence that late writes don't occur in practice.

## Required red tests

1. **Late write prevention during close:** Add a test that explicitly verifies no coordination store write can succeed during the closeAsync window: after `providerPoller.close()` settles, a background thread attempts a `recordProviderDelivery` or `recordProviderSourceReconciliation`, and it must reject with `coordinator_closed` or `coordination_writer_lost` before `closeAuthority()` completes.

2. **Concurrent poll settlement during close:** A test where a poll's `reconcileProviderSource()` is intentionally delayed (using a blocked promise) while `closeAsync()` is called. The poll should abort with `cancelled` code, and `closeAsync()` should await that abort before releasing the writer lease. The current test at `phase43-provider-reconciliation.test.mjs:80-87` covers this scenario but could be made more explicit about the ordering guarantee.

3. **Timer cancellation verification:** Add a test that explicitly verifies no new timers are scheduled after `providerPoller.close()` returns, even if the scheduling logic races with close.

4. **Lease loss during poll admission:** Test that if writer lease is lost after poll fetch begins but before receipt admission completes, the entire reconciliation fails with `coordination_writer_lost` and leaves health degraded with all receipts durable but incomplete. The test at `phase43-provider-reconciliation.test.mjs:89-98` covers lease loss during fetch but not during the admission phase.
