# Phase 36 Quartermaster external evidence floor handoff — 2026-07-12

## Outcome

Quartermaster now exposes `reuse.vet` only when deployment injects both a source oracle and exact
freshness/license/Scorecard/deprecation/provider-provenance policy. The shipped public adapter is
npm-only and exact-version-only. It performs fixed HTTPS deps.dev GetVersion plus OSV QueryVersion,
and deps.dev GetProject when a source project is mapped. Redirect, timeout, cancellation, response
size, pagination, advisory count, schema, and coordinate mismatch fail typed and closed.

Every raw provider response is stored privately as owner-only content-addressed JSON. The dossier
contains only handles/digests and bounded typed facts—canonical coordinate, SPDX strings, advisory
IDs/timestamps, malicious marker, deprecation, provider-reported verified-attestation count, and
bounded Scorecard names/scores. Provider prose, README text, URLs, Scorecard reasons, and raw errors
do not enter the payload.

Policy emits only `borrow_candidate`, `block`, or `blocked_pending_vet`; none is an install or final
reuse decision. Any known advisory blocks even when Atlas does not observe an import. Atlas reports
only npm `import_observed|not_observed`, pinned to exact epoch/overlay, and explicitly cannot claim
vulnerable-function reachability. Cache identity includes coordinate, epoch/overlay, and policy.
Before TTL it returns the same dossier without network; expiry yields pending until explicit
refresh. Snapshot reverify checks dossier, current policy, and every raw source digest without
network.

## Verification

- QV1–QV7 fixture, policy, transport, cache, freshness, tamper, and public-driver contracts: 9/9.
- ACI/Cartographer/web/MCP focused gate: 60/60.
- Canonical owner-managed zero-quota suite: 833/833.
- `git diff --check`: clean.

## Live official-source evidence

`docs/reference/evidence/phase36-quartermaster-live-2026-07-12/` builds a real Atlas index over a
fixture importing Baton's pinned `@ast-grep/napi@0.44.1`, invokes `reuse.vet` through the audited ACI
registry, and queries the official deps.dev and OSV services. All 10 checks pass. The exact
coordinate resolved, three source snapshots were digested, the package had no returned advisory,
MIT passed the pinned policy, Atlas observed the import, the result was `borrow_candidate`, the
second call made no additional network request, and snapshot reverify passed. This is a bounded
evidence recommendation, not permission to install or merge.

## Honest boundary and next order

This phase does not ship an exact-lockfile SBOM, proposed-vs-actual graph delta, immutable reuse
decision/allowlist, Finding/Decision/Informed/Supersedes transaction, advisory push invalidation,
true external-symbol/CVE reachability, Socket enrichment, or independent Sigstore verification.
Those remain the dependency order for Phases 37 onward. Grok CLI still reports unauthenticated, so
no fresh Grok review is claimed. No homelab integration is introduced.
