# Phase 43 — adverse-only provider signal ingestion

Phase 43 turns authenticated provider webhook/feed/poll deliveries into crash-safe refresh work. A
delivery is an authenticated hint, not an advisory verdict: Baton must independently refresh and
reverify the deployment-pinned official source before it may install a risk guard. The phase can
add or retain adverse authority but cannot clear, waive, resurrect, install, approve, or decide.

## AF1 — deployment-owned source identity

Each enabled source has one immutable card binding provider/source ID, schema, channel
`webhook|poll`, fixed HTTPS origin/operation or callback method/path, signature algorithm and key
fingerprints, coordinate ecosystem, cursor semantics, private raw-receipt store, and every byte/
item/time/concurrency ceiling. Source, issuer, algorithm, key/JWK material, endpoint, callback URL,
policy, repository, and ceilings are deployment configuration; no delivery body, header, user
command, worker, dossier, or environment value may select them. A source-card change creates a new
explicit source epoch rather than silently reinterpreting old receipts.

## AF2 — exact machine authentication and durable receipt

Webhook authentication verifies a domain containing the exact raw body bytes, HTTP method,
canonical callback path, provider timestamp, delivery ID, and body digest before strict closed JSON
parsing. Duplicate/conflicting signature, timestamp, delivery, content-encoding, or identity headers
fail closed. Body-selected algorithms, JWK URLs, callback URLs, redirects, and provider IDs are
forbidden. HMAC comparison is constant-time; asymmetric verification uses only pinned public
material. Key rotation is an explicit bounded pinned overlap set.

The machine ingress is separate from user OIDC/cookie/CSRF/control authority. It accepts only the
fixed HTTPS route and provider/repository scope. A webhook may return 2xx/202 only after an immutable
`provider.delivery_received` receipt binds provider/source epoch, delivery ID, raw private-CAS ref/
digest/bytes, authentication receipt and key fingerprint, occurred/received time, sequence/cursor,
closed candidate coordinates, and content identity. Same provider+epoch+delivery ID and digest is an
exact duplicate; the same ID with different bytes conflicts. Signatures, secrets, auth headers, raw
provider prose, filesystem paths, and credential values never enter public logs, responses, cards,
or knowledge.

## AF3 — closed hint and pending admission fence

A normalized delivery contains only bounded exact candidate coordinates and optional provider-
namespaced advisory IDs needed for reconciliation. It cannot supply an adverse/green verdict,
guard, target set, affected validity version, policy hash, dossier, official result, clearance,
install/plan choice, command, URL, or prose. Before receipt processing completes, each candidate
coordinate has an explicit pending-reconciliation admission fence. It is not an adverse Finding or
safety claim, but current borrow/build/internal admission fails closed with
`reuse_provider_pending` so a decision cannot race an acknowledged delivery.

If official refresh is unavailable, incomplete, stale, or divergent, the receipt remains pending
and retryable. A freshly reverified non-adverse observation may resolve only that pending hint as
`ignored_non_adverse`; it cannot change an existing guard, reopen a Decision/Finding, remove
contamination, or act as positive clearance.

## AF4 — independently refreshed official fact

The Coordinator derives each exact coordinate from the admitted receipt and invokes the pinned
Quartermaster `reuse.vet` operation with `refresh:true`. It freshly reverifies the returned dossier,
private official source refs, exact coordinate, current policy hash, fact digest, `asOf`/expiry,
advisory IDs, and malicious flags. Callback/poll bytes never substitute for this observation.

Only a current adverse official observation can append `knowledge.reuse_provider_guarded`. A signed
false adverse hint with a green official refresh is ignored as a hint. A provider signal that names
no current Decision is still processed and retained; the transaction is coordinate-owned rather
than dependent on a caller-selected seed Decision.
The guard's `effectiveAt` is exactly the freshly reverified official observation's `asOf`, never the
provider receipt's occurred/received time. The receipt grounds delivery and coordinate selection;
the official fact alone grounds both adverse meaning and its effective time.

## AF5 — monotonic multi-source adverse union

