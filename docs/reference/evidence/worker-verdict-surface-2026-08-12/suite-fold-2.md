# #61 Suite Fold 2 — blue-team finding → resolution map

Date: 2026-08-13 · Suite: `impl/test/worker-verdict-surface-red.test.mjs` (31 rows — 26 RED / 5 PIN) ·
Contract: **worker-verdict-surface v1.1** (UNCHANGED — no finding required contract movement) ·
Report folded: `suite-blueteam.md` (NEEDS-FOLD, 9 findings) · Notes: `suite-draft-notes.md`.

Every finding below is folded into the suite ONLY — none moves the contract. The fold was applied to
the deliverables named in the brief: the test file (the new/edited rows), `suite-draft-notes.md`, and
this map. `contract-fold.md` stays at v1.1.

## Fold summary

| Finding | Axis | Kind | Fold | New/edited row(s) |
|---------|------|------|------|-------------------|
| G1 | 1 | green-side fragility | widened D2's source slice from the 1200-char proximity cap to the full `applicationProfile` object span | D2 |
| G2 | 1 | green-side fragility | dropped the two out-of-scope fixture fields so `requiredEffectEvidence` mirrors the real mint byte-for-byte | A3 |
| S1 | 2 | shallow-greenability (headline) | anchored the composition to the REAL `renderObjective` seam by harvest policy + source-scanned the static `IMPLEMENT_CONSTRAINTS` retirement | D12 |
| S2 | 2 | shallow-greenability | asserted served-line VALUES against the live inputs (exact pathScope join, profile digest, workflow/result lines, verification-command line) | D11 |
| S3 | 2 | shallow-greenability | pinned the full positive `check`-domain mapping: `forbidden_effect_observed` + `verification_coverage_failed` projection rows, B1 parametrized over all 8 null diagnostics | A5, A6, B1 |
| S4 | 2 | shallow-greenability | added the behavioral per-record degradation to the structural grep (a forged corrective is excluded per-record, never a map-wide throw) | B4 |
| M1 | 3 | missing row (headline) | epoch-variation row (kills a hardcoded epoch) + freeze seam row (the admitted rendered objective is byte-stable across a mid-run policy change) | D9, D10 |
| M2 | 3 | missing row | drove the #79 push consumer: `_providerBrief` attention carries the `gate_verdict` item with `check`/`corrective`/`detail` | C5 |
| M3 | 3 | missing row | D6 outside-scope edge: a >~1500-line file OUTSIDE the lane's served scope never carries the wire_frame line | D6 |

## Axis 1 — green-side blockers

### G1 — D2's 1200-char source window can reject a correct placement

**Finding.** D2 sliced the first 1200 chars of `application-deployment.mjs` after
`function applicationProfile` and asserted `worktreeHarvestPolicy` / `orchestrator-harvest` appear
there. The measured slice ends mid-`integrationPolicy` (~:918); a correct implementation that places
the fold-B5 field past the slice (the profile object runs to :938) fails even though the field exists.
The window is an arbitrary proximity cap, the class of arbitrary numeric limit the suite law forbids.

**Fold applied.** D2 now anchors the full object span: `const end = source.indexOf('});', start)`
with a precondition guard, then `source.slice(start, end)` — the whole `applicationProfile` schema
(suite:815-822 area). `application-deployment.mjs` is NUL-free and was already read whole, so the
widen is free. Any legitimate schema placement passes; only absence fails.

**Green condition.** Add the fold-B5 `worktreeHarvestPolicy` field anywhere in `applicationProfile`
with `'orchestrator-harvest'` present as a literal.

### G2 — the A3 fixture over-specifies `requiredEffectEvidence` beyond the real mint

**Finding.** The fixture added `outOfScopeChangedPathCount`/`outOfScopeChangedPathsDigest`; the real
mint (coordinator.mjs:13229-13235) carries no out-of-scope fields — the path_scope phase throws
first, so out-of-scope is always zero. The extras give a maintainer cover to "simplify" the subset
assertion to a passthrough without a failing test.

**Fold applied.** A3's `requiredEffectEvidence` now mirrors the real mint byte-for-byte
(suite:205-215 area): the six fields `{requiredEffect, baseSha, sha, changedPathCount,
changedPathsDigest, inScopeChangedPathCount, inScopeChangedPathsDigest}`. The comment explains the
path_scope phase throws first so out-of-scope fields never appear.

