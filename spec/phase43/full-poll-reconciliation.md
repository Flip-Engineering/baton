# Phase 43 — full-poll reconciliation and source-health recovery

This contract completes AF7/AF8 without granting provider data decision, clearance, user-control,
or code authority. A sequence gap is sticky degraded state. Only a deployment-pinned, authenticated,
bounded full poll followed by a replay-valid store transaction may restore source health.

## PF1 — closed deployment poll card

A card advertising `poll` also carries a closed `poll` block: fixed HTTPS origin and operation,
`sequence` cursor semantics, initial cursor, no-redirect posture, and positive maxima for pages,
items, page bytes, total bytes, wall time, backoff, and authenticated-clock skew. The source implements `pollFull` and
`reverifyPollSync`; construction fails before authority if either is absent. Delivery/user input
cannot choose endpoint, provider, source epoch, cursor kind, key, policy, repository, or ceilings.

## PF2 — authenticated full-poll proof

`AdvisoryFeedRegistry.pollFull(providerId)` accepts only `{signal}`. The source returns private raw
page bytes plus bounded item bytes and a closed proof binding provider/card epoch, poll ID, observed
time, inclusive sequence window, final sequence, opaque cursor digest, raw page digests/bytes,
item raw digests in order, authentication receipt digest, and pinned key fingerprint. Registry
recomputes byte/item totals and each item digest, authenticates every item through the ordinary
`mode:"poll"` delivery verifier, and returns only sanitized proof plus verified delivery receipts.
Raw pages, item bytes, cursor values, headers, signatures, URLs, and secrets never leave the source
boundary or enter public logs/state.

## PF3 — durable staged admission

The Coordinator admits every verified poll receipt through the existing delivery transaction and
dedupe rules. A crash after any receipt leaves health degraded and the admitted receipt retryable;
it cannot advance the source cursor. Only after the complete poll set is durably admitted may the
Coordinator append `provider.reconciliation_completed`. Duplicate webhook/poll delivery identity
shares the same receipt/processing identity. No prefix is reported complete.

## PF4 — store-derived recovery CAS

The completion event binds repository, provider/source epoch, expected degraded-health event,
inclusive window/final sequence, exact ordered receipt IDs and sequence rows, poll proof digest,
actor, time, and completion digest. Under the writer lease the store rederives a contiguous window,
checks every receipt belongs to the source and poll proof, requires the proof observation to cover
the expected degraded-health event and remain fresh at completion within the deployment wall-time
and clock-skew ceilings, rejects cursor rewind or a final sequence below the observed high-water mark,
and invokes deployment `reverifyPollSync` over the sanitized proof.
Only then does health become `healthy`, with a completion event and cursor digest. No guard, Finding,
Decision, pending official work, or contamination is cleared.

## PF5 — races, idempotency, and replay

Same completion key and digest is zero-effect idempotent. A new delivery/gap committed first makes
the expected health CAS stale; a completion committed first establishes a new health baseline and a
later gap degrades it again. Same sequence/different bytes remains a permanent conflict. Replay is
zero-network and recomputes proof/card/key/window/receipt/sequence/event identities. Missing poll
reverification authority, proof mutation, receipt substitution, cursor rewind, or card rotation
fails readiness.

## PF6 — bounded single-flight scheduler

Automatic polling begins only after policy reconciliation and Coordinator readiness. There is one
in-flight poll per provider under the current writer epoch. Fixed capped backoff is deployment
configuration, not random provider input. Close first stops scheduling, aborts active polls, awaits
their settlement, prevents late store/log writes, then closes Coordinator authority and releases
the writer lease. Lease loss or close during any stage leaves health degraded and durable receipts
retryable. Two drivers cannot own the poller concurrently.

`createDriver({providerPolling:{intervalMs,initialBackoffMs}})` is the only automatic enablement
surface; both values are positive deployment constants and may not exceed each poll card's
`maxBackoffMs`. The returned supervisor exposes only sanitized status and no trigger authority.
Poll-enabled drivers close through idempotent `await driver.closeAsync()`. Their legacy synchronous
`close()` refuses with `driver_async_close_required` before stopping timers or releasing authority;
drivers without automatic polling retain synchronous `close()` compatibility.

## PF7 — sanitized authenticated reads

Operator web/MCP reads are repository-scoped, observe-authorized, count/byte bounded, and expose
only provider ID, source epoch, status, high/final sequence, first gap, cursor digest, last receipt/
reconciliation event, pending count, and current/historical processing summaries. They never expose
raw bytes, cursor values, signatures, auth receipts, key fingerprints, private paths, endpoint
inventory, other repositories, or machine-ingress/poll authority.

`createDriver({providerRead:{maxProviders,maxProcessing,maxBytes}})` pins all ceilings. Coordinator
`readProviderStatus({providerId?,after?,limit?},{repoId})` accepts only the deployment repository,
an optional configured provider, a public prior processing ID, and a positive limit no greater than
`maxProcessing`. It returns sorted health rows, `currentProcessing` pending summaries,
`historicalProcessing` terminal summaries, an optional `nextAfter`, and the coordination event
high-water. Rows contain only IDs/status/versions/counts and event numbers. If provider rows alone or
one processing row cannot fit `maxBytes`, the read refuses rather than truncating a row.

Authenticated web command `provider_status` and read-only MCP tool `fleet_provider_status` forward
the authenticated repo only; neither accepts actor, user, source epoch, cursor digest/value, card,
endpoint, key, or authorization fields. Web command admission/audit and MCP read audit remain the
existing northbound contracts; both require `observe`.

## PF8 — required red and live evidence

Red tests cover missing/unknown poll card fields; endpoint/cursor/ceiling injection; page/item byte
and count max/max+1; raw/item substitution; duplicate/conflicting receipt; incomplete window;
rewind; final below high-water; new-delivery CAS race; append failure; crash after each admitted
item; exact retry; replay mutation; card/key rotation; two poll owners; close during fetch/admission;
lease loss; backoff cancellation; and every sanitized-read non-leakage/scope bound.

Live evidence uses a local authenticated, no-redirect paged fixture and the fixed official oracle.
It creates a gap, admits a complete full-poll window, appends exactly one recovery event, retains all
official pending/guard state, replays with zero network, degrades again on a later gap, and proves
complete timer/process/worktree/runtime/branch/writer cleanup. Recursive Baton review begins only
after PF1–PF5 are green; PF6 must be green before enabling automatic scheduling.

This is local deployment-neutral state. No project-manager or homelab runtime is consulted,
mutated, or required.
