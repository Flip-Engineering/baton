# Phase 13 Atlas structural delta — first representation vertical — 2026-07-11

## Verdict

PASS for AT1–AT8's initial JavaScript/TypeScript-family CST/AST delta vertical. This is not Atlas
index/search/symbol completion and does not claim SCIP, CPG, IR, behavioral, semantic-merge, or
e-graph capability.

Shipped:

- `AtlasStructuralDelta` exposes a truthful ACI card and a deterministic `diff.structural` op over
  the grammars built into pinned `@ast-grep/napi@0.44.1`.
- Hub-confined before/after files are parsed into named functions, classes, methods, declarations,
  imports/exports, interfaces, types, and enums. Traversal/absolute/symlink escapes, binary data,
  oversized sources, unsupported languages, and unsupported operations fail typed.
- Syntax identity includes named containers and duplicate occurrence. Recursive syntax
  fingerprints exclude comments, trivia, and optional terminator semicolons while preserving
  operator and literal contents. Output deterministically classifies added/removed/modified units.
- Parser error nodes force `partial`; a malformed source cannot yield a complete evidence claim.
- Full records are SHA-256-addressed JSON artifacts. The ACI payload is token-bounded and returns
  `needs_resume` plus a cursor when truncated. Reverification rereads confined inputs and compares
  the independently recomputed artifact digest.
- Optional operation events carry hub actor, source/result digests, status, and measured wall time.

## Validation

```text
node --test impl/test/phase13-atlas-structural.test.mjs
7/7 passing

cd impl && node --test
551/551 passing
```

The focused suite uses the real native parser and covers nested add/remove/modify, formatting
invariance, string literal sensitivity, syntax-error partial results, path/symlink/binary/size
refusal, bounded payload/full artifact, deterministic reverification, events, and card/refusal
truthfulness.

## Live repository proof

Atlas compared `HEAD:impl/src/index.mjs` with the current working source and returned:

```json
{
  "status": "ok",
  "summary": "1 added, 0 removed, 0 modified",
  "change": { "change": "added", "kind": "export_statement", "name": "AtlasStructuralDelta" },
  "artifactDigest": "bb573a8d81fc70450e1ca499cb3e570d0ff54b12e86bd28db1d570891d0b4910"
}
```

## Remaining Atlas and representation work

- Shared content-addressed base indexing, dirty overlays, bounded/resumable lexical and orientation
  queries, symbol/call graph, and SCIP JSON interchange now ship in
  `docs/handoff/evidence/phase13-atlas-index-symbols-2026-07-11.md`.
- Structural search/rewrite and coordination/KG registration of representation artifacts.
- Live LSP and binary SCIP protobuf interoperability beyond the current deterministic JSON shape.
- Measured CPG/dataflow, compiler IR, behavioral fingerprint, structured/semantic merge, and
  e-graph rungs under their explicit evaluation/retirement gates.
