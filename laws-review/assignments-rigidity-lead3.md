# Issues assigned to rigidity-lead3 (12), 2026-09-22

- #541 Host-capacity admission and the CLI request bound are hardcoded hard stops: a 2 s queue wait, a fixed load1m<=10 threshold, and a 30 s command deadline refuse healthy work — https://github.com/Flip-Engineering/baton/issues/541 (from none)
- #536 normalizeCommandContext's sessionAuthority sub-object may need the same closed-shape read as normalizePrincipal (#535) — https://github.com/Flip-Engineering/baton/issues/536 (from none)
- #532 Audit unnecessary rigidity: over-sanitization, defensive validation for cases that never occur, and predictive error-covering that costs real capability — https://github.com/Flip-Engineering/baton/issues/532 (from rigidity-lead2)
- #530 Hardcoded numeric ceilings gate real work throughout the goal/plan policy and beyond — remove the control-flow pattern, not just retune the numbers — https://github.com/Flip-Engineering/baton/issues/530 (from rigidity-lead2)
- #500 Host-capacity-adjacent bounds with no cited derivation (#492 sweep) — https://github.com/Flip-Engineering/baton/issues/500 (from rigidity-lead2)
- #499 Item, row, and member-count ceilings with no cited derivation (#492 sweep) — https://github.com/Flip-Engineering/baton/issues/499 (from rigidity-lead2)
- #498 Timeouts, retries, and poll intervals with no cited derivation (#492 sweep) — https://github.com/Flip-Engineering/baton/issues/498 (from rigidity-lead2)
- #497 Transport and wire-frame sizes with no cited derivation (#492 sweep) — https://github.com/Flip-Engineering/baton/issues/497 (from rigidity-lead2)
- #496 Admission and text-length bounds with no cited derivation (#492 sweep) — https://github.com/Flip-Engineering/baton/issues/496 (from rigidity-lead2)
- #492 Arbitrary hardcoded numeric limits act as control flow across the codebase: values are picked, not derived, and break on ordinary real input — https://github.com/Flip-Engineering/baton/issues/492 (from rigidity-lead2)
- #418 drift — audit-coverage — ninety-seven of 162 implementation modules sit outside every audit lane and hold the densest arbitrary-bound seams: extend the partition or add a standing numeric-constant lint — https://github.com/Flip-Engineering/baton/issues/418 (from rigidity-lead2)
- #377 SYSTEMIC (P1): arbitrary numeric ceilings, windows and cadences live outside the limits registry in fourteen lanes (2,484 two-plus-digit literals, 120_000 carrying six meanings, 16 MiB/64 MiB/2 GiB ceilings in no row); declare each once in limits.mjs or name the resource derivation — https://github.com/Flip-Engineering/baton/issues/377 (from rigidity-lead2)
