# Phase 41 transitive advisory projection handoff — 2026-07-12

## Outcome

Phase 41 ships `cartographer-quartermaster/provenance.advisories` as a read-only, deployment-gated
ACI operation. It projects official OSV QueryBatch observations across either an actual npm
package-lock v3 graph or an offline-reverified Phase 40 proposed-not-installed graph. It grants no
install, approval, decision, merge, verification, clearance, or Phase 39 fence-mutation authority.

OSV receives exact package/version inputs, but its documented upstream-version matching is
provider-defined and fuzzy. Baton therefore labels this an **exact-input OSV observation**, not an
independently canonicalized exact-version proof.

## Implemented contract

- The public scanner fixes official HTTPS `POST https://api.osv.dev/v1/querybatch`, canonicalizes
  sorted unique npm inputs, splits only at deployment batch ceilings, requires exact positional
  result counts, refuses pagination, duplicates, malformed UTC modification times, redirects,
  timeout, cancellation, oversize, and incomplete results, and enforces both per-response and
  whole-scan deadlines. Calendar-invalid UTC timestamps and native DOM abort exceptions are
  classified and refused correctly.
- Every raw response is private CAS evidence. A separate scanner-authored CAS transaction binds the
  exact request body/digest, endpoint, method, scanner/card identity, response digest, random scan
  ID, observation time, full-coordinate digest, and batch position. A separate bounded session CAS
  root binds all batch sources, including empty scans, preventing cross-coordinate, cross-run, and
  temporal splicing. Replay bounds both response and envelope reads before allocation.
- Actual and proposed graph identities remain separate. Proposed input first and last
  offline-reverifies the exact Phase 40 plan; actual input rereads the confined lockfile after all
  OSV and Atlas work. Public-registry tarball paths and SRI must exactly bind component
  name/version. Links, workspaces, file/git/alias/arbitrary/private sources, invalid
  paths/names, unresolved edges, and unrooted
  components remain incomplete rather than becoming registry coordinates or negative safety facts.
- Deterministic shortest typed request-edge paths retain dependency type and spec. A real path
  beyond the configured depth is explicitly `unknown`/`path_depth_ceiling_exceeded`, while a true
  orphan remains `no_root_path_observed`. Duplicate
  nested/hoisted components remain path-distinct; any package-name multi-instance ambiguity makes
  installed-instance resolution `unknown`, including mixed unsupported/registry instances; import
  witnesses are withheld and `ambiguous_package_instance_resolution` makes the result partial when
  instance attribution is ambiguous.
- Atlas evidence is restricted to addressed indexed files and supported literal ESM package or
  subpath imports. Parse gaps make negative observation `unknown`; skipped/unsupported/dynamic/CJS/
  generated code is never treated as repository completeness.
- Every advisory retains `known_advisory`; imports and graph paths can only raise attention.
  `vulnerableFunctionReachability` is always `unknown`, including when no import or CPG path exists.
- Main, selected-graph, scan-manifest, and import snapshots are separately content-addressed.
  Scanner, SBOM, projection, Atlas-card/source/file/result, string, row, depth, witness, path, and
  artifact ceilings are provenance-bound and checked before CAS reads. Fresh invocation immediately
  replays scanner evidence; later reverify performs zero network calls and recomputes the full
  semantic document. Web/MCP omit absolute artifact paths but can invoke then reverify through
  digest/handle refs resolved only inside Quartermaster's private artifact root.

## Validation

- Phase 41 focused scanner/projection: **13/13**.
- Canonical suite: **895/895**.
- Official live proof: **10/10** checks over an exact byte copy of Baton's actual lockfile and its
  **10 exact-input npm coordinates**;
  **0 known advisories** were returned at observation time. The proof confirms separate artifacts,
  transaction-bound official sources, conservative semantics, offline reverify with no second
  fetch, bounded calls, and unchanged package-lock/manifest bytes.
- Live artifact: `docs/reference/evidence/phase41-transitive-advisory-live-2026-07-12/`.

## Recursive Baton evidence and frictions

- A clean detached two-Grok retry allocated exact `grok-4.5` and
  `grok-composer-2.5-fast`, but both were provider-refused before native spawn. Direct `grok models`
  concurrently reported `You are not authenticated`. Baton reaped both task worktrees, metadata,
  runtime scopes, branches, and processes; the refusal is preserved rather than called a pass.
- A concurrent exact-route Baton review launched Codex `gpt-5.6-sol`/`low` and GLM `glm-4.7`/`low`
  with distinct native PIDs. GLM produced a freshly verified spec review; Codex wrote a strong
  report but crossed the hard token budget before terminal/verification, so the combined gate stayed
  red. Both processes and every allocation were killed/reaped. This exposed the need for tighter
  review context slices or larger explicitly approved budgets; governance was not bypassed.
- Independent adversarial passes then found scanner/CAS, link, parse-gap, multi-instance, artifact-
  bound, policy-provenance, cancellation/DOM-exception, timestamp/session-splicing, non-registry,
  depth, multi-instance, bounded-read, and northbound-path defects. Those findings drove the session
  root, exact-input wording, unknown classifications, complete ceilings, opaque replayable refs,
  and added red tests before the phase was marked shipped.

## Explicit later boundary

Phase 41 does not provide trusted advisory-to-symbol or release-artifact/export identity, true
vulnerable-function reachability, provider push/poll/webhooks, policy-hash invalidation, positive
clearance, exact internal decisions, plan approval/binding, independent Sigstore/SLSA, additional
ecosystems, Socket/full-SCA enrichment, composite `fleet_reuse`/`fleet_provenance`, or deeper Cairn
recall/promotion. The authoritative ledger remains in
`docs/capabilities/orientation-reuse.md`. There is no homelab or project-manager runtime integration.

Subsequent status update: policy-hash invalidation shipped in Phase 42 as deployment-card-derived
policy-epoch reconciliation. The remaining later boundary is unchanged.
