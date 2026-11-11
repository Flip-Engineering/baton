# #61 BLUE-TEAM REPORT — attack the worker-verdict-surface red-first suite

Date: 2026-08-13 · Target: `impl/test/worker-verdict-surface-red.test.mjs` (24 rows — 19 RED / 5 PIN) ·
Authority read in order: `contract-fold.md` (v1.1), the suite, `suite-draft-notes.md` · Suite HEAD:
`b0ec6cc` (draft) / this tree `dd6f584` — the suite runs green-5/red-19 here unchanged.

**Verified split (this HEAD, repo root):** two consecutive `node --test impl/test/worker-verdict-surface-red.test.mjs`
runs both produced **tests 24 · pass 5 · fail 19**; the 5 passes are exactly C4, E1, E2, E3, E4 (the PIN
rows), and the 19 RED rows each fail at the stage named in its row header (spot-checked A1 →
`verdict-surface-missing`, C3 → `run-debug-verdict-missing`, B4 → `forced-corrective-refusal-missing`,
D4 → `underrived-refusal-missing`, D7 → `live-composition-missing`). The split is deterministic.

**Method.** Every fixture was traced against the real source it claims to mint: the fixture events were
checked against `debugGateRefusal`'s candidate filter (application.mjs:993-1004) and `debugGateDetail`
(application.mjs:958-990); the coordinator mints at coordinator.mjs:13207-13235 (path_scope /
required_effect), :13510-13517 (error mint), :6475-6495 & :13324 (verify.reverified), :4335 / :5505-5506
/ :5866 (the B4 pre-identity refusals); the D-row inputs against the admission composition
(application.mjs:4572-4575), `profileConstraint` (application.mjs:2207-2209), `EXPLICIT_RESULT_CONSTRAINTS`
(application.mjs:117-119), the objective render (`renderObjective` recipes.mjs:296-309, `renderMember`
:327, `IMPLEMENT_CONSTRAINTS` :529-537), the profile schema (`applicationProfile`
application-deployment.mjs:899-938), and the sanitizer (`sanitizeVerifierDiagnosticText`
verifier-diagnostics.mjs:26-70). NUL-bearing files (application.mjs, coordination-store.mjs) were
touched only via `grep -an`/`sed -n`; the clean files were read whole for the anchor slices. No clocks
were used in this analysis.

---

## Axis 1 — Green-side blockers (can every RED row go green under a CORRECT v1.1 implementation?)

### Verdict: NEEDS-FOLD

The fixture architecture genuinely drives real terminal codes through the projection. `debugGateRefusal`
(application.mjs:993-1004) accepts exactly two candidate classes — `error` with `payload['phase'] ===
'trust_gate'`, and `verify.reverified` with `accept === false` — and reads the code from
`payload.code` / `payload.verdict.diagnosticCode`. The A/B/C fixtures match both filters and carry the
real mint shapes: `worker_path_scope_violation` + `pathScopeEvidence` (the six-field digest+count
shape, coordinator.mjs:13207-13215), `required_effect_absent` + `requiredEffectEvidence`
(coordinator.mjs:13228-13235), `verification_red_green_failed` / `verification_mutation_failed` via
`{verdict: {diagnosticCode, failureCapsule}}` (the real verify.reverified payload), and the promotion
failure as `trust_gate_failed` (the real error-mint fallback, coordinator.mjs:13501-13504). `actor:
'worker'` in the fixtures vs the real `actor: 'policy'` is irrelevant — the filter keys on kind +
payload only. Both `worktreeHarvestPolicy` values are mintable (D1 `boundary-commits`, D3
`orchestrator-harvest`), and the A4 adversarial capsule (home path + JWT) is fully redacted by the
existing sanitizer (the `/Users|home` path sanitizer and the `eyJ…` secret pattern at
verifier-diagnostics.mjs:46-60), so A4's never-raw assertions hold against a reuse-verbatim
implementation. The C3/E1 rows drive the real `createDriver` + `BatonApplication` stack and the gate
event reaches the run.debug projection (E1 is green; C3 fails at its named `check` seam, not a
precondition). **Axis 1 is greenable except for the two findings below.**

