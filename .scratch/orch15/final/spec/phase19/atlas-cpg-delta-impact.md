# Phase 19 — Atlas CPG delta and impact

## CD1 — two immutable graph authorities

`AtlasCpgDelta` builds independently content-addressed Phase 18 graphs from one confined before
file and one confined after file. The delta pins both source and graph digests; neither worker
claims nor caller-supplied graph JSON is authoritative.

## CD2 — semantic matching keys

Revision-local IDs remain source-digest-bound. Delta matching instead derives deterministic keys
from function/container name, node type/kind/name/role, and occurrence ordinal. Range-only movement
and formatting do not fabricate changes. Rename or ambiguous duplicate identity remains explicit
remove/add rather than guessed continuity.

## CD3 — node and edge delta

The result classifies added, removed, and modified semantic nodes plus added/removed typed edges.
Statement modification compares syntax fingerprints, not raw trivia. Every record retains the
before/after revision-local IDs and ranges needed to inspect the exact evidence.

## CD4 — bounded impact traversal

Changed syntax/def-use/call nodes lift through `CONTAINS` to their function, flow along
`REACHING_DEF`, and propagate to callers over reverse `CALLS`. Results name reason and distance.
The requested traversal depth is bounded by a deployment-derived constructor ceiling.

## CD5 — no semantic overclaim

Impact means graph reachability under the shipped seed, not proof of runtime behavioral effect.
Unresolved calls, aliases, dynamic dispatch, path conditions, interprocedural dataflow, and taint
remain absent and cannot silently create edges.

## CD6 — parse health, cancellation, and bounds

Either graph's parse errors make the delta `partial`. Cancellation and source/artifact ceilings
fail typed. The delta artifact has its own deployment-derived bound.

## CD7 — bounded context, resume, and reverify

The complete delta and impact set is immutable and content-addressed. Inline payload is
token-bounded; cursors are artifact/digest/offset-bound and tamper-checked. Reverify rebuilds both
graphs and compares the delta digest.

## CD8 — acceptance

Focused tests cover formatting invariance, syntax/edge change classification, caller impact,
rename honesty, depth bounds, parse partials, cancellation, resume/tamper refusal, deterministic
reverify, and a Baton-on-Baton before/after proof.
