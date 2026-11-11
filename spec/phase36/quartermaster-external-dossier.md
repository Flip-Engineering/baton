# Phase 36 — Quartermaster external evidence dossier

## QV1 — exact deployment boundary

`reuse.vet` is advertised only when deployment injects an external oracle and an exact TTL,
license, Scorecard, deprecation, and verified-provenance policy. Capability code has no ambient
credential or hidden provider fallback.

## QV2 — bounded primary-source adapter

The public adapter queries exact package+version through deps.dev GetVersion and OSV QueryVersion,
optionally enriching the mapped source project through deps.dev GetProject. It uses fixed HTTP
verbs, encoded path components, cancellation/timeout, per-response byte ceilings, advisory count
ceilings, and closed ecosystem mapping. Outage, malformed data, pagination, or oversize fails
closed.

## QV3 — typed facts, no third-party prose

The dossier retains canonical identity, SPDX strings, advisory IDs/timestamps, malicious-package
tripwire, deprecation, provider-reported verified-attestation count, bounded Scorecard facts, and
private content-addressed raw source snapshots. Only their handles/digests enter the dossier.
Descriptions, README text, advisory detail, Scorecard reasons, URLs, and arbitrary provider errors
never enter the agent payload.

## QV4 — conservative policy

Known malicious packages, any known package-level advisory, denied license, configured deprecation,
or below-policy observed Scorecard blocks. Missing/unallowlisted license, required-but-missing
provenance, or absent required Scorecard is `blocked_pending_vet`. Only complete green evidence is
`borrow_candidate`, never auto-install or merge authority.

## QV5 — honest usage observation

The exact Atlas epoch is pinned. For npm only, exact import strings yield
`import_observed|not_observed`; other ecosystems are `unknown`. This is repository import
observation, not vulnerable-function/CVE reachability. It may prioritize attention but never
waives a known advisory.

## QV6 — freshness and reverification

Each immutable dossier pins `asOf`, `expiresAt`, policy hash, normalized fact digest, Atlas source,
and raw source digests. Before expiry, the exact epoch/overlay/coordinate/policy cache returns the
same dossier without network. Reverify checks the immutable snapshot and current policy without
network; expiry diverges. An expired invoke becomes visibly blocked pending explicit `refresh`.

## QV7 — boundaries and next dependencies

No auto-install, immutable reuse decision/allowlist, SBOM, lockfile delta, advisory push
invalidation, true external-symbol reachability, Socket, Sigstore verification, or knowledge
promotion is claimed. Those remain dependency-ordered later rungs. No homelab integration exists.