**G1 — D2's 1200-char source window can reject a correct placement of `worktreeHarvestPolicy` (green-side fragility).**
The row reads `application-deployment.mjs` whole, finds `function applicationProfile`, slices only the
first 1200 chars, and asserts `worktreeHarvestPolicy` and `orchestrator-harvest` appear there
(suite:706-716). The measured slice ends mid-`integrationPolicy` — `integrationPolicy: { mode:
'manual', strategies: ['ff-only',` — i.e. at ~application-deployment.mjs:918. The profile object runs
to :938 (`followPolicy`, `exportPolicy`). A correct implementation that adds the fold-B5 field near the
object's end (any legitimate schema placement past the slice) fails the row *even though the field
exists in the schema*. The 1200-char window is an arbitrary proximity cap, the very class of arbitrary
numeric limit the suite law forbids. **Fix:** slice the full function body — `source.slice(start,
source.indexOf('});', start))` — or assert membership structurally (grep the whole function's line span
for the field and the default literal). `application-deployment.mjs` is NUL-free and read whole, so the
widen is free.

**G2 — the A3 fixture over-specifies `requiredEffectEvidence` beyond the real mint (minor fidelity).**
The fixture adds `outOfScopeChangedPathCount`/`outOfScopeChangedPathsDigest` (suite:228-229); the real
mint (coordinator.mjs:13228-13235) carries no out-of-scope fields — the path_scope phase throws first,
so by the required-effect phase out-of-scope is always zero. Not a blocker (the strict four-field
subset assertion drops the extras), but the fixture comment "the coordinator.mjs:13229-13235 mint
shape" is inaccurate, and the extras give a future maintainer cover to "simplify" the subset to a
passthrough of the whole evidence object without a failing test. **Fix:** drop the two out-of-scope
fields so the fixture mirrors the real mint byte-for-byte.

*(R9's "can the fixture change live truth MID-RUN to prove the freeze?" — no, it cannot; that is a
missing-row finding, M1 under Axis 3.)*

---

## Axis 2 — Shallow-greenability (could a wrong implementation go green?)

### Verdict: NEEDS-FOLD

**S1 — the D rows test the invented `composeObjectiveConstraintLines` in isolation; nothing anchors it to
the real render seam (headline).**
Every D1/D3–D8 row calls `recipesNs.composeObjectiveConstraintLines(input)` and never touches
`renderObjective`/`renderMember` (recipes.mjs:296-309, :327) or `IMPLEMENT_CONSTRAINTS`
(recipes.mjs:529-537). R7's RED seam is precisely "recipes.mjs:529-537 ships five static lines through
`renderObjective`, none with a named live source". A wrong-but-green implementation can export a
correct-looking composition that satisfies D1–D8 *and leave the objective render untouched*: the
worker-facing objective still ships the five static lines (the no-commit boilerplate, the unconditional
wire_frame line, the two coaching lines) while the suite passes. The suite's green condition is weaker
than the contract's green — the exact red behavior the suite is meant to keep red can coexist with a
full green pass. This is the brief's "registry that exists but is never consulted (the lines still
render boilerplate)" concern, and it is real. **Fix:** add a seam-anchored row. Concretely: (a) call
`renderObjective`/`renderMember` with the composed `lines` under each harvest policy and assert the
rendered objective text excludes the no-commit line on `boundary-commits` and includes it on
`orchestrator-harvest`; and/or (b) a source-scan asserting fold B1's retirement — `IMPLEMENT_CONSTRAINTS`
reduced to the scratchpad closed-shape line and `renderObjective`'s constraint input sourced from the
composition, not the static list.

**S2 — served-line VALUES are never asserted against the live inputs; the always-served Rule 1 lines
are never required.**
The per-line check is a regex-prefix filter on whatever lines ARE served
(`NAMED_SOURCE_PATTERNS`, suite:173-183). No row requires the profile-digest line, the `Work only
within:` line, the workflow line, the result-policy line, or the SCRATCHPAD_WRITE line to be present,
and no row checks a served line's derived value against the fixture — D1/D3 never assert the profile
line carries `p…`/`q…` (the actual `profile.digest`), never assert `Work only within: impl/test/**`
equals `goal.pathScope`, and D7 never asserts `workflowConstraint`/`resultConstraint` are served at
all (only that two composes are identical and the epoch is present). A composition that serves only the
policy-conditional lines (`Do NOT git commit` / boundary + the conditional wire_frame) and never reads
`input.goal.pathScope` or `input.profile.digest` passes every D row. **Fix:** extend D1/D3 (or add a D
row) to assert the exact served lines — e.g. `Work only within: impl/test/**`, `Baton deployment profile
default@<the actual digest>`, `Baton workflow wave:seat:join`, `Baton objective/result policy explicit
change_v1`, and the SCRATCHPAD_WRITE line — and add a variation case (different pathScope/digest →
different served value) so value-level derivation, not just prefix-level, is pinned.

