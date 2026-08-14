CONTRACT-QA v1

[attempt: 0b60dbeb-913e-4a9c-a6ee-3329e8bd75f4 coordinator]

Coordinator cross-check — the lifecycle-contracts four-row foundry (package ③, wave
`lifecycle-contracts-2026-08-14-wave-a`, redrive 6). Every claim below is cited evidence
(on-disk files, `sed -n`/`grep -an` reads at HEAD `dc476d87`, git SHAs, reservation records) or
an explicitly named absence. No clocks, no fabrication. This is the SECOND pass of this QA seat:
the first pass ran when no redrive-6 row had landed; three have since landed and are cross-checked
here against their own text. Verdicts grade the redrive-6 deliverables.

## Signal status (the #175 semantics, verified against the wavefile)

`signalOnMembersDone row-lc-fs,row-lc-launch,row-lc-members,row-lc-ledger result` — the
coordinator is the remaining member. At verify time THREE of the four watched rows had landed on
disk (below); `row-lc-members` had not. Not assumed from silence — verified per the #174 law.

## On-disk verification (the #174 law — silence is not death)

Landed redrive-6 deliverables (found in sibling worktrees `../../wt/ws-*/`):

| Row | Worktree | Deliverable | State |
|---|---|---|---|
| row-lc-fs | `ws-31139952…` | `redrive6/contract-filesystem.md` (26,179 B) | LANDED |
| row-lc-launch | `ws-9dda45ec…` | `redrive6/contract-launch.md` (41,759 B) | LANDED |
| row-lc-ledger | `ws-8d81f6cb…` | `redrive6/contract-ledger.md` (29,288 B) | LANDED — first ledger contract ever |
| row-lc-members | — | `redrive6/contract-members.md` | ABSENT — row not landed |

The members row is the only silent one. All three landed contracts cite HEAD `dc476d87` (the
effective-tree snapshot this redrive was provisioned from) — i.e. the rows re-anchored forward,
rather than copying stale redrive-3/5 line numbers. That is the correct fold discipline.

## Spot-check record (citation audit — ≥3 anchors per landed contract, re-read at HEAD `dc476d87`)

### contract-filesystem.md (redrive6, attempt `0b60dbeb…row-lc-fs`)

