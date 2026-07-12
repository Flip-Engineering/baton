# Phase 38 — immutable reuse decision and causal promotion

## RD1 — authority and closed choice

`Coordinator.decideReuse()` is the only decision authority. Deployment must bind one `repoId`,
an exact actor/subject authorization callback, and byte ceilings for `need` and `rationale`.
Authenticated web `reuse_decide` and MCP `fleet_reuse_decide` preserve their derived actor. Client
actor fields, `internal`, unknown fields, malformed supersession, and an unconfigured authority
refuse. `internal` remains catalogued but requires a later exact `reuse.internal` decision contract.

## RD2 — fresh exact evidence

Every `borrow|build` decision requires a Phase 36 exact npm dossier and Phase 37 actual-lockfile
SBOM. Coordinator freshly reverifies both ref-addressed artifacts. Dossier reverify checks policy,
TTL, raw source digests, exact query, and reruns Atlas against the trusted worktree to match the
effective overlay. SBOM reverify reruns the exact lockfile. Ref-only claims work; caller payload is
not authority. Only `borrow_candidate` may authorize `borrow`; blocked or pending evidence may
explain `build` but is never waivable.

## RD3 — environment and projection binding

The deployment resolver requires its one configured repo ID and a clean Git worktree. The immutable
environment reference binds Git tree SHA, Atlas epoch/effective-overlay digest, and lockfile digest.
The mapped coordinator reverify fact and decision both bind a canonical digest of the complete
dossier ref/snapshot and SBOM ref/snapshot. Cross-repo, cross-epoch, dirty-tree, changed-lockfile,
changed-overlay, sparse-field, byte-count, and replay-substitution splices refuse.

## RD4 — content-addressed fleet artifacts

The event registers exact fleet-owned dossier and SBOM manifests plus a decision artifact. Evidence
artifacts use `owner.kind=capability-evidence`; the decision uses `owner.kind=decision`. The decision
identity digest and exact content digest are separate. The content digest hashes the complete record,
including explicit `installAuthority:false`, `mergeAuthority:false`,
`verificationAuthority:false`, and `policyOverride:false`. Generic task-artifact supersession cannot
mutate these fleet artifacts.

## RD5 — one replay-validated transaction

One `knowledge.reuse_decided` coordination append is the visibility boundary. Its replay validator
recomputes identities, evidence projection, manifests, actor, temporal order, and reserved graph
names before materializing any state. Append failure exposes no artifact, Finding, Decision,
allowlist row, or edge. A truncated physical tail remains a global `truncated_tail` failure.

## RD6 — causal knowledge projection

The transaction creates or reuses evidence Artifact nodes, creates derived dossier/SBOM Findings,
and creates one actor-observed Decision. `DerivedFrom`, `Informed`, and `ProducedBy` edges make the
causal chain explicit. “Derived” means evidence integrity and policy projection were verified; it
does not relabel a package “verified safe.” Reserved artifact/node identities cannot be squatted by
generic task or knowledge writes.

## RD7 — immutable subject and exact idempotency

The subject digest includes configured repository/effective tree, normalized need, exact package
coordinate, Atlas epoch, and policy hash. The decision identity additionally includes actor, choice,
rationale, evidence projection, and optional supersession. A durable preflight request digest makes
an exact direct retry return before network, reverify, or append; the same key with different request
bytes conflicts. A live subject cannot be silently replaced.

## RD8 — supersession and contamination

A changed judgment requires `{decisionId, expectedValidityVersion}` for the same live subject.
Compare-and-swap admits one concurrent replacement. The new Decision points to the old with
`Supersedes`; the old node is invalidated, never deleted or mutated as an artifact. Previously logged
knowledge reads appear in the same event's contamination projection and replay identically.
If policy/advisory machinery already invalidated the old Decision, an exact-version supersession
may replace it without incrementing validity or duplicating contamination; silent replacement still
refuses.

## RD9 — temporal integrity

Mapped reverify evidence must precede the decision in global coordination order. Dossier `asOf`
must not postdate the decision, and `expiresAt` must be strictly later. The driver and coordination
store share the same injected clock so TTL claims are reproducible.

## RD10 — northbound control

The authenticated HTTPS command and fixed-principal MCP tool are stateful, quota-charged,
idempotent controls. Web charges the operation as two reverifications plus the decision write.
Authorization/repository scope fails before dispatch; typed decision failures remain bounded.

## RD11 — explicit non-authority

This phase performs no install, package-manager invocation, lockfile mutation, code edit, Git merge,
verification acceptance, publication, policy override, PM export, or homelab integration.

## RD12 — next dependency

Phase 39 may invalidate promoted decisions when an advisory/TTL fact changes, using the existing
bitemporal invalidation and affected-reader contamination machinery. True vulnerable-function
reachability, proposed install graph/delta, additional ecosystems, optional Socket, and independent
Sigstore/SLSA verification remain later explicit rungs.
