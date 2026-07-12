# Phase 37 — exact-lockfile SBOM

## SB1 — actual source authority

`provenance.sbom` is advertised only with deployment byte/component ceilings and a trusted
worktree context. It reads one confined canonical npm `package-lock.json` v3 snapshot and rechecks
path identity after the read.

## SB2 — exact inventory

Every installed `packages` entry becomes a deterministic component with lockfile path, exact
version/link posture, integrity when present, dev/optional flags, npm purl, and stable bom-ref.
Malformed or ceiling-exceeding identity fails closed.

## SB3 — honest graph

Dependency edges follow npm's nested-then-hoisted lockfile paths. Missing targets remain explicit
`unresolvedEdges`; they are never fabricated. Root application identity and edges are retained.

## SB4 — proposed versus actual

The artifact is CycloneDX 1.6-shaped and explicitly grounded `actual_lockfile`. A registry-derived
hypothetical graph is `not_supplied`, never mixed into actual installed components or edges.

## SB5 — artifact and budget

The full deterministic SBOM is content-addressed and exact-operation reverifiable. If one SBOM row
cannot fit the context budget, the result is honest ref-only `partial` without a non-progressing
cursor.

## SB6 — boundaries

This phase does not scan vulnerabilities, mutate a lockfile, generate a proposed install graph,
record a reuse decision, promote knowledge, or waive a dossier policy. No homelab integration is
introduced.
