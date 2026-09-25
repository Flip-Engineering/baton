# Red-team report: kg34-decisions.md (v1) — verdict: NEEDS REVISION

Every finding MUST be resolved in v2 or explicitly rebutted with file:line code evidence.
(Recall-machinery citations verified accurate: :12859-12917, :12983, :12854, :12994,
:12271-12292, :4506, :7800/:7821, lastSeq in snapshot() :10341.)

## P0-1 (must-fix) — injection seam does not exist as written

`:4784` is the recovery ATTACH-ONLY spawn passing raw task.brief (`attachOnly: true`) —
providerBrief is never used there; a briefing attached "as a spawn-option section" at :4784
reaches no provider. The provider-facing paths are `:2814 spawn(workerId, providerBrief, opts)`
(initial) and `:4554-4555 adapter.promptBrief(workerId, providerBrief)` / `prompt(...)`
(recovery); promptBrief/prompt take the brief, NO options bag. `_providerBrief` returns the
admitted frozen task.brief itself when `!brief?.contextCall` (coordinator.mjs:2861) —
"attached at the _providerBrief return" means mutating the admitted object. FIX: define the
seam as a wrapper `{brief, briefing}` at :2814 (spawn opts) and :4554-4555 (prompt render),
explicitly NOT :4784; digest at :4506 stays on the inner brief.

## P1-2 (must-fix) — preview query shape fails the reused machinery's exact-keys check

The query shape omits schemaVersion/observedSeq/asOf, which `_buildKnowledgeRecall` requires
(:12860, plus digest preconditions :12861-12868) — every preview would throw
causal_recall_invalid. FIX: specify internal query = `{schemaVersion:1, observedSeq:
projectFence, asOf: observationTime(projectFence), …}`; the public echo is a subset.

## P1-3 (must-fix) — extended preview policy fails validKnowledgeRecallPolicy

Weights + MAX_BRIEFING_BYTES + thresholds + K in one policy block fails the exact-11-field
check (KNOWLEDGE_RECALL_POLICY_FIELDS is :122 — the contract mis-cites ":127" twice; validator
:12859/:180). FIX: mandate a policy SPLIT — exact-11-field recall sub-object into the mirrored
body, preview extras under a new validator.

## P1-4 (must-fix) — fail-open taxonomy omits data-dependent causal_recall_invalid (:12876)

Decision-time seeds are "nodes the options already cite"; a cited node superseded/filtered
before the preview makes the body throw causal_recall_invalid (:12876), classed as a loud
programming error — wedging decision surfacing on ordinary KG churn. FIX: pre-filter seeds
against eligibility or classify :12876 as degradable.

## P1-5 (must-fix) — sanitizer is private and in the wrong layer

boundedAttentionText/SECRET_SHAPED_TEXT/MAX_ATTENTION_TEXT_BYTES have NO exports in
application.mjs; coordinator.mjs imports only messages.mjs. Rule 7 forces an app-layer import
into the coordinator (cycle risk) or silent re-implementation. FIX: relocate the helper to
messages.mjs or a shared hygiene module; cite the new home.

## P1-6 (must-fix) — MAD oracle not vendored; extraction unspecified

confidence.rs lives at /tmp/pm-kg-reference/confidence.rs — outside the repo, unreproducible.
Part F pins thresholds but not the metric-extraction grammar, unit normalization, or numeric
guards (NaN/±Infinity from adversarial Finding text; ReDoS surface). FIX: vendor the oracle
into the contract (inline the grammar + guards); require linear-time extraction.

## P2

7. Fence stampede + unbounded cache: projectFence = _events.length advances on ANY event;
   under dispatch bursts the cache never hits. FIX: size/LRU bound in policy; consider
   KG-event-only fence.
8. Contradiction-flood suppresses the warning: bundle > limit throws at :12908 → degrade → a
   heavily-contradicted node guarantees NO contradiction surfacing, inverting rule 11. FIX:
   contradiction-peel (keep peers, drop ranked tail) before degrading; add the flood red test.
9. "at grounding asserted" is a category error — edges have no grounding field (:12271-12292;
   grounding is node-only :12250). FIX: drop the phrase or define it as briefing provenance.
   (Confirmed good: empty evidence admits for Supports/Refines/Cites :12278/:12231-12239.)
10. Auto-link idempotency overstated: addKnowledgeEdge idempotency is keyed by auth.key
    (:12597-12601); a re-proposed identical edge under a fresh key throws duplicate_edge
    (:12275). FIX: deterministic auto-link key. Rule 19 vs rule 13 inconsistency: say the test
    exercises the store, not the auto-linker.
11. Staleness "unreferenced" ignores preview traffic: _knowledgeReads records only evented
    reads; the most-previewed nodes look unreferenced. FIX: scope the marker wording or
    document.
12. Misc: ":4622" is the refusal-payload echo, not digest comparison (matching is store-side
    recovery machinery); `_buildKnowledgeRecallAssessment` is the real name (:13025); recency
    formula undefined; the mirrored validator pattern would forbid a 0 weight — allow 0.
13. Part J vacuous tests: the assessment-after-N-previews test is redundant with the
    event-count test; the cache test passes under any fence without an unrelated-non-KG-event
    case; add red tests for findings 4 (stale seed), 8 (contradiction flood), and 1's
    non-contextCall branch.

SECRET_SHAPED check (no finding): redaction is whole-text fail-closed (application.mjs:220-228).
