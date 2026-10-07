# Phase 43 Adverse GLM Review

Commit 3c491af "Retain seedless provider adverse guards" introduces provider-contribution retention and aggregate guard projection for seedless adverse-provider signals.

## Verdict

**CLEAN — No P0-P1 findings.** The commit correctly implements AF3/AF4/AF5 atomic completion, multi-source grow-only union, repo-scoped guard retention, causal lineage, and replay integrity. Green non-clearance is intentional per AF3: a green observation clears pending but never clears existing adverse guards or reopens Decisions. All adversarial seams have corresponding test gates.

## P0-P1 findings

None.

## Required red tests

The existing test suite already covers the required adversarial gates:
- `AF3/AF4/AF8/AF9`: seedless green completion resolves pending atomically, creates only verified Source lineage (no Finding), causal `DerivedFrom` edges ground official observation → receipt
- `AF4/AF6`: index change (`treeSha` transition) fails processing with `provider_index_changed`, leaves entire root pending with no partial guard or graph projection
- `AF4/AF5/AF9`: seedless adverse completion creates immutable contribution, aggregate guard with `blocked:true`, Finding → official → receipt causal lineage
- `AF5`: second provider's adverse observation unions without replacing first contribution; aggregate guard contributionIds has both sources
- `AF6`: append failure during adverse completion leaves root pending, exposes no guard or graph
- `AF10`: replay rejects tampered contribution advisoryId payload with `provider_contribution_conflict`
- Coordinator `coordination-store.mjs:294`: `reuse_provider_guarded` check fences reuse decisions against retained `_reuseProviderGuards`

Green non-clearance is correctly implemented: the `_reuseProviderGuards` Map is NOT cleared on green completion (AF3 spec: "cannot change an existing guard, reopen a Decision/Finding, remove contamination, or act as positive clearance"). The test verifies `reuseProviderGuard` returns null after green completion because no adverse guard was created; a real adverse guard from a prior transaction would remain `blocked:true` and fence subsequent reuse. The check line 294 enforces this.

The commit is ship-ready.