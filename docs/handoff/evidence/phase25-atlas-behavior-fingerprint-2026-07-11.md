# Phase 25 Atlas behavioral fingerprint evidence — 2026-07-11

## Outcome

`AtlasBehaviorFingerprint` implements a bounded empirical R5 vertical for dependency-free
JavaScript ESM named exports. The operator pins a JSON corpus; Baton copies only the target source
into a throwaway sandbox and executes every case twice in distinct Node child processes. The
child uses Node's real permission model, receives a minimal deterministic environment with no
ambient provider credentials, can read only its isolated target, and has no filesystem-write,
network, child-process, or worker-thread authority.

Byte-identical repeated observations become a content-addressed fingerprint. Different repeated
observations fail typed `nondeterministic`; wall overrun fails `execution_timeout`; permission
denial fails `sandbox_violation`. Before/after comparison reports exact case-indexed divergences
under one corpus. Agreement is labeled `observed_corpus_agreement_not_semantic_equivalence` and is
never a proof, coverage claim, or automatic merge decision.

Artifacts pin source/corpus digests, export name, Node version, permission policy, and normalized
return/throw observations. The ordinary Atlas ACI lifecycle supplies token bounds, digest/offset
resume, exact-path/schema/digest integrity, cancellation, content addressing, and deterministic
reverify.

## Validation

- Numbered contract: `spec/phase25/atlas-behavior-fingerprint.md`.
- Focused BF1–BF7 gate: 10/10.
- Canonical owned suite: 750/750; suite root reaped.
- Reds cover stable output, behavior-preserving textual change, divergent output, filesystem
  escape, ambient-secret stripping, nondeterminism, timeout, path/language/corpus/source bounds,
  cancellation, resume, tamper, and reverify.
- Baton-on-Baton evidence under
  `docs/reference/evidence/phase25-atlas-behavior-fingerprint-2026-07-11/` fingerprints the real
  dependency-free `impl/src/route-tuple.mjs#routeTupleKey`, resumes a deliberately bounded result,
  reverifies it, compares it with itself, balances capability events, and leaves no newly owned
  sandbox or artifact root.

## Recursive review and correction

Two exact-model Grok workers reviewed the committed implementation concurrently through Baton.
Both were provider-observed, freshly verified, normally killed, and completely reaped. Grok 4.5
reproduced a deferred stdout suffix attack: target code could append a second result frame after
the runner's honest frame, and the parent selected the attacker's last frame in both repetitions.
Composer found a distinct false-agreement class: JSON normalization mapped `NaN` to `null` and
`-0` to `0`. The reports and full lifecycle evidence are under
`docs/reference/evidence/phase25-atlas-behavior-grok-review-2026-07-11/`.

Both failures now have reds. The child captures its control primitives before importing target
code, serializes the authoritative envelope through Node's structured-value format, removes exit
hooks, writes exactly one frame, and exits synchronously before deferred target handles run. The
parent rejects zero or multiple frames. Each return also carries structured-value bytes, so
runtime-distinct special numbers remain distinct even when their human JSON preview would
collapse. Review-requested coverage now executes real denied network, child-process, and
worker-thread attempts, and non-JSON corpus values fail before child launch.

A second clean-at-start concurrent closure pass found two adjacent seams. A target could still
write one structurally valid frame and call `process.exit(0)` before the runner epilogue, and the
child's non-function export error was misclassified as `execution_failed`. The reports and full
lifecycle evidence are under
`docs/reference/evidence/phase25-atlas-behavior-closure-grok-review-2026-07-11/`.

The control channel is now authenticated. The parent generates a random 256-bit nonce and sends
it only over the child's stdin. The runner consumes it before importing target code and retains it
inside its lexical closure; it is not present in argv or the child environment. The parent accepts
exactly one frame carrying that nonce. A target-forged early-exit frame therefore fails
`observation_protocol` even if its V8 schema is otherwise valid. Runner-owned top-level error
frames use the same nonce, so missing/non-function exports now surface typed `invalid_export`.

A final concurrent exact-model closure pass reviewed that corrected commit through Baton. Exact
`grok-4.5` and `grok-composer-2.5-fast` were both provider-observed on distinct overlapping native
PIDs; both reports were freshly verified, both kills were normally and durably confirmed, and all
process, worktree, runtime, and branch ownership was reaped. Each report independently found no
remaining actionable BF1–BF7 defect. The reports and complete lifecycle ledger are under
`docs/reference/evidence/phase25-atlas-behavior-final-grok-review-2026-07-11/`.

## Honest boundary

The corpus is operator-supplied and may be weak. This phase does not generate or shrink inputs,
measure code coverage, model nondeterministic/effectful systems, follow imports, compare stateful
effects, or establish equivalence outside observed cases. Those limitations are precisely why
behavioral fingerprints belong beside the Evidence ladder. Semantic merge still needs independent
conflict classification plus fresh verification; this result alone cannot authorize it.
