# Phase 41 — transitive advisory projection and conservative reachability

Phase 41 answers which exact components in an actual or proposed npm graph have advisories known
to the configured official oracle, and how those components relate to the application root and
repository imports. It does not claim that a vulnerable function is called. Reachability can raise
attention; absence of an import or call witness never clears, suppresses, or lowers a known
advisory. Nothing here installs, approves, decides, merges, verifies worker output, or clears a
Phase 39 risk fence.

## TA1 — deployment-owned scan boundary

`provenance.advisories` is advertised only when Quartermaster has Phase 37 SBOM policy and a
deployment-injected advisory scanner whose card, methods, official HTTPS endpoints, response-byte
ceiling, component/advisory/batch ceilings, deadline, and source-artifact root are valid. The
shipped public scanner uses OSV `POST /v1/querybatch` for exact npm coordinates. It persists each
raw response privately by digest and returns only bounded, prose-free facts and source references.
Redirect, timeout, cancellation, non-JSON, schema mismatch, response reordering/omission,
pagination, source-integrity failure, or any exceeded ceiling fails closed. Pagination is not
silently truncated: this rung treats it as incomplete and refuses the scan.

The scanner receives immutable exact coordinates, never worktree paths, lockfile bytes, registry
credentials, commands, advisory waivers, or policy authority. Callers cannot choose endpoints,
batch shape, concurrency, or limits.

## TA2 — closed actual-or-proposed source

The request is exactly one of:

- an `actual` source with a confined npm package-lock v3 path; or
- a `proposed` source with an exact Phase 40 plan claim and its original closed plan arguments.

Both forms include an exact Atlas index epoch. Actor, budget, cancellation, worktree root, source
ceilings, and oracle configuration come from trusted context/deployment configuration. Caller-
supplied component lists, proposed lockfile bytes, advisory results, source paths, graph edges,
registry URLs, policy, reachability verdicts, or raw provider documents are forbidden.

For `actual`, Quartermaster canonically opens and rechecks the confined lockfile, parses the same
typed npm graph contract as Phase 40, and binds its digest. For `proposed`, Quartermaster first
offline-reverifies the Phase 40 plan, exact query, source identities, raw-ref order/kinds/digests,
receipt, proposed graph, and delta, then loads only the content-addressed proposed-lockfile ref.
The scan cannot turn a hypothetical component into installed state. The source is rechecked after
all external and Atlas observations; drift discards the result.

## TA3 — complete exact-coordinate batch

Every non-link graph component must have an exact npm package name and SemVer. Links/workspaces are
unsupported in this rung and make the graph incomplete rather than becoming registry coordinates.
Duplicate package paths sharing the same coordinate are queried once but remain distinct graph
instances in the projection; repository evidence cannot choose which nested/hoisted instance Node
would load. The scanner canonicalizes a deterministic coordinate order, splits it only by the
deployment batch ceiling, and requires one ordered result for every query. Each result contains
only bounded unique advisory IDs and provider modification timestamps. A missing, duplicate,
additional, reordered, malformed, or paginated result makes the whole observation incomplete and
fails closed.

An empty advisory list means only `no_known_advisories_in_observed_components_as_of`. It is never
named `safe`, `clean`, `cleared`, or `borrow_ok`, and it cannot clear durable adverse state.
Withdrawn-record interpretation, exploitability, severity, fix selection, malicious-package
classification beyond an explicit provider fact, and independent provenance remain separate
contracts.

## TA4 — root dependency-path grounding

Quartermaster computes deterministic shortest typed request-edge paths from the application root
to every component instance using the exact selected graph. Each advisory row binds ecosystem,
package, version, lockfile path, component reference, advisory ID and modified time, dependency
path, edge types and specs, source grounding (`actual_lockfile|proposed_not_installed`), graph
digest, and oracle source digest. Aliases or upstream IDs are not inferred from record spelling,
and provider prose is never parsed for symbols. Multiple shortest paths use deterministic lexical
tie-breaking and remain bounded by deployment depth/path/result ceilings.

Unresolved graph edges, links, unreachable installed entries, ambiguous component identities, or
exceeded path ceilings remain explicit. They force a partial/incomplete projection; they can never
be represented as evidence that an advisory is unreachable.

## TA5 — repository import observation, not function proof

Quartermaster invokes the exact Atlas `repo.map` epoch/overlay and validates its addressed source
artifact. It recognizes only supported literal ESM bare-package and package-subpath imports, with
exact scoped-package handling. For each affected coordinate it reports bounded import witnesses
with source path and import string, or the narrowly named negative
`not_observed_in_indexed_supported_static_imports`. It binds the Atlas extractor, included-file
set, supported-language set, and per-file parse-error counts. Unsupported, oversize, symlinked, or
generated files, CommonJS `require`, dynamic imports, re-exports, aliases, and parse-error regions
are outside the negative observation, not silently scanned.

The projection carries three separate fields:

- `dependencyGraphReachability`: `root_path_observed|no_root_path_observed|unknown`;
- `packageReferenceObservation`: `observed_in_supported_static_imports|not_observed_in_indexed_supported_static_imports|unknown`;
- `installedInstanceResolution`: always `unknown` when multiple component paths share a coordinate;
- `vulnerableFunctionReachability`: always `unknown` in Phase 41.

