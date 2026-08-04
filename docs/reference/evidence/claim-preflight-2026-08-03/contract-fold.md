# Contract fold summary — claim-preflight contract v1.0 → v1.1 (2026-08-04)

Fold of `contract-redteam.md` (verdict: **NOT FOLD-READY — 4 blockers**) into
`claim-preflight-contract.md`, both same directory. Result: **all 4 blockers folded, 0
rejected, 0 deferred-as-blockers** (the red team's own deferrals — open questions 1–3 — stay
deferred on its recommendation, two now scheduled/named). Edit targets: the contract only,
plus this summary. The fold was performed against the CURRENT tree — it moved after the red
team ran: the #81 orientation epic landed, `impl/src/coordinator.mjs` went from md5
85a05b87aad73c24d080545a9a2dd3fc / 13501 lines to md5 8e42ead5d5dc565bcbf84398a6ceceaa /
**13844 lines**, and every coordinator anchor below `claimTurn` drifted. NUL-byte discipline
observed throughout (`grep -an` + `sed -n` only on coordinator.mjs/application.mjs).

## Blocker → change map

### Blocker 1 — CP8 termination hole (the headline): FOLDED, CP8 rewritten

Red-team finding: refuse→nudge→re-park unbounded in counts; each new pauseId resets the wave
stall clock (`stallMarker` hashes attention requestIds → `lastMarkerAt` resets every cycle);
the 3h `hardCapMs` wall the only terminator; "bounded by counts, no timers", "closes exactly
as today" (CP8) and "Farm bound: unchanged" (CP10) false as written.

Changes in the contract:

- **CP8 rewritten** (`### CP8`, retitled "…a COUNTED corrective-nudge budget"). Three counted
  changes: per-pauseId `claimAttempted`; exactly one corrective nudge per refusal drawn from a
  **per-member count budget `refusalNudgeBudget: 2`**; and the named exhaustion closure.
- **The number 2, with the #64-cadence rationale:** the largest legitimate per-member claim
  cadence observed in the acceptance suite is 2 (phase11-persistent-sessions:372/:379 claims
  two successive checkpoints of one native session — re-verified this fold; the #64 survivor
  needed only one steering answer before producing its diff). Two corrective nudges cover
  every observed legitimate cadence with one to spare; a third diffless corrective cycle
  exceeds every cadence on record → treated as permanently diffless.
- **Consumed on DELIVERY, never attempt** (D8 symmetry, wave-driver.mjs:618-640): a refused
  nudge delivery arrives as a value and consumes nothing; K=3 (:598) bounds persistent
  failure.
- **Honest closure story, no new clock:** budget exhausted → refusal recorded on claims
  evidence (:262) with NO nudge → pause pends → no new pauseId minted (`pause:${task.id}:${seq}`,
  :2059, never re-enters the outline) → stall marker (`stallMarker` :151-157 → `markerParts`
  :493) stabilizes → `lastMarkerAt` (:521) stops resetting → the PRE-EXISTING stall clock
  fires (:656) → D9 fan-out (:658-664) no-ops/tolerates → basis `'stall'` → guaranteed close
  reaps (:713-714). The stall clock is the driver layer's own terminator (K=3 already defers
  to it, :595-598) — the contract introduces no clock.
- **Honest text:** CP8 states the termination hole explicitly (done branch :585-593, treadmill
  :605-608, hardCap :689) and supersedes "closes exactly as today" with the true statement:
  for a permanently diffless worker that stays alive, the terminal judgment MOVES from the
  gate to the driver's stall/cap reap. **CP10's "Farm bound: unchanged" replaced** — unchanged
  for the silent worker (full gate at first claim, byte-for-byte), changed BY DESIGN for the
  liveness-rich worker (capped corrective budget + pre-existing stall/cap reap), with TG2's
  final-diff law as the unmoved anti-gaming bound. Campaign-law "No clocks" bullet amended to
  name the pre-existing stall clock. Termination-pinning rows added as acceptance pin (e).

### Blocker 2 — preflight error path wedges `resolving` forever: FOLDED, CP1 + T18c

