# Phase 25 — Atlas bounded behavioral fingerprint

This is the first measured R5 vertical. It observes a dependency-free JavaScript ESM export over
an operator-pinned JSON corpus in a throwaway Node permission sandbox. Agreement means only that
the observed corpus matched; it is not semantic equivalence, a proof, or a replacement for tests.

## BF1 — explicit pure-function target

`behavior.fingerprint` takes a confined `.js`/`.mjs` path, a named export, and a JSON corpus. Each
case is passed as one argument. The capability rejects missing/non-function exports, invalid or
oversized corpora, unsupported languages, symlink/path escape, and source ceilings.

## BF2 — real permission sandbox

The target is copied alone into a throwaway directory and executed by the configured Node binary
with the permission model enabled and a minimal deterministic environment. Ambient credentials
and provider configuration are not inherited. Only sandbox reads are allowed. Network, child
process, workers, and filesystem writes are denied. Permission denial fails typed
`sandbox_violation` and the sandbox is removed on success, refusal, timeout, cancellation, and
crash.

## BF3 — deterministic observation

The same target/corpus is run twice in distinct child processes. Byte-different observations fail
typed `nondeterministic`; Baton does not cache a misleading fingerprint. Returns and throws are
normalized into ordered case records, with output and wall time deployment-bounded.

## BF4 — before/after comparison

`behavior.compare` observes immutable before and after roots under the same corpus and reports
case-indexed agreements/divergences. Its meaning is
`observed_corpus_agreement_not_semantic_equivalence`. A textual change with identical observations
may agree; one differing return/throw must diverge.

## BF5 — ACI artifact lifecycle

Fingerprint and comparison results use the bounded ACI envelope, content-addressed versioned
artifacts, token-bounded inline payload, digest/offset resume, exact-path/schema/digest integrity,
cancellation, and deterministic reverify.

## BF6 — honest effects and limitations

The artifact pins source and corpus digests, export name, Node version, permission policy, and
observations. It does not infer filesystem/network effects from absence, cover dependencies,
generate inputs, shrink counterexamples, or claim coverage. Those remain later Evidence and
behavioral-rung depth.

## BF7 — acceptance

Focused reds cover stable output, stable throw, behavior-preserving textual change, divergence,
nondeterminism, permission denial, timeout, deployment bounds, cancellation, resume/tamper, and
reverify. The canonical suite remains green. Baton-on-Baton evidence fingerprints a small real
export or fixture through the same implementation and proves sandbox cleanup.