Per-coordinate state retains immutable adverse observations by `(sourceId, sourceEpoch,
officialFactDigest)`, including provider-namespaced advisory identities. A new adverse observation
unions with all prior provider and manual Phase 39 adverse lineage. Empty/green/delete/withdraw/
correction events, newer omission, successful polling, key rotation, provider recovery, policy
change, or one source's state cannot clear, replace, downgrade, or hide another source. The
aggregate coordinate fence stays blocked until a separate future positive-clearance transaction
explicitly addresses every retained adverse source.
A future clearance transaction must enumerate and address every then-active `(sourceId,
sourceEpoch, officialFactDigest)` contribution. Partial-source clearing is forbidden.

## AF6 — store-serialized fan-out and policy races

Receipt admission, pending fences, official processing, and adverse fan-out serialize under Phase
42's exact-token writer lease. The store derives all live exact-coordinate Decision, dossier/risk
Finding, and reader targets immediately before one adverse append under the active policy epoch.
A Decision committed first is included; an adverse append committed first fences later admission.
Supersession/manual-refresh/provider/policy-transition races cannot double-invalidate or omit a
current target. If policy changes during asynchronous refresh, the official result must be retried
or rejected for active-policy mismatch; an already-appended adverse guard migrates through Phase 42
as stale-but-blocking.
Provider contributions themselves remain policy-independent immutable history. Their policy-bound
aggregate risk projection participates explicitly in Phase 42 guard targeting/migration; a policy
change may stale and reproject that aggregate but cannot delete any contribution.

Multi-coordinate delivery is atomic at receipt/pending admission. Processing may use deterministic
replayable per-coordinate children only when one completion root binds the complete coordinate set,
processed/failed identities, and cursor; no prefix can be acknowledged as complete or exposed as
unfenced. Append failure exposes no partial receipt, cursor advance, guard, validity closure,
contamination, node, or edge.

## AF7 — ordering, cursor, and idempotency

Receipts bind provider sequence/cursor when available, provider occurrence time, hub receipt time,
source epoch, raw/content digest, and schema/card digest. Future/invalid time, same sequence with
different content, silent cursor rewind, and content substitution fail closed. A sequence gap marks
the source `reconciliation_required` and schedules bounded full polling; it is never reported
healthy. An out-of-order adverse hint is not discarded merely because a later cursor exists: it may
still trigger a current official refresh.

Late arrival of every numerically missing delivery does not silently restore health because numeric
sequence coverage alone cannot prove provider cursor completeness. Only a future explicit
`provider.reconciliation_completed` transaction may return the source to `healthy`, after a pinned
full-poll operation proves its final cursor/window, admitted receipt set, and absence of unresolved
conflicts under the current source epoch.

Exact delivery retry returns the original receipt/processing identity without network. A second
delivery ID with identical semantic content aliases the existing refresh work rather than spending
new official-call/fan-out quota. Old retry after a later official observation or policy epoch
returns its immutable result with separate `current:false, historical:true`; it never substitutes
the newest aggregate guard.

## AF8 — crash continuation and poll lifetime

Receipt and processing are two durable identities. Crash after authentication/CAS but before
receipt returns retryable failure; crash after receipt but before refresh resumes the pending work;
crash after official fetch/reverify but before guard repeats safely; crash after guard but before
completion/cursor dedupes from the guard identity; crash after append but before webhook response
returns the exact duplicate on retry. Poll cursor advances atomically with durable receipt admission
or uses explicit fetched/admitted states so restart cannot skip an item.

Pollers start only after policy reconciliation and Coordinator readiness, run single-flight per
source under the current writer epoch, use fixed no-redirect HTTPS operations, bounded pages/items/
bytes/wall time and capped jittered backoff, and share receipt dedupe with webhooks. Driver close
first stops scheduling, aborts and awaits in-flight fetch/processing, proves no timer/child/runtime
ownership, then releases writer authority. Lease loss fences poll work and no late operational write
may cross handoff.

## AF9 — local causal provenance

Each authenticated receipt is an `observed` local source node/evidence record because sender and
delivery were authenticated but adverse meaning was not yet independently established. Each official adverse
Finding/guard is `DerivedFrom` its receipt and freshly reverified official evidence, then `Affects`
the exact invalidated Decisions/Findings. Aggregate source lineage remains queryable historically;
grounding is `observed` for authenticated delivery and `derived` for risk projection, never
`verified safe`. This extends Baton's local deployment-neutral causal graph only. No external
project-manager or homelab runtime is consulted or mutated.

