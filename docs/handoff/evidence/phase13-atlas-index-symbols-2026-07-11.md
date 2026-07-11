# Phase 13.2 Atlas shared index, overlays, symbols, and SCIP — 2026-07-11

## Verdict

PASS for AT9–AT16's first shared Atlas discovery/index vertical. This closes the previously missing
content-addressed base index, dirty-worktree overlay, lexical search, repo map, `code.seed`, symbol/
reference/call graph, and SCIP JSON interchange slice. It does not claim live LSP, semantic
retrieval, structural rewrite, CPG/dataflow, IR, behavioral analysis, or semantic merge.

## Delivered contracts

- `AtlasCodeIndex.card()` exposes one ACI surface with exact ast-grep version, declared
  `snapshot+overlay` consistency, operation cost/latency/side effects, cancellation, supported
  languages, and explicit representation limits.
- `index.build` deterministically scans confined non-symlink source files, ignores `.git`, `.baton`,
  and `node_modules`, enforces byte/file ceilings, and returns an immutable epoch plus the actual
  content-addressed base-index ref. There is no mutable implicit current index.
- Every query explicitly selects an epoch. Optional `worktreeRoot` produces a per-query overlay
  that replaces changed files, adds new files, tombstones deleted files, leaves the shared base
  unchanged, and reports exact overlay digest/path sets and staleness posture.
- `search.lexical`, `repo.map`, and `code.seed` provide bounded search and orientation. Exact symbol
  names rank before container/symbol-string matches.
- Parsed definitions, occurrences, imports, and call expressions power `symbol.search`,
  `symbol.references`, and `graph.calls`. Stable SCIP-shaped symbol strings and explicit candidate
  lists prevent ambiguous references from being fabricated as resolved.
- `scip.export` writes a complete immutable SCIP JSON interchange artifact with metadata,
  zero-based occurrence ranges, definition roles, document symbols, and explicit external symbols.
  Inline output is document summaries and is independently paged from the complete interchange.
- All result payloads are token-bounded, complete results are immutable artifacts, cursors resume
  from matching artifact handles, operations emit audit events, cancellation is checked during
  walks, and deterministic claims can be reverified by artifact digest.

## Validation

```text
node --test impl/test/phase13-atlas-index.test.mjs
8/8 passing

cd impl && node --test
575/575 passing
```

The focused suite covers deterministic epoch/artifact reuse; overlay replacement/addition/deletion
without base mutation; base-snapshot versus overlay staleness; lexical, symbol, reference, call,
repo-map, and seed results; SCIP artifact shape/ranges/roles; bounded/resumed results; cancellation;
symlink exclusion; file ceilings; ambiguity; unknown epochs; and exact rerun verification.

## Live Baton self-index

Atlas indexed the current Baton source tree through its public ACI surface with bulky artifacts
held in a temporary external directory:

```json
{
  "index_epoch": "4934131a2f3d3a044a5070a9eac048a5e28a0cb51b9e07ebeee3df353144d162",
  "indexed_files": 74,
  "index_digest": "0ffa3146ed0be6a10d728db54ed96de3bb0de61461fff9a0b37f44984165abcd",
  "exact_symbol": "scip-baton npm workspace 0 impl%2Fsrc%2Fatlas-index.mjs/AtlasCodeIndex%23",
  "reference_count": 4,
  "reference_paths": ["impl/src/atlas-index.mjs", "impl/src/index.mjs", "impl/test/phase13-atlas-index.test.mjs"],
  "seed_files": ["impl/test/phase13-atlas-index.test.mjs", "impl/src/atlas-index.mjs", "impl/test/phase13-atlas-structural.test.mjs", "impl/src/atlas-structural.mjs", "impl/src/index.mjs"],
  "scip_inline_documents": 35,
  "scip_total_documents": 74,
  "scip_digest": "fe4481411c4042afd485e1900a606f7dea03d592a3e59542acb7b1332a4c850f"
}
```

## Remaining Atlas work

- Persistent per-file overlay cell caching and private-reindex thresholds for very large dirty
  worktrees; the current implementation honestly recomputes the overlay per query.
- AST/CST structural search and gated rewrite beyond the existing structural-delta operation.
- Live LSP control and binary protobuf SCIP import/export; this slice provides deterministic SCIP
  JSON interchange.
- Optional semantic retrieval with measured utility, plus CPG/dataflow/taint, compiler IR,
  behavioral fingerprints, semantic merge, and later representation-rung evaluation gates.
- Coordinator policy that injects/retracts Atlas views in worker context and promotes selected
  repository-map findings into the shared knowledge graph.
