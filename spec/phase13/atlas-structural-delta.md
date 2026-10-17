# Phase 13 — Atlas CST/AST structural delta

This is the first shipped representation vertical from full-system goal H/I. It derives a
hub-computed structural change record from immutable source inputs; worker prose is not an input.
The initial grammar set is exactly what the pinned `@ast-grep/napi` binding includes. Later
polyglot grammars, base-plus-worktree indexes, symbol/SCIP, CPG, IR, behavioral, semantic-merge,
and e-graph rungs remain catalogued rather than being implied by this slice.

## AT1 — one ACI envelope and truthful card

`AtlasStructuralDelta.card()` names the exact ast-grep package version, supported language/extension
mapping, deterministic interactive operation, read-only source posture, content-addressed artifact
write, and current limitations. `invoke('diff.structural', args, ctx)` returns the common ACI
`op/status/summary/payload/refs/cost/provenance` envelope. Unknown ops and languages fail typed.

## AT2 — immutable and confined inputs

The hub reads one before file under `ctx.beforeRoot` and one after file under `ctx.afterRoot`.
Relative paths may not be absolute, escape their root, or traverse a symlink outside it. Each
source receives a SHA-256 digest in provenance. The operation never edits either tree.

## AT3 — syntax-derived identity and fingerprints

Both sources are parsed by ast-grep/tree-sitter. Named syntax units include functions, classes,
methods, variable/lexical declarations, imports, exports, interfaces, types, and enums supported
by the selected grammar. Unit identity is kind + named-container path + declared name (or stable
anonymous ordinal). Fingerprints recursively hash named node kinds and named leaf text, excluding
comments and trivia. Formatting-only changes therefore do not fabricate a modification, while
literal contents remain significant.

## AT4 — deterministic delta

The result reports added, removed, and modified units with kind/name/container, one-based source
ranges, and before/after fingerprints. Ordering is stable by change class, identity, and range.
Duplicate identities are occurrence-qualified. The summary includes exact counts. This first
algorithm does not claim move/rename/GumTree matching or semantic equivalence.

## AT5 — parse health

Parser error nodes are counted per side. Any parse error makes status `partial` and is named in
summary/provenance; a structural delta may still be returned but cannot be promoted as complete
evidence. Unsupported/binary/oversized sources fail before parsing.

## AT6 — bounded context, full artifact

The complete deterministic record is serialized to a SHA-256-addressed JSON artifact under the
configured Atlas artifact root. `payload` contains only as many leading records as fit the caller's
positive token budget, with `status:'needs_resume'` when truncated. The ref carries digest, byte
size, media type, and handle; full data never has to enter model context.

## AT7 — auditable operation and re-verification

Optional hub event recording emits `capability.op.started` and `capability.op.completed` with actor,
operation, input digests, result digest, duration, and truncation/parse status. `reverify()` reruns
from the confined sources and compares the artifact digest. A caller-supplied success claim is
never trusted.

## AT8 — zero-quota acceptance

Tests prove real JS/TS parsing; add/remove/modify classification; formatting invariance and string
literal sensitivity; nested container identity; syntax-error partial status; path/symlink/size
refusal; deterministic digest/re-run; bounded payload with complete artifact; truthful cards; and
full-suite non-regression. A live repository delta is required before calling the vertical shipped.