**S3 — the closed `check` domain's positive mappings are only partially pinned; over-escalation to
`check: null` on the unpinned members passes.**
Positives pinned: `path_scope` (A1), `required_effect` (A3), `verification_red_green_failed` (A4),
`verification_mutation_failed` (B1). Unpinned: the whitelist's **`forbidden_effect`** member — no
fixture projects a `forbidden_effect_observed` event, so gate/check/corrective for it are never
asserted (the corrective row exists only in the B2 table literal); **`verification_coverage_failed`** —
never projected (its gate `coverage`, closed-code `check`, sanitized tail, and
`coverage_completion` corrective are unpinned); and the other **six** null verifier diagnostics
(`verification_output_exceeded`, `verification_timed_out`, `verification_spawn_unavailable`,
`verification_claim_diverged`, `verification_coverage_unavailable`, `verification_mutation_unavailable`,
`verification_exit_mismatch`) — B3 scans the corrective TABLE only (a table row can be `null`), never the
projection's `check`, so an implementation that maps those diagnostics to `check: null` (instead of the
closed code) passes. Fold B3's law — "check is the closed domain: whitelisted trustPhase or the closed
verifier diagnosticCode, everything else null" — is enforced only on its sampled members. **Fix:** add
projection rows for `forbidden_effect_observed` (→ gate `forbidden_effect`, check `forbidden_effect`,
detail `{}`, corrective `forbidden_effect_retraction`) and `verification_coverage_failed` (→ gate
`coverage`, check the code, sanitized `tail`, corrective `coverage_completion`); parametrize B1 across
the full null-diagnostic set so each carries `check` = the closed code.

**S4 — the authorship guard is structural-only; the forced-corrective refusal is a dead literal.**
B2 asserts `Object.isFrozen(VERDICT_CORRECTIVE_TABLE)` (structural) and B4 is a `grep -an`
source-presence check that the literal `verdict_surface_corrective_forced` exists in application.mjs
(suite:603-608). Neither EXERCISES the refusal: an implementation can export a frozen table and a dead
constant and never implement the per-record degradation the contract pins ("the malformed record is
excluded from the projection and the push/run.debug carry the un-forced `{gate, code, check, detail}` —
never a map-wide throw", the #73 B5 precedent). A caller-authored corrective wearing a hub costume is
only forbidden structurally, not behaviorally. **Fix:** a row that forces a corrective outside the
closed table (or drives a malformed surface record through the projection/composition) and asserts
`verdict_surface_corrective_forced` fires while the remaining record survives — converting the
source-presence grep into a behavioral assertion.

---

## Axis 3 — Missing rows (behaviors the contract pins that the suite does not)

### Verdict: NEEDS-FOLD

**M1 — R9's freeze is unpinned; the B6 epoch is structural-only, never behavioral (headline).**
D7 asserts compose-purity (same input → same output) and the epoch's structure
(`suppression.epoch = {profileDigest, admissionSha}`) for exactly one input. The contract's freeze —
"the block is derived at admission and FROZEN for the run — mid-run policy changes do not retro-edit a
served block" (fold B6) — is a *different* property, about the admission seam storing the block. The
suite has no mid-run mutation channel and no assertion that the admitted block survives a policy
change; and because the epoch is only checked against one input, an implementation hardcoding
`epoch: {profileDigest: 'p'.repeat(64), admissionSha: 'a'.repeat(40)}` passes D7. **Fix:** (a) a
variation row composing over DIFFERENT `profile.digest`/`admissionSha`/`worktreeHarvestPolicy` and
asserting the block AND the epoch change (kills a hardcoded epoch); (b) a seam row that composes once,
mutates the deployment policy, and asserts the admitted block the worker received is byte-stable — the
freeze as a behavioral pin, not a purity corollary.

**M2 — R4's third consumer, the #79 `gate_verdict` push, is never driven.**
R4 is "one projection, three consumers". The suite pins two consumers — the projection function itself
(A/B/C rows) and the run.debug failure leg (C3). The third — the #79 push item carrying
`{gate, check, detail, corrective}` (GT3; the suite's own harness mirror is
`worker-delivery-push-red.test.mjs`) — is never exercised. The fold-B2 `detail` reconciliation is
pinned on the projection and run.debug only. An implementation that wires the surface into run.debug
but leaves the push item at #79's pre-fold `{kind, code, message, gate, detail}` (no `check`, no
`corrective`) passes every row. **Fix:** a row driving the push seam and asserting the pushed item
carries `check` = the whitelisted phase / closed diagnosticCode and `corrective` from the same
projection.

