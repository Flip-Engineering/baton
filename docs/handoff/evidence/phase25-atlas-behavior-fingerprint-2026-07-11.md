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
- Focused BF1–BF7 gate: 7/7.
- Canonical owned suite: 747/747; suite root reaped.
- Reds cover stable output, behavior-preserving textual change, divergent output, filesystem
  escape, ambient-secret stripping, nondeterminism, timeout, path/language/corpus/source bounds,
  cancellation, resume, tamper, and reverify.
- Baton-on-Baton evidence under
  `docs/reference/evidence/phase25-atlas-behavior-fingerprint-2026-07-11/` fingerprints the real
  dependency-free `impl/src/route-tuple.mjs#routeTupleKey`, resumes a deliberately bounded result,
  reverifies it, compares it with itself, balances capability events, and leaves no newly owned
  sandbox or artifact root.

## Honest boundary

The corpus is operator-supplied and may be weak. This phase does not generate or shrink inputs,
measure code coverage, model nondeterministic/effectful systems, follow imports, compare stateful
effects, or establish equivalence outside observed cases. Those limitations are precisely why
behavioral fingerprints belong beside the Evidence ladder. Semantic merge still needs independent
conflict classification plus fresh verification; this result alone cannot authorize it.
