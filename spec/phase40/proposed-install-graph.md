# Phase 40 — proposed install graph and actual delta

Phase 40 answers the missing question between external vetting and an install decision: what exact
dependency graph would the requested package add or change? It keeps registry resolution
hypothetical and byte-distinct from the checked-out lockfile. Nothing in this phase installs a
package, edits the source worktree, or grants decision/merge/verification authority.

## PG1 — deployment-owned resolver boundary

`provenance.plan` is advertised only when Quartermaster receives both Phase 37 SBOM ceilings and a
deployment-injected proposal resolver with explicit resolver/tool/version identity. The resolver is
the only component allowed to contact a registry or run a package-manager dry resolution. It must
operate in an isolated disposable root, disable lifecycle scripts, and return bounded proposed
`package-lock.json` v3 bytes plus a structured execution attestation. Quartermaster never invokes an
ambient package manager directly and never accepts caller-supplied proposed bytes.

## PG2 — closed exact request

The request contains one confined actual `lockfilePath`, ecosystem `npm`, exact package name, and
exact semantic version. Ranges, tags, URLs, Git specs, aliases, workspace/file links, caller paths,
commands, registry URLs, proposed documents, or resolver claims are forbidden. Actor, budget,
cancellation, worktree root, resolver policy, and network policy come from trusted context or
deployment configuration.

## PG3 — immutable actual source

Quartermaster canonically opens the actual lockfile under the trusted worktree, enforces the Phase
37 byte/component ceilings, records its digest, and rechecks path and bytes after resolution. A
dirty/changing/escaping/malformed actual source fails closed. The resolver receives an immutable
copy or bytes, never the source path as mutation authority.

## PG4 — proposed source validation

The resolver result is accepted only when its attestation identifies the configured resolver,
package-manager executable/version, scripts-disabled posture, disposable root, exact coordinate,
base lockfile digest, and success status. The proposed bytes must parse as npm lockfile v3, remain
under ceilings, retain the same root application identity, contain the requested exact package,
and bind the root dependency request to that exact version. Missing, substituted, ranged, or
ambiguous requested coordinates fail closed.

## PG5 — separate proposed graph

The proposed graph uses the same deterministic CycloneDX normalization as Phase 37 but every row is
grounded `proposed_lockfile`. It is never merged into, returned as, or aliased to the
`actual_lockfile` SBOM. The proposed lockfile, proposed SBOM, and resolver attestation are
content-addressed fleet artifacts with separate media types and digests.

## PG6 — deterministic actual-to-proposed delta

Quartermaster computes canonical added, removed, and changed components plus added/removed
dependency edges from normalized lockfile paths and exact versions/integrities. Root request
changes, unresolved edges, transitive churn, removals, peer/optional/dev posture changes, registry
origin changes, and integrity loss remain explicit. Counts and rows are stably sorted and bounded;
no prose or resolver verdict participates in the delta.

## PG7 — conservative policy projection

The result may report `clean_addition`, `unexpected_removal`, `integrity_loss`,
`unresolved_graph`, or `resolver_policy_violation`. These are descriptive plan findings, not a
safe-to-install verdict. A green external dossier does not bless transitive additions, and
reachability may later prioritize review but may never waive a known advisory or provenance gate.

## PG8 — artifact, budget, and replay

The complete plan document is content-addressed. If it cannot fit the context budget, the result is
honest ref-only `partial` with no non-progressing cursor. Reverification reloads the exact artifacts,
revalidates resolver identity/attestation and graph/delta digests, and confirms that the actual
worktree lockfile still matches the recorded base digest; it does not repeat registry resolution.
Any artifact substitution or changed base fails closed.

## PG9 — cancellation and failure taxonomy

Cancellation is propagated to the resolver. Timeout, resolver outage, nonzero result, scripts not
provably disabled, missing tool identity, oversize output, malformed schema, coordinate mismatch,
source change, and artifact collision are typed failures. No failed call emits a usable proposal
claim or mutates the actual worktree.

## PG10 — sole capability plane

The operation is reachable only through the existing Coordinator-owned ACI registry and therefore
inherits authenticated web/MCP capability invocation, actor injection, budget ceilings, audit, and
result validation. There is no proposal sidecar, direct worker resolver handle, or new northbound
authority.

## PG11 — red tests and live proof

Tests cover closed-card advertisement, exact request validation, no caller proposal injection,
source confinement/change, resolver identity and scripts-disabled attestation, exact requested
coordinate presence, actual/proposed separation, deterministic component/edge delta, removals and
integrity loss, ceiling/cancellation/failure behavior, ref-only partial, reverify/base drift, artifact
tamper, and generic web/MCP reachability. A live proof may use `npm install --package-lock-only
--ignore-scripts` only inside a disposable isolated fixture and must prove the source tree remained
byte-clean and every owned process/root was reaped.

## PG12 — explicit non-authority and next boundary

This phase does not install packages, edit a manifest or lockfile in the source worktree, decide
`borrow|build|internal`, approve a plan, scan all transitive advisories, clear a known advisory,
prove vulnerable-function reachability, verify Sigstore/SLSA independently, add another ecosystem,
run Socket, merge, publish, export to project-manager, or integrate with homelab. Those remain
separate named contracts; no omission retires them.
