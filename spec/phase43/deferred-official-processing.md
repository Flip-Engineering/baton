# Phase 43 — durable deferred official processing

This contract completes the remaining AF3/AF6/AF8/AF10 retry gap. Provider hints remain pending and
blocking until official Quartermaster processing succeeds; failure history is operational state,
never a Finding, verdict, clearance, or provider authority.

## DP1 — deployment retry policy

`createDriver({providerProcessingSchedule})` accepts exactly positive `intervalMs`, `maxBatch`,
`maxAttempts`, `initialBackoffMs`, `maxBackoffMs`, and `maxStateRows`. Backoff is deterministic
doubling capped at `maxBackoffMs`; no provider/user input chooses it. Automatic processing requires
the existing deployment-owned official reconciliation authority and active reuse policy.

## DP2 — bounded due derivation

The store scans at most `maxStateRows`, returns at most `maxBatch` pending processing IDs in stable ID
order, and treats absent/null `nextAttemptAt` or a time no later than the injected clock as due.
Roots at `maxAttempts` remain visibly pending and blocking but are not auto-spent again. Repository
scope is fixed by deployment.

## DP3 — durable sanitized deferral

If official processing fails while the root is still the same pending version and receipt set, the
Coordinator appends one `provider.processing_deferred` event. The store derives the next attempt
number and exact delay from policy, binds repository/provider/source epoch, processing/version/last
receipt event, a closed non-sensitive failure code, actor, event time, next-attempt time, request
digest, and deferral digest. Messages, stacks, refs, URLs, dossiers, coordinates, credentials, and
provider bytes never enter the event.

## DP4 — races and new receipts

Completion committed first makes deferral stale. A new receipt committed first changes the last
receipt CAS and makes deferral stale; its arrival clears `nextAttemptAt` so the expanded root is due
immediately while retaining attempt history. Deferral append failure leaves the root pending with no
invented retry metadata. Exact deferral-key retry is zero-effect.

## DP5 — completion and replay

Green/adverse completion retains `attemptCount`, last failure/event history, clears
`nextAttemptAt`, and marks no further due work. Replay recomputes policy-derived attempt number,
delay/time, request/digest, and pending CAS. A changed retry policy refuses readiness rather than
reinterpreting old events.

## DP6 — supervised lifecycle

One `ProviderProcessingSupervisor` scan is scheduled or active per driver. A scan processes at most
`maxBatch` roots sequentially through existing `reconcileProviderProcessing`; failures are deferred,
success uses the existing atomic completion. Driver `closeAsync()` stops its timer, aborts and awaits
the scan, then closes the poll supervisor, Coordinator authority, and writer lease. Cancellation or
lease loss appends no late deferral.

## DP7 — bounded observation

PF7 processing summaries add only `attemptCount`, `lastAttemptEvent`, `lastFailureCode`, and
`nextAttemptAt`. Codes come from a closed taxonomy and timestamps are canonical. No retry trigger is
added to web/MCP; the surface remains observe-only.

## DP8 — red and live gates

Tests cover exact policy/max+1, first/doubled/capped delays, due ordering/batch/state ceiling,
failure-code sanitization, exact retry, new-receipt and completion races, append failure, max-attempt
exhaustion, replay policy/digest/time mutation, close during official fetch, lease loss, no late
write, PF7 non-leakage, and restart continuation. Live evidence injects one official outage, observes
one durable deferral, advances the clock, succeeds on retry, and proves timer/writer cleanup.

This is local deployment-neutral retry state. It has no homelab or project-manager runtime.
