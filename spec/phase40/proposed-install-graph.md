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
`package-lock.json` v3 bytes plus a structured execution receipt authored by the trusted sandbox
supervisor—not by package-manager output. The receipt binds child executable/version, exact argv,
base digest, isolated root, owned cache root, permitted registry origins, exit status, and cleanup.
For npm, fixed policy includes `--package-lock-only`, `--ignore-scripts`, `--save-exact`,
`--no-audit`, and `--no-fund`; a boolean claim from an
untrusted resolver is insufficient. Quartermaster never invokes an ambient package manager directly
and never accepts caller-supplied proposed bytes.
The supervisor reconciles orphaned invocation roots, caches, and process metadata before its card
may report `reconciled:true`; Quartermaster does not advertise the operation before that readiness
fact.
Its owned root has one exclusive live-supervisor lease, so a second instance cannot delete an
active invocation during reconciliation.

The shipped npm supervisor is deliberately deployment-specific: on macOS it executes npm with a
measured absolute Node runtime under a measured `/usr/bin/sandbox-exec` Seatbelt profile that denies
writes outside the invocation root and denies all direct network access. A credentialed supervisor-
owned loopback CONNECT proxy admits only the exact configured registry hostname and TLS port; npm
receives only that proxy. Registry configuration by itself is not treated as confinement. Both npm
config files are empty invocation-owned files rather than ambient user/global config. The receipt
binds npm, Node, sandbox-exec, and generated-profile SHA-256 digests, proxy authentication/authority/
rejection count, and proxy cleanup. An inherited random invocation marker is combined with a
continuously persisted OS ancestry set, so a detached child that changes session and clears the
marker remains identified by PID plus observed process identity. Normal cleanup and restart
reconciliation kill every still-matching owned process; a numeric PID or process group is never
trusted alone. The fully initialized supervisor lease is written and fsynced under a unique name,
then atomically hard-linked into its exclusive public name; the same publication rule applies to a
separate stale-takeover claim. Recovery binds PID plus OS start/command identity, distinguishes
unknown liveness from confirmed staleness, and quarantines malformed claims through same-fd inode
checks. Simultaneous, partial, or abandoned takeovers cannot admit two supervisors or wedge restart.

## PG2 — closed exact request

The request contains one confined actual `lockfilePath`, ecosystem `npm`, exact package name, and
exact semantic version. Ranges, tags, URLs, Git specs, aliases, workspace/file links, caller paths,
commands, registry URLs, proposed documents, or resolver claims are forbidden. Actor, budget,
cancellation, worktree root, resolver policy, and network policy come from trusted context or
deployment configuration.
Before any package-manager process or proxy is started, every dependency, optional, peer, and dev
request copied from the actual root manifest/lock entry must be a registry SemVer version or range.
File/workspace/link, Git/SSH, URL, hosted-repository shorthand, and npm alias specs fail closed.
Workspace, npm override, Yarn resolution, and pnpm override blocks are also refused rather than
copied into the resolver. The same closed-spec validation is repeated over the proposed root and
every proposed component.

## PG3 — immutable actual source

Quartermaster canonically opens the actual lockfile and its sibling `package.json` under the trusted
worktree, enforces byte/component ceilings, records both digests, and rechecks both identities and
bytes after resolution. A
Invocation-time changing/escaping/malformed actual source fails closed; unrelated Git dirtiness is
not inferred to invalidate a plan. The resolver receives only immutable
lockfile and manifest bytes plus their digests, never source paths as mutation authority, and its
trusted execution receipt repeats both exact base digests. Concurrent source change cannot alter resolver input; any
post-resolution mismatch discards the result, even though that conservative rule permits denial of
service.

## PG4 — proposed source validation

