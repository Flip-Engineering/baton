# Phase 37 exact-lockfile SBOM handoff — 2026-07-12

## Outcome

Quartermaster now has the actual dependency inventory required before an immutable build/borrow
decision. `provenance.sbom` is advertised only with deployment byte and component ceilings. It
reads a canonical confined npm package-lock v3 from trusted worktree context, checks path identity
again after reading, and fails typed on escape, schema, source change, byte, or component limits.

Every installed package entry becomes a deterministic CycloneDX 1.6 component with stable
bom-ref, exact version or link posture, npm purl, integrity when present, and dev/optional facts.
Edges use nested resolution before hoisted resolution; missing targets are retained as explicit
unresolved edges. Root application identity and dependencies are included.

The artifact, item, and provenance are all labeled `actual_lockfile`. `proposedGraph` is null and
`proposedGraphStatus` is `not_supplied`; deps.dev or another registry's hypothetical resolution
cannot masquerade as installed state. The full SBOM is content-addressed and exact-rerun
reverifiable. A tiny context budget returns a ref-only partial without a non-progressing cursor.

## Verification

- SB1–SB6 inventory, graph, confinement, bounds, reverify, and budget contracts: 6/6.
- Phase 32/36/37 focused gate: 22/22.
- Canonical owner-managed zero-quota suite: 839/839.
- `git diff --check`: clean.

## Live Baton evidence

`docs/reference/evidence/phase37-lockfile-sbom-local-2026-07-12/` runs the operation through the
audited ACI registry against Baton's real `impl/package-lock.json`. All 9 checks pass. It records 10
actual components, preserves exact `@ast-grep/napi@0.44.1`, its integrity and correct npm purl,
emits CycloneDX 1.6 structure, keeps proposed data absent, audits both calls, and re-verifies the
snapshot. The scoped runner removes all temporary Atlas/SBOM artifacts.

## Honest boundary and next order

This phase does not mutate a lockfile, calculate a registry proposal, scan the SBOM for advisories,
record an allowlist/decision, promote a Finding/Decision graph, invalidate prior decisions, or
claim vulnerable-function reachability. The next authority-bearing rung is a Coordinator-owned
atomic reuse decision over exact dossier plus actual SBOM evidence. No homelab integration exists.
