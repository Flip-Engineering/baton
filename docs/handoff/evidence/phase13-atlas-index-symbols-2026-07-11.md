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
- Epochs commit to the complete derived projection, not only source inputs. Load and resume verify
  artifact filename digests, extractor/schema, epoch projection, and handle/cursor identity;
  tampered artifacts and pathological result volume fail typed without returning content.

## Validation

```text
node --test impl/test/phase13-atlas-index.test.mjs
9/9 passing

cd impl && node --test
576/576 passing
```

The focused suite covers deterministic epoch/artifact reuse; overlay replacement/addition/deletion
without base mutation; base-snapshot versus overlay staleness; lexical, symbol, reference, call,
repo-map, and seed results; SCIP artifact shape/ranges/roles; bounded/resumed results; cancellation;
symlink exclusion; file/result ceilings; ambiguity; unknown epochs; tamper refusal; and exact rerun
verification.

## Live Baton self-index

Atlas indexed the current Baton source tree through its public ACI surface with bulky artifacts
held in a temporary external directory:

```json
{
  "index_epoch": "c7b19cc47875396676a011c80524c3655cb527b690b8d85f1a00d27b2a8602d6",
  "indexed_files": 75,
  "index_digest": "bf1468b21c16d9ea26f589b792d27a5fdc9d499480be7934cb5417e31c9f377f",
  "exact_symbol": "scip-baton npm workspace 0 impl%2Fsrc%2Fatlas-index.mjs/AtlasCodeIndex%23",
  "reference_count": 5,
  "reference_paths": ["impl/src/atlas-index.mjs", "impl/src/index.mjs", "impl/test/phase13-atlas-index.test.mjs"],
  "seed_files": ["impl/src/atlas-index.mjs", "impl/test/phase13-atlas-index.test.mjs", "impl/test/phase13-atlas-structural.test.mjs", "impl/src/atlas-structural.mjs", "docs/reference/evidence/phase13-atlas-index-codex-review-2026-07-11/run.mjs"],
  "scip_inline_documents": 35,
  "scip_total_documents": 75,
  "scip_digest": "31a772c588df76e94ae845d561ac3cd76a94ad0eae54f7ea80768988b56a4b8f"
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
- The first exact-model recursive Atlas review was blocked by provider quota before reading source;
  its failure exposed and closed a control-plane turn-crash/process-reap defect. A fresh Atlas
  semantic review remains pending quota reset, with no fallback model substituted.