The resolver result is accepted only when its attestation identifies the configured resolver,
package-manager executable/version, scripts-disabled posture, disposable root, exact coordinate,
base lockfile digest, and success status. The proposed bytes must parse as npm lockfile v3, remain
under ceilings, require top-level and `packages['']` root name/version to agree, retain the same
root application identity, contain the requested exact package,
and bind the root dependency request to that exact version. Every proposed component must
have an exact version, integrity, and an origin allowed by deployment policy; Git, file, workspace,
link, arbitrary URL, missing-integrity, or disallowed-origin entries fail closed rather than being
classified green. This is origin/integrity validation, not independent registry consensus.
Missing, substituted, ranged, or ambiguous requested coordinates fail closed.

## PG5 — separate proposed graph

The plan normalizes its actual and proposed inputs through one deterministic CycloneDX path. Its
core fields are Phase 37-compatible, while Phase 40 additionally retains resolved origin and
peer/devOptional posture needed by the delta; it does not claim byte-identical Phase 37 artifacts.
Every proposed row is grounded `proposed_lockfile`. It is never merged into, returned as, or aliased to the
`actual_lockfile` SBOM. The proposed lockfile, proposed SBOM, and resolver attestation are
content-addressed fleet artifacts with separate media types and digests.

## PG6 — deterministic actual-to-proposed delta

Quartermaster computes canonical added, removed, and changed components plus added/removed
dependency edges from normalized lockfile paths and exact versions/integrities. Root request
changes, unresolved edges, transitive churn, removals, peer/optional/dev posture changes, registry
origin changes, and integrity loss remain explicit. Counts and rows are stably sorted and bounded;
no prose or resolver verdict participates in the delta.
Root application identity and the exact root request are reasserted before delta classification. A
hoist/path move is intentionally a graph removal plus addition because npm install path is part of
resolution identity; equal name/version does not collapse it into a false unchanged result.
Deployment policy separately bounds normalized dependency edges and total delta rows; exceeding
either ceiling refuses rather than truncating an apparently complete plan.

## PG7 — conservative policy projection

An accepted result may report `clean_addition`, `no_change`, `unexpected_removal`, `integrity_changed`, or
`unresolved_graph`. Missing integrity and resolver-policy violations are typed refusals and emit no
usable plan. These are descriptive plan findings, not a
safe-to-install verdict. A green external dossier does not bless transitive additions, and
reachability may later prioritize review but may never waive a known advisory or provenance gate.

## PG8 — artifact, budget, and replay

The complete plan document is content-addressed. If it cannot fit the context budget, the result is
honest ref-only `partial` with no non-progressing cursor. Reverification reloads the exact artifacts,
revalidates the supervisor-authored execution receipt—including exact base digest—and graph/delta digests, and confirms that the actual
worktree lockfile still matches the recorded base digest; it does not repeat registry resolution.
Any artifact substitution or changed base fails closed.

## PG9 — cancellation and failure taxonomy

Cancellation is propagated to the resolver. Timeout, resolver outage, nonzero result, scripts not
provably disabled, missing tool identity, oversize output, malformed schema, coordinate mismatch,
source change, rejected proxy egress (`proposal_network_violation`), and artifact collision are typed failures. No failed call emits a usable proposal
claim or mutates the actual worktree. The disposable root, package-manager cache, subprocess tree,
and temporary credentials are invocation-owned and reaped on success, failure, cancellation, and
supervisor restart; global or user cache use is an isolation violation.

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
tamper, active detached/marker-clearing child cleanup, simultaneous stale-lease takeover, and generic
web/MCP reachability. A live proof may use `npm install --package-lock-only --ignore-scripts
--save-exact --no-audit --no-fund` only inside a disposable isolated fixture and must prove the
source tree remained byte-clean and every owned process/root was reaped.

## PG12 — explicit non-authority and next boundary

This phase does not install packages, edit a manifest or lockfile in the source worktree, decide
`borrow|build|internal`, approve a plan, scan all transitive advisories, clear a known advisory,
prove vulnerable-function reachability, verify Sigstore/SLSA independently, add another ecosystem,
run Socket, merge, or publish. Those remain separate named contracts; no omission retires them.
Deployment-neutral graph export may be specified later, but project-manager/homelab runtime
integration is excluded from Baton rather than deferred.
