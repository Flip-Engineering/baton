# #61 RED-TEAM VERDICT — adversarial attack on `worker-verdict-surface-contract.md` v1.0

Verifier: red-team pass r2-2026-08-13. Verification HEAD: **`25139b9f1d82411b4278cf3c0ef9c9a7efa6be63`**
(current worktree HEAD; the contract's stated HEAD `2b5003a1…` is not the tree under test — every
citation below was re-grepped at this HEAD). NUL files (`application.mjs`, `coordination-store.mjs`)
were touched only via `grep -an` / `sed -n`, never whole-file reads.

Laws applied: no clocks (none found); every citation re-verified at the current HEAD; sorted-key
literals in ACTUAL source order (none contested); `localeCompare` banned (none found).

---

## 1. Citation re-verification — PASS (no wrong citations → no automatic blocker)

All GT1–GT6 anchors and the decision/pin citations were re-verified at HEAD. The NUL discipline was
respected for `application.mjs` and `coordination-store.mjs` (`grep -an`/`sed -n` only).

| Contract claim | Anchor | Verified |
|---|---|---|
| GT1 `debugGateRefusal(events)` span, candidate filter (error/`phase==='trust_gate'`, `verify.reverified` `accept===false`), `.at(-1)` latest | application.mjs:993-1014 | ✓ (`candidates.at(-1)` :999; `boundedAttentionText` message :1007-1008; `debugTerminalCode` :1010) |
| GT1 `debugGateFromLiveCode` + `DEBUG_GATE_CODES` (ACTUAL order `scope, red_green, coverage, route_mismatch, forbidden_effect, unknown`) | application.mjs:949-956, :945-948 | ✓ (5-way if + default `unknown`; set literal in that order) |
| GT1 `debugGateDetail`: scope→`{digests, counts}` never paths; red_green/coverage→`sanitizeVerifierDiagnosticText(raw).text`; every other gate→`{}` | application.mjs:958-990; verifier-diagnostics.mjs:26 | ✓ (scope digests/counts branches :960-979; red_green/coverage tail :981-988; else `{}` :990) |
| GT1 `_debugMember`; `run.debug` failure leg consumes the SAME projection | application.mjs:11300-11313, :11321 | ✓ (`_debugMember` starts :11300; `const failure = gateRefusal ?? …` :11321) — range note: the function extends past :11313; call at :11321 sits outside the cited span. Cosmetic. |
| GT2 trust-gate `error` mint `{message, code, phase:'trust_gate', trustPhase, …}` | coordinator.mjs:13284-13289 | ✓ (kind `error`, `phase: 'trust_gate'`, `trustPhase`; spreads `requiredEffectEvidence`/`pathScopeEvidence`) |
| GT2 `pathScopeEvidence` digest+count shape | coordinator.mjs:12979-12983 | ✓ |
| GT2 `verify.reverified` carries top-level `worker` | coordinator.mjs:6459, :6462; :13094 | ✓ (`worker: workerId` :6459, kind mint :6462; `worker: handle.id` :13094) |
| GT3 `_providerBrief` seam | coordinator.mjs:3790 | ✓ |
| GT3 digest-pin `recovery_refinement_conflict` | coordination-store.mjs:3037-3043 | ✓ (`canonicalDigest(fields.brief) !== canonicalDigest(priorTask.brief)`) |
| GT4 `## Constraints` / `Constraints:` renderers | adapter.mjs:128-131; cli-adapters.mjs:100-101 | ✓ |
| GT4 constraint composition at admission + `profileConstraint` | application.mjs:4572-4575, :2207-2209 | ✓ (`profileConstraint(name, profile)` → `Baton deployment profile ${name}@${profile.digest}`) |
| GT4 result-policy markers closed literals | application.mjs:117-119 | ✓ (`Baton objective/result policy …` prefix :112) |
| GT4 `IMPLEMENT_CONSTRAINTS` static list, incl. no-commit :532, wire_frame :531, coaching :530/:533, scratchpad :536 | recipes.mjs:529-537 | ✓ (all five lines present verbatim) |
| GT5 #141 boundary-commit law; lived losses; hub snapshot commit | impl-114-brief.md:45; redrive-continuity-contract.md:55, 90; application-deployment.mjs:222 | ✓ |
| GT6 `wire.frame` 1 MiB; oversize code; served-scope file sizes | limits.mjs:81; issue #28; 17,249 / 13,326 / 14,379 | ✓ (`wc -l` confirms all three) |

