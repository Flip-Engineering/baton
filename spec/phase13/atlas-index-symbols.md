# Phase 13.2 — Atlas shared index, overlays, symbols, and SCIP interchange

This gate advances Atlas from one-file structural deltas to a fleet-shared discovery substrate.
It implements full-system goal H.1 and representation rung R2 without claiming semantic search,
live LSP control, CPG/dataflow, or semantic merge.

## AT9 — immutable shared base epochs

`index.build` walks a confined base root deterministically, ignores symlinks and generated control
directories, parses only the declared language set, and writes one content-addressed index artifact.
The epoch is derived from ordered path/content digests plus the extractor version. Callers select an
epoch explicitly; Atlas has no hidden mutable "current" index. Rebuilding identical content returns
the identical epoch and artifact.

## AT10 — per-worktree overlay reconciliation

Every query may carry `ctx.worktreeRoot`. Atlas hashes that tree, replaces changed base-file cells,
adds new files, and tombstones deleted files for that query only. It never mutates the shared base.
Provenance reports `index_epoch`, `overlay_applied`, `overlay_digest`, changed/added/deleted paths,
and effective file count. Without a worktree, results are explicitly base-snapshot stale relative to
unknown worker edits.

## AT11 — lexical and repository orientation

`search.lexical` returns typed path/range/preview hits with literal or case-folded matching.
`repo.map` returns bounded per-file language/line/symbol/reference/import/call metrics and dependency
edges. `code.seed` accepts task terms and returns a compact orientation seed of relevant files,
definitions, and call/dependency edges. Stable ordering and content-addressed full-result artifacts
make all three deterministic and re-runnable.

## AT12 — symbol, reference, and call graph

Atlas derives definitions, identifier occurrences, imports, and call sites from ast-grep's parsed
CST. `symbol.search` returns stable symbol identities and definitions. `symbol.references` accepts a
stable symbol or unambiguous name and returns definition/reference occurrences with ambiguity made
explicit. `graph.calls` returns caller/callee edges; unresolved or ambiguous targets remain labeled
instead of being fabricated as resolved.

## AT13 — SCIP JSON interchange

`scip.export` emits a content-addressed JSON encoding of the SCIP index shape: metadata, relative
documents, occurrences with zero-based ranges and definition roles, symbol information, and an
empty/explicit external-symbol section. The card names this as SCIP JSON interchange, not a live
language server or protobuf implementation. Symbol strings are deterministic across identical
epochs and worktree overlays.

## AT14 — ACI bounds, artifacts, audit, and cancellation

All operations use the common ACI envelope. Inline payload fits the positive token budget; complete
results live in immutable artifacts and truncated payloads return resumable cursors. Index walks
check `ctx.signal` between files and fail typed on cancellation. Started/completed records include
actor, op, epoch/overlay, result digest, status, and measured cost. `reverify` reruns the operation and
compares the primary artifact digest.

## AT15 — confinement and honest limits

Roots are realpath-confined. Symlinks, binaries, oversized sources, unsupported extensions, and
ignored `.git`, `.baton`, and `node_modules` content never enter the index. Maximum file count and
source bytes are explicit constructor policy. The capability card declares `snapshot+overlay`, exact
parser version, supported operations/languages, recomputed-overlay cost, and missing live-LSP,
semantic, CPG, IR, and semantic-merge rungs.

## AT16 — acceptance

Focused tests prove deterministic epoch reuse; lexical/symbol/reference/call results; dirty overlay
replacement/addition/deletion without base mutation; staleness provenance; bounded full artifacts;
SCIP JSON shape/ranges/roles; repo-map and code-seed orientation; cancellation/confinement; and
reverification. Full-suite non-regression is required before the gate is green.