Pending reconciliation is processing state, not a knowledge claim: it is exposed through bounded
pending/currentness metadata and the typed `reuse_provider_pending` admission reason, but does not
create a Finding or a second causal node. The receipt `Source` node binds the processing identity;
the later official adverse transaction creates the first derived Finding and its explicit receipt
and official-evidence lineage. This avoids presenting an authenticated hint as adverse knowledge.

## AF10 — bounded replay and observation surfaces

Deployment ceilings cover unauthenticated peer/header/body/compression work, authenticated
deliveries/window, concurrent verification, queue depth, JSON depth, ID/text bytes, coordinates,
advisories, pages, private CAS bytes, official calls/source bytes, targets, guards, affected reads,
event bytes, and total wall time. Each exact max passes; max+1 refuses without 2xx, cursor movement,
or partial projection and leaves a recoverable pending/degraded source state where a durable receipt
already exists.

Zero-network replay recomputes receipt shape, raw CAS digest/bytes, source/card/key fingerprint,
delivery/content identity, cursor/time order, official refs and `asOf`, current policy, complete
targets/read sets, graph identities, and event digests. HMAC replay is described honestly as
validation of the durable local authentication receipt unless a protected historical keyring is
explicitly retained; it is not independent third-party proof. Authenticated operator web/MCP reads
expose only bounded sanitized receipt/health/currentness metadata, never machine ingress authority,
raw bodies, signatures, paths, secrets, or cross-repository inventory.

## AF11 — red, replay, and live gates

Tests must cover signature/body/header/path/provider/key/timestamp mutation; duplicate JSON and
unknown fields; same-ID conflict and semantic alias; pending admission; false signed hints; green/
empty/withdraw/correction non-clearance; multi-source union; seedless coordinates; decision,
supersession, manual-refresh, provider, and `A → B` races; every crash boundary; webhook/poll dedupe;
cursor gaps/rewind; two poll owners; close during fetch; lease loss; every max/max+1 ceiling; replay
tamper; current/historical retry; and secret/path/inventory non-leakage.

Live proof uses a local authenticated callback fixture and a fixed injected official oracle, then a
bounded poll fixture over the same delivery, proving one receipt, one current adverse fan-out,
zero-network replay, exact duplicate behavior, pending recovery, two-driver exclusion, and complete
timer/process/worktree/runtime/branch/writer reap. Recursive Baton review begins only after these
safety gates pass.

## AF12 — explicit non-authority and retained scope

This phase provides no positive clearance, waiver, policy override, Decision resurrection,
provider-driven `borrow|build|internal`, install, package-manager execution, plan approval, true
vulnerable-function reachability, verification acceptance, merge, publication, user-control
credential, or external knowledge export. Trusted release/advisory-to-symbol identity,
independently verified Sigstore/SLSA, the exact `internal` decision, clearance/non-resurrection,
additional ecosystems/providers, Socket/full SCA, composite `fleet_reuse`/`fleet_provenance`, and
deeper Cairn remain separate catalogued contracts. There is no homelab integration.

## Implementation checkpoint — seedless adverse transaction

Commits `3c491af` and `40cf1d1` ship the seedless store transaction for green, mixed, and adverse
processing roots. The store retains immutable provider contributions separately from replaceable
manual guards, derives one grow-only per-repository exact-coordinate aggregate, fans it out to all
live Decision/dossier targets under the writer lease, drains the complete pending root in the same
append, and projects receipt → official Source → contribution Finding → aggregate Finding causal
lineage. Policy A → B invalidates only the policy-bound aggregate Finding and marks the guard stale
but blocking; contribution Findings remain immutable history. A later current-policy adverse fact
reprojects the union, while green cannot clear it.

The production Quartermaster integration accepts only its closed npm identity schemas: exact
`ecosystem/package/version`, optionally plus pinned `system:"NPM"`. Any additional identity field
or mismatch leaves processing pending. Still unshipped in this phase are production HTTPS route
assembly, cursor/full-poll reconciliation completion, poll ownership/close/drain, durable deferred
attempt scheduling, bounded authenticated receipt/health/currentness reads, and their live fixture.
