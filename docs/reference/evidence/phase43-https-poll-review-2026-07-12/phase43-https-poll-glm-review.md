# Phase 43 PF8 HTTPS HMAC Provider Polling — Adversarial Review

## Verdict

**APPROVE with P1 finding** — PF1–PF8 ship as specified with correct isolation, replay validity, and live recovery proof. All declared security properties hold: fixed HTTPS origin with no-redirect enforcement, bearer and raw cursor secrecy, exact HMAC domains, timing-safe comparison, private per-call poll authority, staged-item failure boundaries, webhook/poll byte identity, private-CAS receipt replay, zero-network proof replay, and page/item/count/byte/time bounds. The live evidence substantiates recovery, restart, re-degradation, and cleanup claims. One P1 finding represents an unbounded read resource risk on abort that requires red-test coverage.

## P0-P1 findings

### P1: Unbounded chunk accumulation on abort admits resource exhaustion

**Seam:** `https-hmac-advisory-feed.mjs:31` and `https-hmac-advisory-feed.mjs:74`

**Event/Mutation:** When `ctx.signal` aborts during response streaming, the `'data'` handler continues reading chunks without bound before the request actually destroys. The `failed` flag prevents pushing to the `chunks` array, but `bytes` accumulates every chunk's length even after `abort`. An attacker with a fake source could open a slow connection, respond with headers that pass validation, then stream megabytes before the client aborts due to wall-time deadline or explicit cancellation. Each chunk increments `bytes` unchecked, requiring O(total-attacker-bytes) work before the request finally closes and throws.

**Evidence:**
- Line 31: `bytes += chunk.length; if (bytes > opts.maxBytes) { failed = true; ... }` — the check only throws after exceeding, never aborts early
- Line 74: Redirect detection throws, but earlier streaming is not limited
- No AbortSignal listener attached to `req` to stop reading when `signal.aborted` becomes true

**Failure Scenario:** Malicious provider opens HTTPS connection, sends valid headers, then streams 1GB at 1 MB/s over TLS. Client hits `maxWallMs` deadline, aborts, but continues consuming 1GB before `req.destroy()` finally takes effect, denying service to other operations.

**Severity:** P1 — Does not breach isolation or replay, but admits CPU/memory exhaustion that could starve Coordinator or crash the process. Not P0 because the attacker must already control the network endpoint (auth required) and the attack is bounded by OS/socket timeouts.

### P2: No coverage for abort timing windows across page boundaries

**Seam:** Live evidence lacks multi-page abort scenarios

**Event/Mutation:** The live test runs a successful 2-page poll then proves recovery. It never aborts mid-pagination, never aborts during the second page fetch, and never verifies that abort leaves durable state retryable without advancing the cursor or admitting partial items. Red-test gap: need a fixture that aborts on page 1 of 2 and proves Coordinator state is `reconciliation_required` with no receipts admitted and no cursor advancement.

**Severity:** P2 — The implementation is correct (line 68 checks `ctx.signal?.aborted` before each page, line 130 `AbortSignal.any` composes cancellation), but live evidence does not prove abort-at-page-boundary correctness.

## Required red tests

1. **Abort streaming excess** — Fixture sends valid headers then streams unbounded chunks beyond `maxPageBytes` before the test calls `controller.abort()`. Assert that total bytes processed is bounded by a reasonable multiple of `maxPageBytes` (e.g., < 2×) and that the request throws `cancelled` without `oversize`. This proves abort cannot be weaponized for OOM.

2. **Abort during page 2 of 3** — Fixture returns valid page 1 with `nextCursor`, then on page 2 the test calls `abort` after request initiates but before response completes. Assert Coordinator status is `reconciliation_required`, zero receipts admitted, cursor unchanged, and a subsequent successful full poll from sequence 1 recovers to `healthy`. This proves abort-at-page-boundary failure boundaries.

3. **Concurrent poll with same pollToken object** — Two concurrent `pollFull` calls pass the same literal `pollToken: Object.freeze({})` reference. Assert the second call throws `provider_auth_invalid` because the first consumed the item's queue entry. This proves per-call isolation enforcement (though the token is already private to the implementation boundary).

4. **Replay without network after source close** — After `driver.close()`, assert `reverifyPollSync` still succeeds against the stored proof. The current test checks this implicitly (`zeroNetworkReplay`), but explicitly verify that `replay.coordination.providerSourceHealth('repo-live', 'fixture.live', epoch).status === 'healthy` happens without any new `stats.requests` increment. The test passes this check already, so this is a strengthening of existing coverage rather than a new gap.