**Green condition.** Project the six-field `required_effect` subset exactly; never read a field the
real mint never mints.

## Axis 2 — shallow-greenability

### S1 — the D rows test the invented composition in isolation; nothing anchors it to the real render seam (headline)

**Finding.** Every D1/D3–D8 row calls `recipesNs.composeObjectiveConstraintLines(input)` and never
touches `renderObjective`/`renderMember` or `IMPLEMENT_CONSTRAINTS`. A wrong-but-green
implementation can export a correct-looking composition and leave the worker-facing objective
rendering the five static lines — the suite's green condition is weaker than the contract's.

**Fold applied (a) and (b).** D12 (suite:1076-1137 area):
- (a) calls the REAL `recipesNs.renderObjective` with the composed `lines` under both harvest
  policies and asserts the rendered text: the no-commit line is ABSENT on `boundary-commits`, PRESENT
  on `orchestrator-harvest`, the wire_frame HARD CONSTRAINT line is absent on a small lane, and the
  boundary-commit line ships on `boundary-commits`.
- (b) source-scans the static `IMPLEMENT_CONSTRAINTS` list (NUL-free `recipes.mjs`, bracket-sliced
  from the marker to the closing `]);`): if the list exists, the no-commit and wire_frame lines never
  live there and the scratchpad closed-shape line does.

**Green condition.** Wire the composed block into the objective render path (the worker-facing
objective ships the composed lines, not the static list), and retire the static boilerplate lines
from `IMPLEMENT_CONSTRAINTS`.

### S2 — served-line VALUES are never asserted against the live inputs

**Finding.** The per-line check is a regex-prefix filter on whatever lines ARE served. No row requires
the profile-digest line, the `Work only within:` line, the workflow/result-policy lines, or the
SCRATCHPAD_WRITE line to be present, and no row checks a served line's derived value against the
fixture. A composition that serves only the policy-conditional lines passes every D row.

**Fold applied.** D11 (suite:1041-1073 area) composes over a profile with a live `digest` and a
two-entry `pathScope` and asserts the EXACT served values:
`Work only within: impl/test/**, docs/guide.md`, `Baton deployment profile default@<digest>`,
`Baton workflow wave:seat:join`, `Baton objective/result policy explicit change_v1`, the profile
constraints verification-command line, and the SCRATCHPAD_WRITE line — plus the existing
`NAMED_SOURCE_PATTERNS` re-derivability loop over every served line.

**Green condition.** Read `input.goal.pathScope`, `input.profile.digest`, and the workflow/result
sources when serving their lines; serve the always-served Rule 1 lines, not just the conditional ones.

### S3 — the closed `check` domain's positive mappings are only partially pinned

**Finding.** Positives pinned: `path_scope` (A1), `required_effect` (A3), `verification_red_green_failed`
(A4), `verification_mutation_failed` (B1). Unpinned: the whitelist's `forbidden_effect` member,
`verification_coverage_failed`, and the other six null verifier diagnostics. Over-escalation to
`check: null` on the unpinned members passes.

**Fold applied.**
- A5 (suite:757-778 area): a `forbidden_effect_observed` refusal (the real trust-gate error mint)
  projects `gate: 'forbidden_effect'`, `check: 'forbidden_effect'`, `detail: {}`, `corrective:
  'forbidden_effect_retraction'`.
- A6 (suite:781-802 area): a `verification_coverage_failed` refusal projects `gate: 'coverage'`,
  `check: 'verification_coverage_failed'`, a sanitized `detail.tail` carrying the plain diagnostic
  text verbatim, `corrective: 'coverage_completion'`.
- B1 is parametrized over the frozen `NULL_CORRECTIVE_DIAGNOSTICS` (all 8 reachable null verifier
  diagnostics): each must project `check` = the closed code, `gate: 'unknown'`, `detail: {}`,
  `corrective: null`.

**Green condition.** The projection maps EVERY closed-domain member: whitelisted trustPhase →
itself, each `CLOSED_VERIFIER_DIAGNOSTICS` code → itself, everything else → `null`.

### S4 — the forced-corrective refusal is a dead literal

**Finding.** B2's `Object.isFrozen` and B4's `grep -an` presence check never EXERCISE the refusal. An
implementation can export a frozen table and a dead constant and never implement the per-record
degradation the contract pins.