**Citation verdict: PASS.** No wrong citations. Two cosmetic range notes: GT1 `_debugMember`
(11300-11313 — the gateRefusal call is at :11321, outside the cited span), and GT1 message
boundedAttentionText cited :1007-1009 (the field is :1007-1008). Neither affects substance.

**RED-state confirmation:** no `check`/`evidence`/`corrective` field, no corrective table, no
named-source constraint derivation, no `objective_constraint_underrived` / `objective_constraint_unenforced`
literal, no `verdict_surface_corrective_forced` anywhere in `impl/` at HEAD. **All pins R1–R9 are
genuinely red-first.**

---

## 2. Decision verdicts

### D1 — The four-field corrective verdict surface — **HOLE** (4)

**SOUND:**
- `gate` is closed (`DEBUG_GATE_CODES`), `corrective` is hub-minted per terminal code and closed
  (`null` for absent codes — honest escalate). The per-code keying is right: `required_effect_absent`
  degrades to gate `unknown` under today's mapping (application.mjs:954 default) but keeps its durable
  code via `debugTerminalCode` (application.mjs:1010) — verified the corrective survives the gate
  degradation, exactly as R3/OQ2 claim.
- The "one projection, three consumers" structure and `.at(-1)` supersession match #79's pinned
  semantics; per-worker scoping matches #79's D6 fix. No re-verdict-after-feedback is possible (#73's
  `application_workflow_feedback_gate_unbound` gates the feedback channel); a terminalized run cannot
  mint a later gate event (trust-gate error transitions the task to `failed`,
  coordinator.mjs:13294-13298). The "projected once" law holds.