No composite boolean named `reachable` or `unreachable` may collapse those meanings. A zero CPG
path and a missing import witness are not admissible safety evidence. A direct import of a parent
dependency does not prove that its vulnerable transitive child executes.
Reflection, dynamic dispatch, dependency injection, `eval`, FFI/native code, aliases, re-exports,
runtime loading, generated code, and interprocedural external returns remain uncovered.

## TA6 — conservative findings and authority

Every known advisory produces `known_advisory` and retains the same block priority whether import
evidence is observed, absent, or unknown. Additional findings may only raise attention:
`direct_import_observed`, `root_dependency_path_observed`, `proposed_component`,
`unresolved_dependency_graph`, and `analysis_incomplete`. There is no `unreachable_advisory`,
`advisory_waived`, or positive-clearance finding.

The result explicitly carries `authority: {install:false, approval:false, decision:false,
merge:false, verification:false, clearance:false}`. It does not mutate Phase 38 Decisions or Phase
39 fences. A later Coordinator transaction may consume freshly reverified evidence, but this
capability cannot perform that transaction itself.

## TA7 — immutable artifacts and provenance

The main advisory-projection document, selected graph snapshot, oracle scan manifest, and import-
observation snapshot are distinct content-addressed artifacts. The main document binds their exact
kind, media type, digest, byte count, order, graph grounding, lockfile/plan identity, Atlas
epoch/overlay, oracle identity, observation time, component/query/result counts, incompleteness,
and all deployment ceilings. Raw official responses remain separate private source artifacts and
are referenced by the scan manifest; provider prose and URLs are not copied into fleet context.

All output and error surfaces are bounded and sanitized. The capability result may be `partial`
only with complete addressed evidence and explicit incomplete reasons; it is never cursor-
resumable. Cancellation returns ref-only or nothing, never a caller-spliced partial scan.

## TA8 — offline semantic reverify

Reverify performs no network request. It reopens every addressed artifact, checks exact ref
order/kind/media/digest/bytes, verifies the oracle source manifest against its private raw CAS,
revalidates the original actual or proposed source, offline-reverifies a proposed plan when used,
reparses every bound raw OSV batch response rather than trusting its normalized projection,
reinvokes Atlas at the exact effective epoch/overlay, and recomputes coordinate deduplication,
dependency paths, import observations, findings, counts, incompleteness, summaries, and complete
main-document semantics under current deployment ceilings. Any tamper, source drift, Atlas drift,
policy/ceiling mismatch, missing source, or semantic substitution returns `{ok:false}`.

Freshness remains distinct from integrity: offline reverify proves what the observation said and
what source it described, not that OSV has not changed since. Refresh/invalidation authority stays
with the Coordinator.

## TA9 — failure taxonomy and northbound reachability

Typed failures distinguish invalid request/source, unsupported ecosystem, graph/source drift,
incomplete graph, scanner unavailable/timeout/cancelled, response oversize, schema/coordinate/order
mismatch, pagination/incomplete scan, Atlas/source artifact integrity, projection oversize, and
reverify divergence. Authenticated generic web and MCP ACI surfaces reach the operation without a
special bypass. They preserve actor provenance and expose neutral sanitized messages, never raw
provider bodies, filesystem paths, proxy data, or credentials.

## TA10 — red, adversarial, and live gates

Tests must prove at least:

1. exact actual and proposed graph selection, grounding, and source-drift refusal;
2. unique-coordinate batching with duplicate path projection and exact response-order binding;
3. direct, transitive, optional/dev/peer, unresolved, and graph-unreachable component cases;
4. scoped/bare/subpath import recognition without prefix confusion;
5. duplicate nested/hoisted coordinates remain separate, instance resolution remains unknown, and
   no import witness, zero CPG path, or missing dependency path can suppress or clear an advisory;
6. `vulnerableFunctionReachability` remains exactly `unknown` and false authority is absent;
7. timeout, redirect, cancellation, pagination, malformed/reordered/short/extra responses, byte,
   component, advisory, batch, path, result, and artifact ceilings fail closed;
8. raw/main/graph/import artifact tamper, forged refs, source change, Atlas drift, plan
   substitution, stale plan base, and semantic-main-document forgery fail offline reverify;
9. generic authenticated web/MCP invocation and actor attribution; and
10. official OSV live evidence over Baton's actual lockfile, with zero source mutation and complete
    process/worktree/runtime cleanup under recursive Baton dogfood.

Independent adversarial review must try to manufacture an `unreachable` safety claim from missing
imports, unresolved edges, dynamic-language gaps, or provider truncation. The phase is not green
until those attempts fail and the canonical suite remains green.

## TA11 — explicit later contracts

Phase 41 does not silently absorb or delete: trusted advisory-to-symbol mapping and release-
artifact-to-source/export identity; true vulnerable-function reachability; richer interprocedural/
module-binding/alias/heap/dynamic-dispatch CPG; provider push/feed/
webhook/polling; policy-hash invalidation; positive clearance; exact `internal` reuse Decisions;
proposed-plan approval/binding; additional ecosystems; independent Sigstore/SLSA verification;
optional Socket enrichment; Syft/Grype/Trivy-class fuller SCA; high-level `fleet_reuse`
orchestration; unified `fleet_provenance`; or Cairn recall/promotion depth. There is no homelab or
project-manager runtime integration; the local deployment-neutral causal graph remains the only
planned knowledge authority, with optional future export kept separate.