**Fold applied.** B4 (suite:594-640 area) keeps the structural grep half and adds the behavioral half:
a payload-carried forged corrective (`payload.corrective = 'caller_minted'`) is per-record excluded —
the remaining valid record survives the refused record with its hub-minted corrective intact, a
malformed-only stream projects `null`, and the forged value never reaches any surface. Never a
map-wide throw.

**Green condition.** Refuse caller-authored correctives typed outside the closed table per-record;
never throw map-wide; never let a forged corrective reach a surface.

## Axis 3 — missing rows

### M1 — R9's freeze is unpinned; the B6 epoch is structural-only, never behavioral (headline)

**Finding.** D7 asserts compose-purity and the epoch's structure for ONE input; a hardcoded
`{profileDigest: 'p'×64, admissionSha: 'a'×40}` passes. The freeze ("derived at admission, FROZEN for
the run") is never pinned.

**Fold applied (a) and (b).**
- D9 (suite:973-996 area): composes over a different `profile.digest` and a different `admissionSha`
  and asserts the suppression epoch TRACKS both inputs (`notDeepEqual` between epochs) — a hardcoded
  hex literal is caught.
- D10 (suite:998-1038 area): composes at admission, renders the worker-facing objective, mutates the
  deployment policy (harvest flip + digest change), asserts a fresh compose over the mutated policy
  WOULD differ, then asserts the admitted rendered objective is byte-stable and the suppression record
  is frozen with it — the freeze as a behavioral pin, not a purity corollary.

**Green condition.** The suppression epoch is derived from the admission-time profile digest and
admission SHA; the served block is derived once at admission and mid-run policy changes never
retro-edit it.

### M2 — R4's third consumer, the #79 `gate_verdict` push, is never driven

**Finding.** R4 is "one projection, three consumers"; the suite pins the projection function and the
run.debug leg, never the #79 push item. An implementation that wires the surface into run.debug but
leaves the push item at the pre-fold `{kind, code, message, gate, detail}` passes every row.

**Fold applied.** C5 (suite:568-593 area): a Coordinator-direct ScriptableAdapter spawn (the
worker-delivery-push F1/F5 harness pattern) ends a pushed worker turn in a `path_scope` gate miss,
then reads `coordinator._providerBrief(task.brief, handle.id)` and asserts the composed `attention`
array carries a `stage: 'push-verdict-missing'` item whose `verdict` has `check` = the whitelisted
phase, the same `corrective`, and the fold-B2 `detail` key.

**Green condition.** The #79 push consumer ships the shared projection: the pushed `gate_verdict`
item carries `{gate, code, check, corrective, detail}`, not the pre-fold shape.

### M3 — D6's lane-conditionality edge (a big file OUTSIDE the served scope) is unpinned

**Finding.** Both D6 fixtures place the >~1500-line file INSIDE `pathScope`. A composition that emits
the wire_frame line whenever ANY census entry is large — ignoring the lane's served scope — passes.

**Fold applied.** D6 (suite:925-935 area) adds a fixture with a large file OUTSIDE the lane's served
scope (`sizeCensus: { 'impl/src/application.mjs': 13_330 }` over `goal: { pathScope: ['docs/**'] }`)
and asserts the wire_frame line does NOT ship — the census is scope-scoped.

**Green condition.** The wire_frame line is conditional on the size census over the lane's SERVED
scope only.

## Verified split

Two consecutive `node --test impl/test/worker-verdict-surface-red.test.mjs` runs from the repo root:

```
ℹ tests 31 · pass 5 · fail 26
ℹ tests 31 · pass 5 · fail 26
```

The 5 passes are exactly the PIN rows (C4, E1, E2, E3, E4); the 26 failures are the RED rows, each
confirmed to fail at its NAMED stage. The fold's green-side fixes keep D2/A3 failing on the ABSENT
invented surface, never on the fragility the fold removed.

## No contract movement

Every finding is a suite-side fold. None changes a R1–R9 pin, a fold B2/B3/B5/B6 shape, the fold
Minor 1 subset, or the fold Minor 2 carve-out — so `contract-fold.md` stays at **v1.1**. The blue
team's findings target the suite's red-keeping power and green-side hazards, not the contract's
guarantees; the fix for each is a new or hardened row in the suite, as mapped above.