**HOLE 1 — `check` is not closed and leaks gate-internal phase names.**
For error-kind refusals `check` is the raw `trustPhase` (D1 §check; the source mint at
coordinator.mjs:13284). The eval order (GT2) includes `evidence_mapping`, `terminal_batch`,
`promotion`, `complete` — internal eval phases with NO corrective-table row. A trust-gate error minted
at `promotion` would surface `check: 'promotion'` (a phase name the worker has no vocabulary for, and
one D1's own table never defines). For `verify.reverified` refusals `check` is "red_green verification"
/ "coverage verification" — but the closed verifier set is `CLOSED_VERIFIER_DIAGNOSTICS`
(coordinator.mjs:417-421, 11 codes). Only two map to a corrective row; the other eight
(`verification_output_exceeded`, `verification_timed_out`, `verification_spawn_unavailable`,
`verification_claim_diverged`, `verification_mutation_failed`, `verification_coverage_unavailable`,
`verification_mutation_unavailable`, `verification_exit_mismatch`) fall through to the table's catch-all
`unknown | — | {} | null`. A worker whose verification failed as `verification_mutation_failed`
(accept:false, real and reachable) learns "unknown gate, check `—`, escalate" — the "WHAT it checked"
promise of the four-field surface is broken precisely for the refusals that carry a diagnosticCode.
*Fix: close the `check` domain — for error-kind refusals whitelist the phases that have corrective rows
(`path_scope`, `forbidden_effect`, `required_effect`); any other trustPhase escalates (`check: null`).
For `verify.reverified` refusals, `check` = the `verdict.diagnosticCode` itself (a closed enum), not a
two-row label; the D1 table gains rows for the reachable non-red_green/coverage codes.*

**HOLE 2 — the `route_mismatch` table row is unreachable; the corrective never ships.**
`plan_route_mismatch` is a dispatch-time `throw` at coordinator.mjs:4315 — thrown BEFORE
`_allocWorkerId` (:4317), i.e. before the worker has an identity, and it is a plain Error, never an
event. `recovery_route_mismatch` is a result string (coordinator.mjs:5482, :5842 via
`_failPreservedReattachment`), not an event kind. Neither can match `debugGateRefusal`'s candidate
filter (error/`trust_gate` or `verify.reverified` accept:false). The `debugGateFromLiveCode`
`route_mismatch` branch (application.mjs:954) is dead for the verdict surface. So the table advertises
`exact_harness_dispatch` for a code that can never be projected — and, worse, the ACTUAL dispatch-time
route mismatch (`goal_plan_required` :4313, `plan_route_mismatch` :4315) is exactly a
worker-never-learns-why case: the request is rejected before any worker exists, no gate event, no
verdict, no corrective. *Fix: either (a) delete the `route_mismatch` row and the map branch from the
surface's claims, stating D1 covers post-identity gate/verifier refusals only, or (b) add a
request-keyed dispatch-refusal projection (`goal_plan_required`/`plan_route_mismatch`) delivered to the
caller, keyed to the request, not the worker.*

**HOLE 3 — `evidence` collides with the landed #79 field `detail`.**
D1's surface names the sanitized evidence field `evidence` (`debugGateDetail` output, D1 §evidence),
and R1 pins the worker receives `{gate, check, evidence, corrective}` via "the #79 push, cross-ref".
But #79 D6 pins the pushed item shape as `{kind, code, message, gate, detail}`
(worker-delivery-push-contract.md:315-317) and #79 R2 asserts "scope `detail` carries digests+counts".
Same projection output, two field names (`detail` vs `evidence`), never reconciled. A worker
implementing against #79's shape reads `detail`; one implementing against #61's R1 reads `evidence` —
one of them reads `undefined`. "One projection, three consumers" (R4) is true at the function level but
false at the consumer-shape level. *Fix: pin the shared projection's field name — either `evidence`
renames `detail` (requires a #79-shape fold and a #79-R2 edit), or the surface keeps `detail` and R1's
four-field framing is rewritten to `{gate, check, detail, corrective}`. R1 must assert the exact key.*

**HOLE 4 (minor) — `required_effect_absent` evidence is pinned `{}` though sanitizable evidence
exists.** The table's `required_effect` row pins evidence class `{}` because `debugGateDetail` returns
`{}` for gate `unknown` (application.mjs:990). But the trust-gate error mint spreads
`err.requiredEffectEvidence` onto the event when present (coordinator.mjs:13285; the shape is minted at
:13000/:13125 — a digest+count object with `changedPathCount`/`changedPathsDigest`, never paths). A
worker whose only failure is a missing in-scope edit gets `evidence: {}` — no digests to compare its
own change-set against — contradicting the surface's own "failing evidence CLASS" promise. *Fix: add a
`required_effect` branch to `debugGateDetail` projecting the digest/count subset (mirroring the scope
branch); update the table row's evidence class from `{}` to a digest/count shape.*

### D2 — Objectives generated from live truth — **HOLE** (4)

**SOUND:** Rule 1 (named live source per line) and Rule 2 (honest absence, never boilerplate) are the
right shape; the suppression record in Observability is honest; two composes over the same state derive
the same block (pure function).

**HOLE 1 — the anchored seam is NOT the seam that ships the static boilerplate (the "boilerplate still
ships" path).** D2 anchors the block to the `## Constraints`/`Constraints:` render seam
(adapter.mjs:128-131, cli-adapters.mjs:100) — i.e. `brief.constraints`, which is ALREADY live-composed
at admission (GT4, application.mjs:4572-4575). The false static lines do NOT ship there. They ship
through the implement-contract recipe objective render: `renderObjective` =
`[task, ...constraints, "[attempt: salt role]"].join('\n')` (recipes.mjs:296-309) with
`constraints` = `IMPLEMENT_CONSTRAINTS` (recipes.mjs:529-537), via `renderMember` (recipes.mjs:327).
A RED-row implementer who follows D2 verbatim fixes the `## Constraints` seam (already live) and leaves
the no-commit/wire_frame/coaching lines shipping verbatim in every implement-contract objective. This
is exactly the brief's trap: "a projection that exists but carries boilerplate instead of the live
corrective." *Fix: re-anchor Rule 1/Rule 2 to the recipe objective render
(`renderObjective`/`renderMember`), pin that implement-contract objectives are produced by the same
per-line named-source derivation, and retire `IMPLEMENT_CONSTRAINTS` (or reduce it to the lines that
can be named — the scratchpad closed-shape line, per GT4's own note).*

**HOLE 2 — "live truth" is admission-frozen; the compose epoch is unpinned.** The block is composed
once at admission (application.mjs:4572-4575). The recovery-refinement digest pin
(coordination-store.mjs:3037-3043) forbids mutating `task.brief` on refinement, so a refined worker
cannot re-derive. If a line's live truth changes mid-run (the #141 boundary-commit norm is adopted
mid-campaign; the wire_frame census flips because a file over ~1500 lines lands in the served scope),
the served block is stale with no re-derivation rule and no stated epoch. Rule 1's "re-derivable from
durable state" is honest only if "durable state" is sampled once and frozen. *Fix: pin the epoch — "the
block is derived at admission and frozen for the run (a pure function of the admission-time deployment
state); mid-run policy changes do not retro-edit a served block; the suppression record carries the
derivation epoch." This makes "live" honest as admission-truth.*

**HOLE 3 — the boundary-commit live source does not exist as durable state.** Rule 1's table derives
the boundary-commit line "IFF the deployment's worktree-harvest policy expects boundary commits — the
#141 workstyle law (impl-114-brief.md:45)". A `worktreeHarvestPolicy` field does not exist in
`application-deployment.mjs` or anywhere in `impl/src` (grep for `worktreeHarvest`/`harvestPolicy`/
`boundary_commit` finds docs only). The deployment profile carries the verification-command bound
(application-deployment.mjs:891-893) but no harvest policy. So this row violates Rule 1's own
"re-derivable from the deployment's durable state", and R6's predicate ("a deployment whose
worktree-harvest policy expects boundary commits") is unanswerable by any code path — the implementer
must invent the field. *Fix: add `worktreeHarvestPolicy` (or `boundaryCommit: 'enabled' | 'disabled'`)
to the deployment-profile schema with a documented default, name it in `application-deployment.mjs`,
and make R6's predicate read that field.*

**HOLE 4 (minor) — the `[attempt:]` salt line is not carved out.** `renderObjective` appends
`[attempt: ${salt} ${role}]` (recipes.mjs:309) with the salt minted per attempt at runRecipe time
(recipes.mjs:509). It is a per-attempt dynamic discriminator inside the same objective text D2 governs —
neither a constraint line nor a named-source policy line. Applied wholesale, Rule 2 could suppress it
or Rule 1 would demand a named source for it, breaking attempt tracking. *Fix: one sentence — "the
`[attempt: salt role]` line is the per-attempt discriminator, re-derived from the attempt salt, and is
not a constraint line under Rule 1/2."*

**HOLE 5 (minor) — the wire_frame census source is unnamed.** R8 requires the wire_frame line IFF "the
lane-liveness read confirms the served scope carries a file over ~1500 lines". GT6 establishes the
served-scope files exist, but the "read" is unspecified — is it the goal's `pathScope`, a file-size
census at admission, or a per-lane scan? The Rule 1 table cites `limits.mjs:81` "plus the scope census"
— a mechanic with no named function. *Fix: name the census source — e.g. "the lane's served scope
(`brief.constraints` pathScope) resolved against the effective tree at the admission SHA".*

**Note on the coaching carve-out:** Rule 2 reclassifies the red-first/style lines (recipes.mjs:530,
533) as "coaching … ride the objective prose, never the constraint block" — which lets them keep
shipping verbatim with no named source. If the served objective text is in Rule 1's scope, they ship
underived; if it is out of scope, the contract must say so explicitly. As written the scope is ambiguous
("the objective constraint block"). Fold with HOLE 1: pin the scope boundary.

### Composition with the landed surface — **SOUND** (no contradiction)

- **#10 waitingOn vocabulary:** the four-field surface and the corrective classes touch neither
  `ATTENTION_TYPES` (messages.mjs:18) nor the waitingOn kinds; the `gate_verdict` push is not a
  waitingOn kind. No interaction. ✓
- **#61/#62 split:** local cross-references establish #61 owns the verdict surface + live-truth
  objectives and #62 owns the write-failure red suite whose harness shape
  (`issue62-write-failure-red.test.mjs`) the #61 suite mirrors. Coherent. (`gh issue view 61` was
  unavailable — `gh` not authenticated in this environment — so the split was verified via the local
  docs; no contradiction found.) ✓
- **Trust-gate steering laws (T15):** the corrective enum values (`in_scope_revision`, `in_scope_edit`,
  `failing_check_fix`, `coverage_completion`, `forbidden_effect_retraction`,
  `exact_harness_dispatch`) match none of the forbidden coaching patterns
  (`/skeleton[- ]first/i`, `/trust.?gate/i`, `/beat(?:ing)? the gate/i`, `/survive the gate/i`,
  `/no.?diff/i`, `/progress gate/i` — trust-gate-steering-red.test.mjs:470-475). The corrective is
  hub-minted and prose-free and rides the verdict surface, never the served constraint text. No
  contradiction. ✓

---

## 3. Refusal vocabulary — **SOUND** (two conditional)

| Code | Verdict | Note |
|---|---|---|
| `verdict_surface_corrective_forced` | **SOUND** | Per-record degradation matches the #73 B5 precedent; the malformed record is excluded, never a map-wide throw. |
| `objective_constraint_underrived` | **SOUND w/ dependency** | Right shape; fires only when a caller explicitly requests an underrived line. DEPENDS on D2 HOLE 3 — until `worktreeHarvestPolicy` exists, a caller requesting the boundary-commit line has no live source to name. |
| `objective_constraint_unenforced` | **SOUND** | The enforcement read is real: `FRAME_LIMITS` rows + deployment-profile constraints exist. |
| Cross-refs (`application_workflow_feedback_gate_unbound`, `recovery_refinement_conflict`) | **SOUND** | Both verified present at HEAD. |

---

## 4. Acceptance pins R1–R9 — RED-first confirmed, with dependencies

All nine pins are genuinely red at HEAD (§1 RED-state confirmation) and testable with the
`issue62-write-failure-red.test.mjs` harness shape. Pin dependencies on the holes above:

- **R1** — DEPENDS on D1 HOLE 3. The pin asserts the worker receives `evidence`, but the landed #79
  push shape carries `detail`; until the field name is reconciled the pin cannot be implemented against
  the pushed shape.
- **R2** — SOUND; add the `required_effect` evidence assertion from D1 HOLE 4.
- **R3** — SOUND (per-code hub-minted corrective; `null` escalation).
- **R4** — SOUND in shape; DEPENDS on D1 HOLE 3 for "one projection, three consumers" to hold across
  the #79 push shape.
- **R5** — SOUND (the surface rides the push/`run.debug`, never `task.brief`; the digest pin stays
  byte-stable).
- **R6** — DEPENDS on D2 HOLE 3 (no `worktreeHarvestPolicy` field exists; the predicate is
  unanswerable as written).
- **R7** — DEPENDS on D2 HOLE 1 (the RED cites `recipes.mjs:530-536` shipping static lines, but the
  fix anchors the wrong seam — the recipe objective render is the shipping seam) and the coaching
  scope note.
- **R8** — DEPENDS on D2 HOLE 5 (census source unnamed).
- **R9** — SOUND (pure function of admission-time deployment state once the epoch is pinned, D2 HOLE 2).

---

## 5. Open questions — verdicts

- **OQ1 (where the corrective table lives):** **SOUND** — the hub-minted table beside `DEBUG_GATE_CODES`
  is the right call and the alternative (deployment-policy table) is correctly rejected as a forged
  corrective (#73's class). One addition: the acceptance source-scan must enumerate REACHABLE terminal
  codes (D1 HOLE 2 removes `plan_route_mismatch`/`recovery_route_mismatch` from reachability).
- **OQ2 (required_effect_absent corrective):** **SOUND** — verified the corrective survives the gate
  degradation (code-keyed, `debugTerminalCode` preserves the live code; `debugGateFromLiveCode` maps
  it to `unknown`). The "table follows, never leads" rule is sound.
- **OQ3 (boundary-commit served text):** **SOUND in shape; DEPENDS on D2 HOLE 3** — the
  "worktree-harvest policy expects boundary commits" predicate needs the policy field to exist. The
  suppression-record honesty (absence is observable either way) is correct.

---

## 6. Final verdict: **NOT FOLD-READY**

Numbered blockers (what + why + concrete fix):

1. **D2 anchors the wrong seam — the false static lines still ship.** D2 governs the `## Constraints`
   render seam (adapter.mjs:128-131), but the no-commit/wire_frame/coaching boilerplate ships through
   the implement-contract recipe objective render (`renderObjective`/`renderMember`, recipes.mjs:296-309,
   :327, over `IMPLEMENT_CONSTRAINTS` recipes.mjs:529-537) — a seam D2 never touches. A verbatim
   implementer fixes an already-live seam and leaves the boilerplate in every implement objective.
   *Fix: re-anchor Rule 1/Rule 2 to the recipe objective render and retire `IMPLEMENT_CONSTRAINTS`
   (or reduce it to named-source lines); pin the coaching scope boundary.*
2. **D1 `evidence` collides with the landed #79 field `detail`.** R1 says the push carries `evidence`;
   #79 D6/R2 pins the push shape's sanitized field as `detail`. Same projection output, two names; one
   consumer reads `undefined`. *Fix: pin the shared field name (rename `detail`→`evidence` with a #79
   fold, or keep `detail` and rewrite R1); R1 must assert the exact key.*
3. **D1 `check` is not closed and leaks gate-internal phases.** Error-kind refusals surface raw
   `trustPhase` (including `evidence_mapping`/`terminal_batch`/`promotion`/`complete`, which have no
   corrective rows); the eight non-red_green/coverage `CLOSED_VERIFIER_DIAGNOSTICS` codes fall to
   `unknown | — | null`, losing "WHAT it checked". *Fix: close the check domain — whitelist
   phases/diagnosticCodes with corrective rows; everything else escalates with `check: null`.*
4. **D1 `route_mismatch` is unreachable and dispatch-time refusals are uncovered.** `plan_route_mismatch`
   throws pre-identity (coordinator.mjs:4315); `recovery_route_mismatch` is a result string
   (:5482/:5842); neither reaches `debugGateRefusal`. The `exact_harness_dispatch` corrective can never
   ship, and pre-identity route mismatch is a worker-never-learns-why gap. *Fix: remove the row + map
   branch, or add a request-keyed dispatch-refusal projection.*
5. **D2's boundary-commit live source does not exist as durable state.** Rule 1/R6/OQ3 reference a
   "worktree-harvest policy" field absent from the deployment-profile schema. *Fix: add
   `worktreeHarvestPolicy` (or `boundaryCommit`) to the profile with a default and name it in the table.*
6. **D2 "live truth" epoch unpinned.** The block is admission-frozen (composed at :4572-4575; refinement
   digest-pin forbids re-derivation) with no stated epoch or mid-run-change rule. *Fix: pin
   admission-time derivation + freeze for the run; the suppression record carries the derivation epoch.*

**Minors (non-blocking, fold with the fix):** `required_effect_absent` evidence `{}` should project the
sanitizable `requiredEffectEvidence` digest/count shape (D1 HOLE 4); the `[attempt:]` salt line needs
the Rule 1/2 carve-out (D2 HOLE 4); the wire_frame census source is unnamed (D2 HOLE 5); GT1's
`_debugMember` citation range is loose (11300-11313; call at :11321).

**What the fold must NOT change:** the code-keyed corrective design (R3/OQ2 — the only mechanism that
rescues `required_effect_absent` from gate degradation); the hub-minted/no-caller-authored law (#73);
the per-worker projection + `.at(-1)` supersession (matches #79); R5's byte-stability of the digest
pin; the refusal family; the "honest absence is observable" suppression record.
