# Phase 32 — Cartographer/Quartermaster local orientation and reuse floor

## OR1 — one map, not a second index

The module consumes an explicit immutable `AtlasCodeIndex` epoch and optional worktree overlay. It
does not rescan source, invent a mutable current map, or introduce another graph schema. Every
result pins the Atlas epoch, overlay digest/staleness, underlying artifact digest, and operation.

## OR2 — focused bounded orientation

`orientation.slice` requires a nonempty bounded focus and a declared shape. Rung 0 supports
`brief` (ranked `code.seed`) and `map` (bounded `repo.map`). It emits typed paths, symbols, imports,
calls, and metrics rather than source dumps or generated architecture prose. Complete transformed
results are content-addressed; the inline payload is token-bounded and resumable.

## OR3 — internal reuse before external supply

`reuse.internal` turns a bounded need into deterministic search terms over the same epoch. Existing
repository definitions/files are returned as internal candidates. A miss returns
`external_vet_required`; it never hallucinates a package, treats absence as permission to borrow,
or performs a network request. This is Quartermaster's safe first step, not the full vet broker.

## OR4 — ACI and reverify

The `cartographer-quartermaster` capability uses the common registry, cost/provenance envelope,
artifact bounds, resume integrity, cancellation, and exact-operation reverify. It claims neither
verification nor merge authority and remains reachable through generic authenticated web/MCP
capability commands without a second control plane.

## OR5 — untrusted inputs and confinement

Focus/need/shape are bounded JSON data, not instructions. Repository content and dependency names
remain untrusted evidence. Atlas owns realpath/symlink/language/source ceilings; this module may
narrow those results but cannot weaken them or accept an epoch/artifact that Atlas rejects.

## OR6 — deterministic cache identity

Artifact identity commits to operation, normalized focus/need, shape, Atlas epoch, overlay digest,
and the complete transformed items. Identical state yields identical bytes. A different epoch,
overlay, or query yields a different identity. Resume accepts only the exact canonical artifact
path/schema/digest and offset.

## OR7 — explicit later contracts

Addressed `orient_worker` push, scope-drift automation, external deps.dev/OSV/Socket enrichment,
TTL/advisory invalidation, license/provenance policy, reachability gating, immutable reuse decisions,
SBOMs, and knowledge promotion remain catalogued Phase 32+ contracts. There is no homelab or
project-manager runtime dependency and no external package auto-install surface.

## OR8 — acceptance

Reds prove Atlas-epoch reuse, brief/map focus, internal hit/miss truth, bounded resume, tamper,
reverify, cancellation, invalid shapes/queries, overlay identity, registry/web/MCP reachability,
zero network/package recommendation on miss, and no verification/merge authority.