**M3 — D6's lane-conditionality edge (a big file OUTSIDE the served scope) is unpinned.**
Both D6 fixtures place the >~1500-line file INSIDE `pathScope` (`impl/src/**` → `impl/src/application.mjs`).
A composition that emits the wire_frame line whenever ANY census entry is large — ignoring whether the
file is in the lane's served scope — passes. **Fix:** add a fixture with a large file outside the lane's
`pathScope` and assert the line does NOT ship.

*(Fold Minor 2 — the `[attempt:]` carve-out — is SOUND: the negative is pinned in D8 (never a
constraint line) and the positive (renderObjective appends `[attempt: ${salt} ${role}]` from the
supplied salt, never minting its own) is already pinned by recipes-red.test.mjs RC-2, recipes.mjs:296-309.)*

---

## Axis 4 — Hermeticity / #7-class (no real timers, no host state; `watchdog.stallMs` valid-positive)

### Verdict: SOUND

- **No clocks as controls.** The suite never uses `Date.now`/`setTimeout`/`setInterval`/`Math.random`/
  `randomUUID`/`performance.now`/`process.env`/`process.cwd`. The Coordinator-direct rows pass
  `now: () => 0` and drive the real event path with a fixed 80-iteration microtask drain
  (`flush(80)`); the full-application rows inject the gate event and read the debug projection
  synchronously. No row asserts wall-clock behavior.
- **`watchdog.stallMs` valid-positive.** Every full-application fixture passes `watchdog:
  { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' }` with the #67 fixture comment
  (suite:405-406). No fixture uses `stallMs: 0`.
- **No host-state dependency.** The only path literal that looks host-dependent — A4's
  `/Users/alice/projects/secret/…` — is adversarial capsule *content* asserted to be redacted by the
  sanitizer, not a path the suite reads. All repos/logs are `mkdtempSync` with a global `test.after`
  cleanup; the verification stub is the brief's `true` command; the adapters are the Coordinator-direct
  `ScriptableAdapter` and the in-process `MockAdapter`/`DebugAdapter` — no harness, no network, no real
  provider spawn.
- **NUL discipline and determinism hold.** `application.mjs` and `coordination-store.mjs` are touched
  only via `grep -an`/`sed -n`; the split is stable across consecutive runs (verified 5 pass / 19 fail
  twice at this HEAD).

---

## Overall verdict

**NEEDS-FOLD.** The suite's red-keeping power is real where it matters most: the fixtures drive genuine
terminal codes through the genuine `debugGateRefusal` projection (Axis 1 greenable), the hermeticity
law is fully satisfied (Axis 4 SOUND), and the policy-conditional D rows genuinely force the
`worktreeHarvestPolicy`/`sizeCensus` reads. But three weaknesses let wrong implementations through or
reject correct ones:

1. **Seam anchoring** (S1) — the invented `composeObjectiveConstraintLines` is never wired to the
   `renderObjective` seam that ships the false boilerplate, so the R7 red behavior survives a full
   green pass. This is the single highest-value fold.
2. **Value-level derivation** (S2) and **positive-mapping completeness** (S3) — the suite pins
   prefixes and sampled members, not the derived values and not the closed-domain members it omits
   (`forbidden_effect`, `verification_coverage_failed`, the other six null diagnostics).
3. **Behavioral pins for the fold's new mechanics** — the freeze (M1), the epoch's derivation (M1),
   and the #79 push consumer (M2) are structural/purity-only; the freeze the fold advertises ("frozen
   for the run") is unpinned. Plus two green-side hazards (G1's 1200-char window, G2's over-specified
   fixture) and one authorship-behavior gap (S4, the dead `verdict_surface_corrective_forced` literal).

Each finding carries a concrete fix above; none requires re-architecting the suite — the D-side folds
(S1 seam row, S2 value assertions, S3 new projection rows, M1 variation/seam rows, M2 push row) fit the
existing harness shapes.
