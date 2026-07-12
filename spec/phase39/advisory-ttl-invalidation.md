# Phase 39 — advisory refresh and TTL invalidation

Phase 39 makes Phase 38 reuse decisions temporally safe after they are recorded. Expired evidence
must stop appearing current even before a durable sweep. A Coordinator-owned fresh advisory
review must install an exact-coordinate evidence fence and invalidate every matching live Decision
atomically, so a still-unexpired cached green dossier cannot race the adverse observation and
recreate an unsafe borrow decision.

## RI1 — authority and closed request

The sole control is `Coordinator.recheckReuseDecision(request, ctx)`. Deployment configures a
separate `reuseDecisionPolicy.authorizeRecheck` callback. Authenticated actor, configured `repoId`,
bounded idempotency key, exact `decisionId`, positive expected validity version, closed trigger
`advisory_refresh|ttl_expired`, and positive budget are required. Client-supplied actor, package,
advisory, verdict, source, timestamp, affected-reader, or invalidation fields are forbidden.

## RI2 — honest advisory source

For `advisory_refresh`, the Coordinator derives ecosystem/package/version/index epoch from the
immutable seed decision and internally invokes `reuse.vet` with `refresh:true`. It then freshly
reverifies the returned content-addressed dossier and raw official sources. The caller cannot
supply a dossier or claim a provider push. This phase is explicit pull-to-refresh; provider webhook
or polling-daemon ingestion remains a later source adapter over the same store transaction.

## RI3 — exact coordinate evidence fence

Every adverse advisory review advances a store-owned observation for the exact
`ecosystem/package/version` coordinate. The observation binds dossier/fact/policy digests,
recommendation, evidence `asOf`/`expiresAt`, mapped operational evidence, and whether borrowing is
blocked. A Phase 38 borrow record is refused inside the synchronous store admission boundary.
A green refresh may be recorded as checked, but this phase never clears an adverse fence or
resurrects an old Decision; positive clearance requires a later explicit contract.
An adverse refresh that advances only observation metadata while retaining the same canonical fact
does not invalidate or hide an exact `build` already grounded in that fact. Borrow remains fenced.

## RI4 — atomic fan-out

One replay-validated `knowledge.reuse_risk_guarded` event records the review and, when adverse,
changed, invalidates every currently-live reuse Decision for the exact coordinate. The store—not
the async Coordinator—derives the target set and affected reads immediately before its single
append. A decision admitted before the fence is included; a stale borrow attempted after the
fence is refused. Decision/replacement/invalidation races therefore serialize without a gap.

## RI5 — TTL safety before sweep

Phase 38 Decision nodes carry their dossier `expiresAt`. Default current recall and
`currentReuseDecision` exclude them at `now >= expiresAt`, even if no invalidation event has yet
been appended. Historical `asOf < expiresAt` remains available. `ttl_expired` appends a durable
`knowledge.reuse_ttl_invalidated` event only at or after the exact stored expiry and uses that expiry as
`effectiveAt`; it does not silently refresh or extend evidence.
An exact idempotent retry of a previously logged read returns the immutable original node snapshots
at the original `asOf` and is explicitly labelled historical; it never rehydrates mutable current
objects. A new current read still excludes expired or invalidated content.

## RI6 — contamination semantics

Each invalidated Decision receives `validTo`, an incremented validity version, and an exact
invalidation event reference. Contamination records every logged reader of the invalidated
validity version so downstream work can be conservatively rechecked. Decision and evidence
artifacts stay byte-immutable; the stale dossier Finding receives the same validity closure while
the actual-lockfile SBOM Finding remains live.

## RI7 — lineage and replacement

The subject lineage head remains the invalidated decision. `currentReuseDecision(subject)` returns
null, while `reuseSubjectHead(subject)` returns the historical head. Replacement still requires an
explicit Phase 38 `Supersedes` request at the incremented validity version; silent replacement and
double contamination remain forbidden.

## RI8 — idempotency and conflict identity

Exact recheck retry returns before network or new writes. Same key with different request bytes
conflicts. The event has a canonical review/invalidation digest. Two invalidators or an invalidator
racing replacement admit only the store-order winner. Phase 38 also durably binds a second
idempotency key that resolves to an already-existing identical decision, so future retry does not
repeat reverification.
Replay recomputes the request digest from actor, repository, decision, positive CAS version, and
closed trigger; advisory operational evidence binds that version independently of the event digest.

## RI9 — replay integrity

Restart recomputes request/review/invalidation digests, exact coordinate, source-event mapping,
actor, temporal ordering, observation advancement, target set, validity versions, affected reads,
immutable logged-read snapshots, and the coordinate fence before applying any projection. Sparse/unknown fields, forged outcomes,
future times, omitted targets, substituted evidence, reordered readers, or a partial physical tail
fail closed.

## RI10 — northbound control

Authenticated HTTPS exposes `reuse_recheck`; fixed-principal MCP exposes
`fleet_reuse_recheck`. Both preserve actor/repository/idempotency authority, charge advisory
refresh more heavily than local TTL expiry, and return bounded typed failures. Authentication,
authorization, quota, and repository scope fail before Coordinator dispatch.

## RI11 — red tests and live proof

Tests cover the expiry boundary without sweep, historical recall, durable TTL contamination,
internally forced refresh, adverse fence race in both orders, all matching Decision fan-out,
blocked stale borrow, non-clearing green refresh, concurrent CAS, exact retry/conflict, persisted
decision-key alias, replay tamper, append failure, and real web/MCP actor propagation. Live proof
uses current official deps.dev/OSV observations against a clean temporary repository and performs
no credential emission.

## RI12 — explicit non-authority and next boundary

This phase performs no install, package-manager invocation, lockfile/code mutation, Git merge,
verification acceptance, publication, policy override, project-manager export, or homelab
integration. It claims no provider push listener and no vulnerable-function reachability.
Additional ecosystems, a daemon/webhook source adapter, true reachability prioritization, proposed
install graph deltas, Socket, and independent Sigstore/SLSA verification remain explicit later
rungs.