| Anchor cited | Verified at `dc476d87` | Result |
|---|---|---|
| G1 — base block `:590-607`, commit at `:604` | `baton workflow base` commit is at `:604` | ✓ exact (re-anchored from redrive-5's `:600`) |
| G7 — out-of-scope gate `:13520-13530`, `pathScopeEvidence` `:13526` | `worker_path_scope_violation` mint at `:13525`, `pathScopeEvidence` at `:13526` | ✓ exact |
| G2 — four base commits | `055c6cca`/`cd555cad`/`a176f39a`/`04bd28fa` all exist, author `Baton` | ✓ |
| G9 — adapter cards `:751/:761/:773` | codex containment `:751`, `danger-full-access` `:761`, claude `bypassPermissions` `:773` | ✓ exact |
| G11 — #163 verdict enum `WAVE-QUIESCED`/`WAVE-OK`/`WAVE-INCOMPLETE` `:728-730` | the settle verdict ternary at `:728-730` | ✓ exact — the fs row correctly froze the NEW three-valued enum |

### contract-launch.md (redrive6 v2.0, attempt `0b60dbeb…row-lc-launch`)

| Anchor cited | Verified at `dc476d87` | Result |
|---|---|---|
| GT-L1 — `detach` `application.mjs:11695` | `const detach = request.detach !== false` at `:11695` | ✓ exact |
| GT-L5 — `OBJECTIVE_REF_MAX_BYTES` `:46` | `const OBJECTIVE_REF_MAX_BYTES = 64 * 1024` at `:46` | ✓ exact (re-anchored from `:39`) |
| GT-L6/L7b — `limits.mjs:56/57/86` | `run.objective` 4096 graceful `:56`; `wave.member.objective` 4096 `enforcedAt startWave/attachWave` `:57`; `spill.body` 1048576 `:86` | ✓ exact |
| GT-L8 — phantom surfacing `workflow-interpreter.mjs:647-672` | `phantomDetail` map + `wave.progress()` read + `terminalCause:'start'`/`error` carried into `preOutcome` and the receipt | ✓ exact — the `852700a5` fix is real, redrive-3's settlement-half gap is GREEN |
| GT-L8b — phantom-all verdict `WAVE-INCOMPLETE` `:728-729` | `verdict = … (everySettled && everyHarvested ? 'WAVE-OK' : 'WAVE-INCOMPLETE')` | ✓ exact |

The v2.0 headline is CORRECT and is the most valuable artifact of this redrive: it re-anchors
every line to `dc476d87`, and it correctly re-scopes redrive-3's `PIN-L2` to the ACCEPTANCE half
because the settlement half was repaired by `852700a5`. A pin restating "startError never reaches
either receipt" would now be shallow-greenable — and v2.0 does not restate it.

### contract-ledger.md (redrive6, attempt `0b60dbeb…row-lc-ledger`)

| Anchor cited | Verified at `dc476d87` | Result |
|---|---|---|
| G1 — store kind set closed at 96, zero `decision.*` | `grep -ao "_append('…'"` → **96** unique kinds; `_append('decision.*'` → empty | ✓ exact (both the count and the absence) |
| G3 — `REARM_KINDS` closed four `:71-76`; `RUN_TIMELINE_OPERATIONAL_KINDS` `:52-65` lacks `decision.*` | `REARM_KINDS` = approval.resolved/decision.settled/lifecycle.turn_started/question.answered; operational set has no `decision.*`/`approval.resolved`/`question.answered` | ✓ exact |
| G2 — decision round-trip `case 'decision.requested'` `:13316`, `case 'decision.settled'` `:13425` | `case 'decision.requested':` at `:13316`; `case 'decision.settled':` at `:13425` | ✓ exact |
| G4 — no no-step record (`turn_attempted`/`no_step` zero hits) | `grep -ran turn_attempted\|no_step impl/src/` → empty | ✓ exact |
| G5 — spill machinery `:13643-13676` | `mintSpill` + `spill:sha256:<digest>` idempotent mint | ✓ |

The ledger row landed a precise, fresh contract on its first successful drive. Its line-number
citations are exact at `dc476d87` (unlike the older contracts' drift), because it had no stale
anchor to carry forward — judgment call #2 is honest about this.

## Acceptance pins — shallow-greenability

All three landed contracts carry red-first pins with genuine anti-shallow controls:

- **filesystem FS-P1/FS-P5** — the dirt-survives assertion and the clean-wave `WAVE-OK` control
  (unchanged from redrive-5; still sound).
- **launch PIN-L2 (re-scoped)** — now asserts the ACCEPTANCE half carries `startError` verbatim
  AND the settlement `852700a5` repair does not regress (the pin holds BOTH halves — a shallow
  impl that fixes the acceptance while regressing settlement fails). This is the correct
  re-scoping and the strongest pin in the wave.
- **launch PIN-L13/L14 (new)** — the never-started verdict class fires only on the all-phantom
  condition; the phantom cause is single-sourced from the handle's own settle map, not a second
  `progress()` read. Both close real shallow-green paths.
- **ledger L-P2** — the no-step record must NOT re-arm the #67 watchdog (REARM_KINDS stays the
  closed four); **L-P5** — the `decision.ledged` record is digest-ref only, never bodies-inline,
  and the kind count moves exactly 96 → 97. These are the right anti-shallow controls for a
  ledger contract whose whole point is "never inline bodies".

No pin introduces a clock; fixture discipline is stated and holds (real git repos / real runs, no
store mocking).

## Refusal vocabulary — closed, typed, surface-constant

- **filesystem** — four new codes, frozen existing surfaces (now including the #163 verdict enum). ✓
- **launch** — five new codes (v1's three + `workflow_request_invalid` + the newly-declared
  `workflow_settle_failed`); the `workflow_*` family closes at SIX (D9). ✓
- **ledger** — three new codes (`no_step_turn_unrecorded`, `decision_lane_unledgered`,
  `spill_citation_dangling`), each with a sorted-key payload and coached next-action. ✓

All surface-constant, no prose refusals, no numeric-limit refusals beyond the registry lanes.

**One finding (launch §6 only):** the launch contract's publish-refusal repeats redrive-3's
"silent admission" framing ("the refusal is a SILENT admission into `worker:<id>`"). At
`dc476d87` that is one fix behind: `writeScratchpad`'s actor gate (`auth?.actor !== 'worker'` →
`scratchpad_write_invalid`, `coordination-store.mjs:14240-14242`) now typed-refuses a non-worker
publish BEFORE the scope hardcode (`:14279`). The net conclusion ("no shared write lane") still
holds, and the ledger contract's own §6 (written fresh) states it correctly — but the launch
contract's "silent admission" phrasing must be corrected at fold to "typed refusal at the actor
gate, with the worker-scope hardcode still below it." This is a wording/staleness finding, not a
contract-breaking one.

## Boundary map — the four share the wave lifecycle; do their boundaries agree?

**Agreement (verified):** the start-failure truth is one law in three mouths and they agree —
launch `PIN-L2`/`D6` and the members row's prior `D1` both require the INNER refusal code
preserved verbatim. The spill lane is now TWO-sided and coherent: launch `D4` owns
advertisement/admission; ledger `D4`/`D2` owns reconstruction and the dangling-citation guard,
and each cites the other's half correctly.

**Overlaps (fold must reconcile — named):**

1. **Acceptance-receipt key set — launch × members.** launch `D6`/`PIN-L11` pins the acceptance
   `members` as `[{role, runId, admitted, startError?}]`; the members row's prior `D6` (redrive-3)
   adds a `serialization` key to the SAME acceptance shape. The members row has not re-landed to
   reconcile against launch v2.0's `D6`. Open until the members row lands.
2. **The verdict enum — launch × members × ledger.** launch `D11` proposes a new verdict member
   `WAVE-START-FAILED` (name ceded in `OQ-L7`); the fs contract froze the three-member #163 enum;
   the ledger contract reads `wave.settled`'s error shape as its logged-invariant specimen. A new
   enum member ripples to every verdict consumer. Authority-class — escalated below.
3. **`spill-digest-citation` — launch × ledger.** NOW RECONCILED: launch advertises, ledger
   reconstructs; each names the other's boundary. No action.
4. **`wave.settled` record — launch × ledger.** launch `D2`/`PIN-L3` makes it readable; ledger
   cites its `{error:{code,message}}` shape as the logged-invariant specimen. Coherent; the two
   reads must stay one shape.

**Gaps (uncontracted seams — named):**

1. **The members contract (#199 · #200 · #204 · #218).** Absent in redrive-6. Its redrive-3 text
   is sound but stale: it predates `852700a5` (the settlement receipt now surfaces phantom
   causes) and the #163 verdict enum, so its `A1` pin's "receipt-cause-only is not green" framing
   must be re-checked against the new surfacing, and its anchors (runId digest `:3343-3351`,
   `_runIdForWaveMember` `:11937-11948`, `_dispatchPass` `:2917-2925`) must re-anchor to
   `dc476d87`.
2. **`attachWave` / re-drive.** Still named by no row (the prior QA's gap 2 persists; the members
   row touches `D2.3` but does not own the attach surface).

## Per-contract verdicts

| Row | Redrive-6 deliverable | Verdict | Named blockers / fold notes |
|---|---|---|---|
| row-lc-fs | `contract-filesystem.md` | **sound** | re-anchored correctly to `dc476d87`; no findings |
| row-lc-launch | `contract-launch.md` v2.0 | **sound** | re-anchored + correctly re-scoped `PIN-L2` around `852700a5`; one §6 wording staleness ("silent admission" → typed actor gate) |
| row-lc-ledger | `contract-ledger.md` | **sound** | first landing; 96-kind enumeration and decision-round-trip citations exact |
| row-lc-members | — (absent) | **needs-fold** | blocker: row not landed; redrive-3 text must re-anchor to `dc476d87` and reconcile its acceptance-shape `D6` against launch v2.0 `D6`/`PIN-L11` |

Three of four are sound as landed text. The wave as a whole is **needs-fold** until the members
row lands and the two open overlaps (acceptance-shape key set; verdict-enum member) are decided.

## Fold instruction set (concrete)

1. **Land the members row.** It is the only silent row and its issues (#199/#200/#204/#218) are
   the store-truth half of the start-failure law. Its `D1` record mint must preserve the inner
   code verbatim (agreement with launch `PIN-L2`), and its `A1` anti-shallow clause must be
   re-checked against the `852700a5` phantom surfacing (the settlement receipt now carries the
   cause; the store record is still required, but the "receipt-cause-only is not green" framing
   needs rewording to name the store-record requirement as the point).
2. **Correct launch §6** ("silent admission" → typed actor gate + worker-scope hardcode), matching
   the ledger contract's accurate §6.
3. **Reconcile the acceptance key set** (overlap 1) once the members row lands — one owner for
   the acceptance receipt (launch, its stated authority), members' `serialization` rides a
   launch-approved key or sub-key.
4. **Decide the verdict-enum member** (overlap 2, `D11`) — the name and slot must be agreed by
   launch, members (terminal projections), and ledger (logged-invariant) before landing.
5. **Assign `attachWave`/re-drive** (gap 2) or record it out-of-scope-for-③ in the fold.

## Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The shared-scope publish surface is gapped at
HEAD `dc476d87`:

- `writeScratchpad` (`coordination-store.mjs:14240`) refuses a non-worker actor at the gate:
  `auth?.actor !== 'worker' || auth?.principalId !== fields?.workerId` → `scratchpad_write_invalid`
  (`:14241-14242`).
- Below that gate the scope is hardcoded to the worker partition:
  `const scope = \`worker:${fields.workerId}\`` (`:14279`); no write path mints a `shared` scope.
- The shared-scope settlement path is orchestrator-actor-only (`:12594`).

Net: no `shared` write lane. A coordinator publish is typed-refused at the actor gate; a worker
publish lands in `worker:<id>`. This QA is published ON DISK (`redrive6/contract-qa.md`) and the
shared-lane refusal is recorded verbatim above; fabricating a shared-scope publish was not an
option. (This is the accurate shape the ledger contract's §6 already records; the launch
contract's §6 is one fix behind — see §Refusal vocabulary.)

## Escalation (authority-class — via DECISION_REQUEST, options)

1. **DR-QA1 — the members row's non-landing.** Three of four landed; the members row is silent.
   Options: (a) re-drive `row-lc-members` alone (fresh worktree, same brief) and re-signal;
   (b) fold on the members row's redrive-3 text with a re-anchor amendment carried by the fold;
   (c) hold-recheck. Recommended: (a) if the seat is available, else (b) with an explicit
   re-anchor note — (b) ships a contract that predates `852700a5` and #163, which is exactly the
   shallow-greenable staleness the other three rows just corrected.
2. **DR-QA2 — acceptance-receipt shape authority (overlap 1).** Options: (a) launch owns,
   members' `serialization` rides a sub-key; (b) members owns the key set; (c) joint fold
   amendment. Recommended: (a).
3. **DR-QA3 — the never-started verdict member (overlap 2).** launch `D11`/`OQ-L7` cedes naming
   to the fold. Options: (a) `WAVE-START-FAILED`; (b) no new enum member, refuse at admission only
   (launch `D11` option b); (c) a `startFailed: true` marker. Recommended: (a) — the settle leg is
   reachable via `detach:false` on a partial-failed admission, so the record must not mislabel.

## Residual register

1. **Members row silent.** Three landed, one absent — recorded, not fabricated.
2. **Launch §6 staleness** (the one finding on a landed contract) — wording-level, fold-correctable.
3. **Ledger contracted for the first time** — the wave's four-contract package is now three landed
   + one pending; gap 1 of the prior QA pass is closed on the ledger side.
4. **Shared-publish gap** — typed actor gate + worker-scope hardcode, live at `dc476d87`.
