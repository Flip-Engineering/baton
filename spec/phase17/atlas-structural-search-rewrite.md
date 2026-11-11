# Phase 17 — Atlas structural search and rewrite proposals

This advances representation rung R1 from one-file structural deltas to reusable AST-pattern
search and deterministic rewrite proposals. It deliberately does not grant Atlas authority to
edit a worktree. Applying a proposal remains an orchestrator/worker action under ordinary path,
approval, verification, and integration gates.

## AR1 — truthful capability card

`AtlasStructuralRewrite.card()` declares pinned ast-grep provenance, pattern search, proposal-only
rewrite, supported grammars, deterministic content-addressed outputs, and the missing rule-config,
format-preservation, semantic, CPG, IR, behavioral, and apply-authority rungs.

## AR2 — confined immutable input

Both operations read one relative regular file beneath `ctx.root`. Absolute paths, traversal,
escaping symlinks, binary input, invalid UTF-8, unsupported languages, and source/output larger
than the configured resource budget fail typed. A separate deployment-derived artifact ceiling
prevents nested captures from amplifying a bounded source into an unbounded manifest. The source
file is never mutated.

## AR3 — syntax search

`search.structural` uses ast-grep's parsed pattern matcher, not text grep. It returns stable match
kind, one-based range, text digest, and captured metavariable digests/text. Comments and strings
that merely contain pattern text do not fabricate code matches.

## AR4 — deterministic rewrite proposal

`rewrite.structural` finds the same nodes and creates non-overlapping ast-grep edits. Replacement
templates interpolate `$NAME` and `$$$NAME` from the actual match. A missing capture, overlapping
edit, invalid pattern/replacement, or oversized output fails typed instead of guessing.

## AR5 — no direct apply authority

Rewrite returns an immutable proposed-source artifact plus an edit-manifest artifact. It never
writes the source/worktree. Provenance includes input, pattern, replacement, output, and manifest
digests so a later actor can pin exactly what it reviewed and applied.

## AR6 — parse health

Input and proposed output parse errors are explicit ranges. Any parse error makes the result
`partial`; it cannot be promoted as complete structural evidence.

## AR7 — bounded context and resume

Inline matches/edits fit the caller's positive token budget. The full item list remains in the
content-addressed manifest and a truncation cursor resumes at an exact offset. Resume verifies
the artifact path, digest, schema, cursor, and budget before returning content.

## AR8 — cancellation and audit

An injected abort signal is checked before parse and through match/edit construction. Optional
event recording emits started/completed operations with actor and content digests. No completion
event is emitted for a refused/cancelled operation.

## AR9 — re-verification

`reverify` reruns from the confined source and compares the primary manifest and proposed-source
digests. Caller prose and worker-produced hashes are not authoritative.

## AR10 — acceptance

Focused tests cover syntax-versus-text matching, captures, multi-edit proposal generation, source
immutability, parse health, path/UTF-8/size/cancellation refusal, missing metavariables, bounded
resume, artifact tamper refusal, deterministic reverify, and a packaged public export. The full
canonical suite must remain green.