- **CP1 gains "Error path — rollback-on-throw, `resolving` always released":** the whole
  preflight (worktreeReady await, fresh capture, liveness scan) is wrapped in try/catch
  mirroring the gate dispatch's :2519-2522. On ANY throw (worktreeReady rejection; capture
  throw — `capture_failed` verified live at :8131): `rollback()` + rethrow. Pre-claim state
  restored exactly: `pending`, `consumer: null`, `resolution: null`, `resolvingDone` released
  (`finishResolving()` in the rollback arrow :2325-2330; racing claims parked at :2309
  re-enter); armed cycle stays armed; zero events. The zombie-wedge mechanics are named
  (:2309 hang, :2237-2238 expiry-guard skip).
- **Typed code the driver can read:** the rethrown error keeps its `code`; the application
  error lane forwards it (application.mjs:11897-11899); `claimOnce`'s catch records
  `code: error?.code ?? null` on claims evidence (wave-driver.mjs:262). No new plumbing.
- **CP6** states a preflight throw is not a refusal (no `claim_premature_liveness` minted).
- **Acceptance (d) gains row T18c:** capture stub throws `capture_failed` → claim rejects
  with the typed code, record `pending`/`consumer: null`/`resolvingDone` released, cycle
  armed, second claim proceeds.
- Non-blocking residue folded with it: the swallowed-expiry `expiryPending` re-check (guard
  sets the flag at :2237-2238; the refuse path runs the expiry synchronously after rollback —
  one flag, one call, no clock), in CP1 and referenced in CP6.

### Blocker 3 — acceptance coverage gaps: FOLDED, five row additions

- **CP4 stale-epoch pin → new row T18d** in (b): epoch-1 liveness, epoch-2 diffless pause with
  zero epoch-2 events → claim → preflight does NOT engage → full gate →
  `required_effect_absent` kill. A whole-stream reader greens everything else — T18d is the
  anti-stale law's only pin. CP4 also gains the harness-envelope honesty sentence (turnEpoch
  rides the wire envelope, not worker text).
- **Wave-driver rows → new pin (e):** (i) refusal code recorded on claims evidence; (ii)
  exactly one corrective nudge per requestId, delivery-failure consumes no budget; (iii) the
  NEXT pauseId is claimed again (per-pauseId `claimAttempted`); (iv) budget exhaustion →
  record-only → marker stabilizes → pre-existing stall clock → basis `'stall'` → close reaps.
  A CP8 no-op no longer greens the acceptance section.
- **Preflight-throw row → T18c** in (d) (see blocker 2).
- **T18's capture stub fixed** in (a): the argument-ignoring `capture: (...a) => current(...a)`
  is named NOT sufficient; the stub wraps a spy asserting the gate-identical kwargs
  (:12490-12498), the `baseSha` derivation (:12531), and the in-scope filter (:12511).
- Bonus shallow-scan closures from the report folded: the `!sha || !baseSha` null-capture edge
  (new row T18e — would-fire TRUE, refusal, never a silent pass) and the ok:false-receipt
  exclusion (T18 plants a failed write_result; refused on tool_calls alone; CP3's text now
  states failed receipts never count).

### Blocker 4 — citations: FOLDED, 5 defects fixed + full re-base

