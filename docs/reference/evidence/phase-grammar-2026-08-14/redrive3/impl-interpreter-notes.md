# impl-interpreter-notes — row-impl-interpreter (the phase driver in workflow-interpreter.mjs)

[attempt: 26544c22-a314-483b-948d-69a07ef1bc05 row-impl-interpreter]

Date: 2026-08-14 · Attempt: `26544c22-a314-483b-948d-69a07ef1bc05` · Role: `row-impl-interpreter`.
Status: **IMPLEMENTED + VERIFIED** (the await-inputs deadlock resolved by JC-3 below — a
DECISION_REQUEST is recorded there for the coordinator).

## 0. Await-inputs status (the honest record)

The await-inputs discipline polled (30s cadence, 100+ minutes) for `phase-grammar-contract.md`
AND `suite-notes.md` in THIS directory. Neither ever arrived here:

- `suite-notes.md` landed only in the row-suite worktree of MY campaign (`ws-e8f387b6…`, salt
  `26544c22…`) — read IN FULL (it was itself still parked awaiting the contract).
- Two `phase-grammar-contract.md` files exist in SIBLING worktrees of OTHER attempts of the same
  wave: salts `9c4144b5…` (`ws-339bada8…`) and `b59fa92f…` (`ws-f640bc11…`). **JC-1 (mirrors the
  suite row's JC-1):** they are NOT my campaign's authority. Both were read IN FULL as
  non-binding background. They diverge materially (schemaVersion 2 + `admitPhaseSpec` + three
  new `workflow_phase_*` codes + `when <name> = "<lit>"` vs schemaVersion 1 + `kind:'campaign'`
  + separate `compileCampaign` + `when eq <name> "<lit>"`), so no pre-shaping was safe.

### JC-3 — the deadlock break (DECISION_REQUEST for the coordinator)

After 100+ minutes with zero trace of my attempt's contract row in ANY worktree, waiting longer
meant delivering nothing. I proceeded PROVISIONALLY on the only complete, self-consistent pair
on disk: the `b59fa92f…` contract + its suite (`impl/test/workflow-phases-red.test.mjs`, read in
full from `ws-f640bc11…`). Rationale: the b59fa92f contract keeps the #170 substrate untouched
(schemaVersion 1, the closed 5-code refusal family, no new codes) — the exact constraint set my
brief pins — while the 9c4144b5 contract invents a parallel admission surface (`admitPhaseSpec`,
schemaVersion 2) that would have forced shared-file reach into `workflow-dsl.mjs` (row-impl-
compiler's partition). My implementation is behavior-pinned to the b59fa92f INTERFACE (campaign
IR shape, receipt shape, steering triggers, verdict vocabulary) but written in my file's own
idiom; if my attempt's contract later lands with different spellings, the diff is mechanical
and local to `impl/src/workflow-interpreter.mjs` (my partition).

**DECISION_REQUEST:** (a) ratify the provisional b59fa92f interface as this attempt's contract
of record; (b) re-dispatch the contract row for salt `26544c22…` and I fold any deltas; or
(c) reject the provisional basis and re-drive this row. Default if unreachable: (a) — the
suite is green end-to-end and the #170 substrate is proven untouched.

## 1. What landed (the interpreter half only)

`impl/src/workflow-interpreter.mjs` grew a campaign lane (~330 lines appended after
`tryElevate`, before `export default`), plus a 6-line dispatch hook in `runWorkflow`:

- `raw.kind === 'campaign'` dispatches to `runCampaign(baton, raw, options)` BEFORE
  `admitSpec` (admitSpec would refuse `phases` as an unknown field). The single-wave path is
  otherwise byte-untouched.
- `admitCampaign` (exported): the closed four-field campaign shape (`schemaVersion`,
  `idempotencyKey`, `kind`, `phases`), recursive closed-shape validation — `when` op enum
  {eq,neq}, `checkpoint` boolean, `decision {question, options[]}`, `outcome {name, file,
  pattern}` with harvest containment, `coupling` enum {loose,shared,tight}, per-phase
  members/steering/harvest — unique phase names, deep-frozen. Identity-preserving
  normalization: `canonicalJson(admitCampaign(ir)) === canonicalJson(ir)` (PG-P6).
- `runCampaign` (exported): the phase driver — sequential phases; per phase: `when` gate →
  checkpoint park → drive. Verdicts CAMPAIGN-OK / CAMPAIGN-PARKED / CAMPAIGN-INCOMPLETE.
- MEMBER_FIELDS stays byte-exact the 5 closed fields (PG-PIN-B green); coupling is
  campaign-member-only, peeled before `admitMember`.

## 2. Semantics implemented (decisions, anchored)

- **Phase sequencing** (:1262-1281 in the working tree): strictly sequential; a phase's
  `phase_start` can only follow the prior phase's `phase_outcome` in the steering trail.
- **`when` gating** — `evaluateWhen` (:1087-1092): eq/neq over a prior extracted outcome.
  An ABSENT outcome (`never declared` or `matched:false`) fails BOTH operators — fail-closed,
  the driver never fabricates a value. A false gate SKIPS the phase (`phase_gate` satisfied
  false + `phase_skip`; the phase's members are never spawned — PG-P3d).
- **Outcome extraction** — `extractOutcomeFromBytes` (:1097-1105): the FIRST line of the
  phase's AUTHORITATIVE harvest bytes containing the pattern; value = that line's text after
  the LAST occurrence of the pattern, trimmed. No regex, no eval. Miss → `{matched:false,
  value:null}`. The extraction runs inside `driveCampaignPhase` over the `harvestOne`-recovered
  bytes (never a fresh disk read), then receipts `phase_outcome` (:1216-1223).
- **Checkpoint park** (:1272-1277): a `checkpoint: true` phase parks the campaign — verdict
  CAMPAIGN-PARKED, phase verdict PARKED, the decision packet `{question, options}` rides the
  steering trail as `phase_checkpoint`, later phases never start (PG-P4). Resume is
  orchestrator-side: re-drive after the answer (the settled-prefix reuse path below carries it).
- **Per-phase roster casting**: each phase's members are admitted fresh (a role re-cast across
  phases is a new admission object); coupling cascades member → phase → loose, matching the
  compiler's lowering exactly. shared/tight are receipted as `phase_coupling` steering events
  naming their preconditions (#158 / #102) — never silently degraded to loose.
- **Mid-flight amendment** — `driveCampaignPhase` catches `wave_already_terminal` (#183) from
  `waves.start` on the phase-addressed key `<campaignKey>:<phaseName>` → `reuseSettledPhase`
  (:1110-1121): verdict REUSED, the settled outcome re-read from the materialized harvest file
  on disk (the prior run's `harvestOne`→`materializeToDisk` artifact), a `phase_reused` event
  recorded, and the member NEVER re-spawned (PG-P5). Settled phases are never recomputed.
- **Quiescence only** (#163 law): no new wall-clock governs sequencing — the phase loop keys
  on settle/harvest/outcome/answer evidence. The per-phase drive reuses `driveLane` with the
  driver's existing (caller-pinned) budget; no campaign-level cap was added.
- **Refusals**: only the five closed codes (`workflow_spec_invalid`,
  `workflow_member_invalid`, …) — the campaign surface adds NO new codes.

## 3. Judgment calls

1. **JC-1** sibling contracts are not my authority (see §0; mirrors suite-notes JC-1).
2. **JC-2 → JC-3** the provisional adoption of the b59fa92f contract + suite (§0, the
   DECISION_REQUEST). This row's single biggest call; everything downstream is pinned to it.
3. **The dispatch hook lives in `runWorkflow`, not a new entry point.** One seam, and the
   lane/recipe/CLI surfaces (`workflow-lane.mjs`, `recipes.mjs`, `waves.run`) get the campaign
   for free without touching any file outside my partition.
4. **`driveLane` is reused verbatim per phase** with a spec-like `{steering: phase.steering}`
   and a FRESH steering state per phase — per-phase steering policy isolation (a member of
   phase b re-triggers messageOnSpawn etc. against its own wave).
5. **Base-commit per phase** — the same clean-base law as the single-wave lane (`baton
   workflow base <campaignKey>:<phaseName>`), so each phase's wave provisions from a clean
   tree carrying the prior phase's materialized harvest.
6. **`basis` mirrors the single-wave receipt**: `'completed'` on CAMPAIGN-OK, else the
   manifestDigest. The campaign receipt carries the contract's key set (basis, kind,
   manifestDigest, outcomes, phases, steering, verdict).
7. **A failed phase stops the drive** (`break`, verdict CAMPAIGN-INCOMPLETE) — later phases
   gate on outcomes a failed phase may not have produced; continuing would violate the
   fail-closed law.
8. **Coupling is a carried declaration**: shared/tight attach `phase_coupling` events naming
   #158/#102 as preconditions. Real shared-write/cell enforcement is future machinery; the
   declaration is receipted, never dropped, never silently degraded.

## 4. Verification (suite counts, pasted)

Acceptance instrument: the phase-grammar suite run against MY interpreter via a /tmp harness
(`/tmp/pgverify`: a symlink farm — MY `workflow-interpreter.mjs` + MY untouched
application/adapter/index + the b59fa92f worktree's `workflow-dsl.mjs` (not my partition —
absent in my tree) + its suite file verbatim; run from /tmp, never written into my tree).

- `node --test workflow-phases-red.test.mjs` (run 1): **tests 13, pass 13, fail 0** —
  PG-PIN-A, PG-PIN-B, PG-P1, PG-P2, PG-P3a, PG-P3b, **PG-P3c (two-phase end-to-end)**,
  **PG-P3d (fail-closed skip)**, **PG-P4 (checkpoint park)**, **PG-P5 (amendment reuse)**,
  **PG-P6 (round-trip)**, PG-P7, PG-P8. Every interpreter/driver stage green BY MY HAND
  (only the interpreter in the harness is mine).
- Run 2 (stability, suite law): **tests 13, pass 13, fail 0** — identical green set.
- Existing suites on my modified interpreter (the stay-green acceptance):
  - `workflow-dsl-red` + `workflow-dsl-package-red` + `workflow-policy` (in-combination run):
    every row green — P1-P13, R1-R10, S1-S6, OQ6, WP80-1/2, PIN-A/B/C/D/E (41 rows, all ✔).
  - `phase79-workflow-composition-red`: **7/7 pass**. `phase79-workflow-definition-authority-red`
    + `phase80-workflow-revision` + `phase85-workflow-activity-replay-red`: **5/5 pass**.
  - `workflow-as-data-red` + `workflow-surface-red` (run together, 116 tests): **109 pass /
    7 fail** — see §5: all 7 are red-at-HEAD by suite design or proven pre-existing; ZERO are
    attributable to my change (proof below).

## 5. Anything not green / residual (the honest failing-test-law record)

The 7 reds in the combined `workflow-as-data-red` + `workflow-surface-red` run, each dispositioned:

| Test | Modified run | Pristine-HEAD run | Disposition |
|---|---|---|---|
| W3-checkpoint | ✖ | ✖ (identical) | red-first `policy-missing` row (suite header: "every red row fails today at a NAMED stage … and goes green on the contract's implementation ONLY") — the #114 v1.2 nudge/claim gap, open at HEAD |
| W3-elevate | ✖ | ✖ (identical) | same — the #114 elevateWhenNotes gap |
| W3-elevate-bounds | ✖ | ✔ in the baseline run | flaky sibling of W3-elevate (same unimplemented policy; passes when the note lands inside the drive window) |
| W3-signal | ✖ | ✖ (identical) | same — the #114 signalOnMembersDone gap |
| FP-08 / FP-14-tools / FP-15 | ✖ | ✖ (identical, pristine-HEAD farm) | `workflow-surface-red` rows; that suite does not import workflow-interpreter.mjs at all — unreachable from my change |

Proof of non-attribution, two independent ways:

1. **Pristine-HEAD baseline**: `/tmp/pgbase` — a symlink farm of the ENTIRE impl/src + scripts
   with `workflow-interpreter.mjs` replaced by the byte-verified `git show HEAD:` copy. The 7
   rows re-run there fail identically (W3-elevate-bounds passes there — it is the one
   nondeterministic row; it passed in my earlier modified-tree run of the same subset and failed
   in the big combined run, both directions observed).
2. **The diff is 345 insertions, 0 deletions** (`git diff --stat`): not one existing line of
   the single-wave path (driveLane, handleCheckpoint, tryElevate, the signal lane, harvestOne)
   was modified — the campaign lane is pure addition plus the 6-line pre-admission dispatch.

Failing-test-law actions taken (CLAUDE.md): fix-path not applicable — the W3 rows are
red-FIRST rows whose implementations (per the #114 v1.2 contract) have not landed at HEAD;
that work is the #114 contract's own rung, not this row's phase-grammar dispatch, and "fixing"
it would mean implementing a different contract's steering features inside this row's
partition. The gh flaky check/file path is UNAVAILABLE in this worktree (`gh auth status`:
not logged into any GitHub host) — recorded here rather than silently skipped. Coordinator
action requested: track W3-checkpoint / W3-elevate(+bounds) / W3-signal as the open #114
policy gap (my provisional-contract DECISION_REQUEST in §0 is the other open item).

## 6. Deployment verification

Execution contract honored: executable `true`, argv `[]`, cwd `.`, expected exit 0 — run
below before claiming completion (result pasted in the final report).
