# Phase 42 — policy-epoch invalidation and non-clearing guard migration

Phase 42 closes the safety gap left by immutable reuse subjects: changing Quartermaster's vet
policy must not let old-policy Decisions or advisory fences remain silently current. Reconciliation
is a deployment/startup transaction driven by the policy identity pinned in the registered
Quartermaster card. It is not a caller-supplied verdict, policy override, or positive clearance.

## PI1 — one deployment-owned policy identity

When `reuse.vet` is configured, the Quartermaster card exposes the SHA-256 identity of its complete
normalized vet policy and a fixed policy-schema identifier. `createDriver` derives the current hash
from the already registered/pinned capability card. A caller, environment variable, web command,
MCP argument, dossier claim, or persisted Decision cannot nominate the current hash. Reuse-decision
authority is unavailable when the card is absent, malformed, or disagrees with deployment policy
configuration.

## PI2 — reconciliation before authority is exposed

Driver construction synchronously reconciles the durable store to the pinned current hash before
returning a Coordinator. The first deployment records a baseline. A restart with the same policy is
a no-op. A different hash appends one immutable `knowledge.reuse_policy_reconciled` event before any
new decision, risk refresh, or current read can be admitted through that driver. Reconciliation
failure prevents driver construction; there is no usable partially reconciled coordinator.
The first baseline also reconciles any legacy live reuse Decisions or guards that predate policy-head
events; migration cannot grandfather unknown policy state.

## PI3 — atomic complete fan-out

The store, at append time, derives every live reuse Decision whose dossier policy hash differs from
the current hash, its still-live dossier Finding, all logged readers of those exact validity
versions, and every stored coordinate risk guard with a different policy hash. One append binds the
complete sorted target/guard sets and their digests. Decisions and dossier Findings close
bitemporally, validity versions advance once, artifacts remain byte-immutable, and affected reads
enter contamination in the same visibility boundary. Partial fan-out or caller-supplied targets are
impossible.

## PI4 — adverse fences never become clearance

An old-policy coordinate guard becomes explicitly `policyStale` and binds the transition event and
new hash. If it was adverse, it remains blocking until a later separately authorized positive-
clearance transaction exists. A policy change cannot delete, clear, downgrade, or resurrect a
guard, Decision, Finding, or reader. A new current-policy adverse observation may supersede the
stale guard through the existing Phase 39 transaction; a green observation still does not clear it.

## PI5 — synchronous admission and read safety

Once a policy baseline exists, `recordReuseDecision` and `recordReuseRiskGuard` require the exact
active hash inside their store validation boundary. `currentReuseDecision`, current knowledge
recall, and decision supersession cannot surface or extend an old-policy validity version. The
Decision subject continues to include the policy hash, but a different subject digest is not a
bypass: old-policy and new-policy subjects cannot coexist as current merely because their hashes
differ.

## PI6 — local causal knowledge projection

Each policy activation creates one observed local `Constraint` node for the exact repository,
policy hash, version, and transition. Changed-policy invalidation adds `Affects` edges from that
Constraint to every invalidated Decision. Evidence points to the reconciliation event itself;
grounding is `observed`, not `verified safe`. This is Baton's local deployment-neutral causal graph.
No project-manager or homelab runtime is consulted or mutated.

## PI7 — idempotency, cycling, and replay

The transition identity binds repository, previous hash/version, current hash, actor, event time,
target digest, and stale-guard digest. Exact same-policy restart writes nothing. A policy cycle
`A → B → A` is a new monotonic version, never an idempotent replay of the first `A`. Restart replay
recomputes the prior state, complete target/guard projections, contamination, graph identities,
versions, and transition digest before applying any projection. Missing, extra, reordered, stale,
future, or rehashed-forged fields fail closed.

## PI8 — races and failure atomicity

Target derivation and append occur synchronously in the CoordinationStore, serializing with
decision, supersession, TTL, and risk-guard mutations. Append failure exposes no new policy state,
validity closure, contamination, graph node, edge, or stale-guard marker. The next construction may
retry from the unchanged durable prefix. Generic knowledge invalidation cannot impersonate a policy
transition. A deployment-derived exclusive writer lease covers the entire exposed Coordinator
lifetime, refuses rolling overlap even when both drivers share one in-memory store object, and is
released on construction failure or explicit driver close. Unique short-lived claim files close
the pre-lease check/create race: overlapping live claims all fail closed and retry, a well-formed
dead claim may be reaped, and a malformed claim requires explicit operator recovery. Every raw
store mutation also acquires the same lease on first append. The exact on-disk token is checked on
every authority write, including same-policy activation. Close refuses locally owned idle or live
transports and in-flight authority operations until kill/reap completes; replay-only handles do not
pretend to own native resources. A terminal adapter Ack is sufficient cleanup evidence when no
later confirmation event can exist.

## PI9 — bounded observation surfaces

The existing authenticated `capabilities`/`fleet_capabilities` reads may expose the current policy
hash from the sanitized capability card. No new web/MCP mutation accepts a hash or target set.
Authenticated card and individual transition observation surfaces are bounded and expose immutable
policy evidence without credentials, filesystem paths, or provider prose. The internal
coordination snapshot intentionally retains the complete append-only policy-transition history and
is not represented as a cursor-bounded public API. The card and transition bind the complete
normalized, secret-free policy projection as well as its digest, so replay does not trust an opaque
hash. Deployment ceilings bound decision targets, guard targets, affected reads, examined state
rows, observed legacy policy hashes, and complete event bytes; a max+1 transition refuses before
append. Replay additionally enforces sorted unique normalized policy lists, no allow/deny overlap,
actor/key bounds, monotonic event time, authoritative Finding creation lineage, and exact graph
identities.

## PI10 — red, replay, and live gates

Tests must prove baseline activation, same-policy restart, `A → B → A`, complete multi-subject
fan-out, exact decision/Finding contamination, immutable artifacts, old-policy admission refusal,
adverse-guard stale-but-blocking behavior, clean current reads, append failure, target/guard/digest
replay tamper, capability-card mismatch, and absence of caller policy fields. A live proof restarts
Baton over one durable store with two real normalized Quartermaster policies, performs no provider
network request during reconciliation, and leaves all process/worktree/runtime state reaped.
Tests also cover exact old-key historical retry with no reverification, shared-store writer overlap,
max+1 ceilings, and forged/mismatched policy cards.

## PI11 — explicit non-authority

This phase performs no dependency install, package-manager invocation, policy authoring, waiver,
positive clearance, Decision resurrection, proposed-plan approval, `internal` decision, code edit,
Git merge, verification acceptance, publication, provider listener, or external knowledge export.

## PI12 — retained next contracts

Adverse-only provider feed/webhook/poll ingestion is next. Independently verified Sigstore/SLSA,
the exact `internal` decision, trusted advisory-to-symbol/release identity, true vulnerable-function
reachability, proposed-plan approval, positive clearance/non-resurrection, high-level
`fleet_reuse`/`fleet_provenance`, added ecosystems, optional Socket/full SCA, and deeper Cairn remain
separate catalogued contracts. Cross-policy Decision resurrection or semantic Decision
`Supersedes` remains pending: policy reconciliation preserves history and closes prior subjects but
does not fabricate a new-policy Decision. Phase 42 does preserve guard-to-guard and risk-Finding
`Supersedes` lineage when fresh current-policy adverse evidence replaces a stale fence. There is no
homelab integration.