All five named defects corrected, re-verified line-by-line against the CURRENT tree (which
moved again after the report — post-#81 — so the defect fixes landed on re-based numbers):

| # | Defect | Fix landed at |
|---|--------|---------------|
| 1 | application-semantics flag :517, entry :511-519 | flag **:516**, entry **:511-518** (GT6, CP9) — verified :516 is the flag line, :517 is helpTopic |
| 2 | governance count :12925 | **:13267** (case :13249-13269; :13268 is `break;`) — the report's :12924 was itself pre-drift |
| 3 | recipes overrides :557 | **:558** (:557 is `}],`) |
| 4 | `_reservePauseRecord` :2304-2330, rollback :2324-2328 | **:2305-2337**, rollback arrow **:2325-2330** (assignments :2326-2328, `finishResolving()` :2329) — GT1, CP1, CP6, (d) |
| 5 | CP8 budget anchor :583-585 | **:599** (`unchanged`) / **:605** (budget comparison) — the report's :583/:589 was pre-drift |

Beyond the five: the post-#81 drift (13501 → 13844 lines) invalidated every coordinator.mjs
anchor below `claimTurn`, so the fold re-based ALL of them — 45 further corrections (gate
machinery :12530-12546/:12845-12858, watchdog :8845/:8852-8855/:8856-8878, governance
:13249-13269, prose :11541-11543, no_progress :8105-8141, receipts :12109-12112/:12115-12117/
:12124/:12126-12129/:12146-12156, interactions :9475/:9480/:9607/:9514/:9644, wave-driver
:343/:344/:594/:599-614, plus two tightenings the report exact-listed: `_settleSteeringCycle`
:2218-2231, steering-less guard :2204) and the header md5/line-count. claimTurn :2492-2529 and
every interior anchor, the reservation family, the epoch fields :2060-2062/:2066, the steering
machinery :2111-2246, application.mjs (:9761/:9803/:11892-11899/:9621/:8126/:3127),
application-semantics.mjs, recipes.mjs, and ALL test-file anchors were re-verified UNCHANGED.

**Citation count for this fold: 56 corrections (11 values across the 5 named defects + 45
drift re-bases/tightenings) and 34 citations NEW to the contract** (CP1 error path: :8131,
:2237-2238, :2309, :11897-11899, :262; CP2 fidelity: :12490-12498, :12531, :12511; CP8: :343,
:344, :594, :598, :618-640, :2059, :151-157, :493, :521, :656, :658-664, :713-714, :605-608,
:585-593, :689, :595-598, phase11:372/:379; CP9: :1089, phase87:61; acceptance: the five
non-suite call-site anchors, :2308-2317, phase11:24-29). ~90 distinct anchors re-verified.

## Non-blocking amendments folded

- CP3's admission criterion now honestly names the third class — "watchdog-observed worker
  content events" — covering `content.message` (kept, not dropped).
- Swallowed-expiry `expiryPending` re-check (CP1).
- Registry version-bump policy NAMED and deferred (CP9: `version` stays '1.3.0', :1089,
  phase87:61 pins it; digest moves without version movement — the gap is named).
- CP4 harness-envelope honesty stated once.
- The six-suite claimTurn audit folded into acceptance (c) as an enumerated blast-radius list.
- Open question 1's grounding pass scheduled as a named acceptance follow-up (CP7/OQ1).
- Open question 4 DECIDED at fold: the live receipt lands in this directory; T18's
  mock-provider row is the real pin, the glm seat corroborates.

## Exoneration re-check (fold requirement 5)

The report's §3 audit claims the six claimTurn call sites outside the trust-gate suite survive
byte-identical. Two independently re-checked against the current tree:

1. **turn-checkpoints-31b-red:205** (expects `already_resolved`) — CONFIRMED. Test A1b
  (:201-209): `nudgeTurn` resolves the record first (:204), then `claimTurn` (:205) asserts
  `claimed.ok === false` / `claimed.result === 'already_resolved'` (:206-207). The refusal
  comes from `_reservePauseRecord`'s state guard (:2308-2317, `state !== 'pending' →
  already_resolved`) — BEFORE the preflight's insertion point (after reservation, before the
  timer clear). The preflight is never reached; the row is byte-identical under the contract.
2. **phase11-persistent-sessions:372/379** (brief omits `requiredEffects`) — CONFIRMED.
  `brief()` (:24-29) carries `goal/constraints/pathScope/definitionOfDone/verification/
  budget` — NO `requiredEffects`, NO `analysis` (grep: zero matches in the file). The
  would-fire test (`brief?.requiredEffects?.includes('repository_edit')`, mirror of :12530) is
  false → preflight never engages → both claims run the full gate exactly as today (the test
  expects two `verify.reverified` landings). Byte-identical.

The other four (31a:699, 31b5:247, phase10:112, bidirectional:369) were location-verified this
fold (all six call sites sit at the report's cited lines) but not re-read in depth; the report's
per-site reasoning stands. **Confirmation: the byte-identical exoneration SURVIVES the fold.**

## Deferred / rejected

- Deferred (on the red team's own recommendation, non-blocking): OQ1 receipt-class widening
  (grounding pass now scheduled at acceptance), OQ2 `irreversible` (with the registry
  version-bump policy), OQ3 capture-cost short-circuit (safe-direction only, reverse banned).
- Rejected: nothing. No blocker and no non-blocking amendment was rejected.

## Files touched

- `docs/reference/evidence/claim-preflight-2026-08-03/claim-preflight-contract.md` — v1.0 → v1.1.
- `docs/reference/evidence/claim-preflight-2026-08-03/contract-fold.md` — this summary.
