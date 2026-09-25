# Suite fold: blue-team blockers → claim-preflight red suite (2026-08-04)

Authority: `suite-blueteam.md` (same directory — NOT-READY, 2 blockers). Edit target:
`impl/test/claim-preflight-red.test.mjs`. Contract `claim-preflight-contract.md` v1.1:
**not edited** — both blockers are suite-only coverage gaps; CP3 already enumerates all six
counted classes (`content.message` CP3.4; `question.answered`/`approval.resolved`/
`decision.settled` CP3.6), so no contract text was demanded. Tree unchanged:
`impl/src/coordinator.mjs` md5 `8e42ead5d5dc565bcbf84398a6ceceaa` (NUL-containing files
inspected via `grep -an`/`sed -n` only). Run from repo root:
`node --test impl/test/claim-preflight-red.test.mjs`, node v25.8.0.

## Before/after splits

| | Rows | Red (fail) | Pins (pass) | Runs |
|---|---|---|---|---|
| Before (blue-team measured, this tree) | 26 | 16 | 10 | four identical |
| After (this fold) | 30 | 19 | 11 | three identical |

Before red: T18, T18e, T18w, T18r, T18p, T18q, T18h, T18g, T18c, T18f, T18i, CP9a, CP9b,
WD2, WD3, WD4. Before pins: T18b, T18d, T18s, T18x, T18y, T18z, WD1, X1, X2, X3.
After red = before red **+ T18m, T18a, T18v**; after pins = before pins **+ T18n**.
Every previously-red row stays red at the SAME named stage (verified in the after-run
output): 8 legacy rows + the 3 new rows fail `stage[claim-preflight-missing]` on the
returned `{ok:true, result:'claimed', outcome:'failed'}` gate-kill envelope; T18h
`stage[cycle-ordering]`; T18g `stage[expiryPending-re-check]`; T18c the typed-throw lane
(`actual: 'claimed'` vs `__thrown__:capture_failed`); CP9a/CP9b `stage[registry-flag-lie]`;
WD2/WD3 `wave_driver_policy_invalid` ("refusalNudgeBudget" unknown); WD4 `1 !== 4`
per-pauseId claim attempts. All ten legacy pins stay green; no red row was weakened.

## Blocker → change map

### BLOCKER 1 — `content.message` (CP3.4) planted in T18 but never load-bearing

Blue-team finding: T18 plants 3 analysis messages beside 5 tool_calls; the tool_calls alone
suffice for the refusal, so an implementation omitting worker `content.message` from the
closed counted set greened all 26 rows while violating CP3.

Fold (two rows, the T18w/T18r staging idiom):

- **T18m (RED)** — "worker analysis content.message counts as liveness — the messages-only
  pause refuses". A diffless drivered pause whose ONLY counted liveness is 3 `emitAnalysis`
  events (`content.message`, actor worker): zero tool_calls, zero hub receipts, zero
  provider calls, zero resolutions. Fixture checks (pass today, precede the red assert):
  exactly 3 worker `content.message` events in-window, and a new
  `assertNoOtherCountedLiveness` helper proving no other CP3 class is present (this is the
  property whose absence made BLOCKER 1 possible). Then `assertRefusalBasics` — fails today
  at `stage[claim-preflight-missing]` on the gate-kill envelope. Teeth: an implementation
  omitting CP3.4 gate-kills this row → red; the planted PROSE_CANARY re-pins TG4's
  no-worker-prose law on this class too.
- **T18n (PIN, green)** — "the SAME pause with the content.message events REMOVED dies by
  the full gate". T18m's fixture minus the 3 messages = zero staged liveness; asserts the
  full `assertGateKill` shape (`required_effect_absent`, task failed, kill observed,
  terminalCause kind+code). Staging is byte-identical to T18b's silent fixture and the row
  says so in its comment — it is kept as the named other half of the content.message pair:
  an implementation that refuses a diffless pause WITHOUT reading its liveness greens T18m
  and dies here. Together T18m/T18n make CP3.4 membership load-bearing in both directions,
  mirroring how T18d/T18s partition CP4's two bounds. T18b remains the independent #64
  control, unmoved.

### BLOCKER 2 — `approval.resolved` (:9480) and `decision.settled` (:9607) uncovered

Blue-team finding: CP3.6 lists three resolution mints; only `question.answered` is staged
(T18q/T18z). An implementation counting questions but not approvals/decisions greens the
suite. Named fix idiom: "two sibling rows (emit approval → `approve()`; emit decision →
`decide()`; each resolved in-window → refused)".

Fold (two sibling rows on the T18q idiom, per-class teeth):

- **T18a (RED)** — `approval.resolved` as the pause's SOLE liveness. New
  `emitApprovalRequest` helper emits `approval.requested` (actor worker, non-blocking,
  realistic `toolName`/`input` payload per claude-session.mjs:1297); the stage resolves it
  via `coordinator.respond(requestId, { decision: 'allow' })` — the respond() approval
  branch (coordinator.mjs:9452-9454, `adapter.approve`) mints `approval.resolved` at :9480
  with the asking epoch, seq below the pause's mintedEvent. Fixture checks: the minted
  event carries `payload.decision === 'allow'`; `assertNoOtherCountedLiveness` keeps it
  sole. Fails today at `stage[claim-preflight-missing]`. Actor note: the mint is actor
  `orchestrator`, so the row inherits T18q/T18z's actor-blindness pin for resolution
  counting.
- **T18v (RED)** — `decision.settled` as the pause's SOLE liveness. New
  `emitDecisionRequest` helper emits `decision.requested` with a closed-shape
  `createDecisionRequest`-valid request (messages.mjs:223: question, 2 options,
  `allowFreeResponse: false`, `deadlineMs: 60000`); v1 decisions are always blocking (F6,
  admission at coordinator.mjs:12317 parks the task `input_required`). The stage resolves
  via `coordinator.respond(requestId, { optionId: 'opt-a' })` → `_resolveDecisionRecord`
  (:9526) → `adapter.answer` ack → mints `decision.settled {disposition:'delivered'}` at
  :9607 and returns the task to `working`, all inside the asking epoch; the turn then ends
  and the pause pends normally (verified in-run). Fixture checks: the minted event carries
  `payload.disposition === 'delivered'`; `assertNoOtherCountedLiveness` keeps it sole.
  Fails today at `stage[claim-preflight-missing]`.

Two sibling rows rather than one parametrized row so each mint has its own teeth: an
implementation counting approvals but not decisions fails T18v only, and vice versa.

## Non-goals honored

- No red row weakened; all ten legacy pins green for their adjudicated reasons (the
  blue team's SOUND/WEAK verdicts stand — T18x's ok:false-only limitation accepted for v1,
  not widened).
- Non-blocking strengthenings deliberately NOT folded (left to the wave, per the report):
  the 31b5 surface row (A3), `expiryPending` on the throw path (A5), `refusalNudgeBudget: 0`
  validation (§1 CP8), the T18x ok:true board-receipt row (A2, scheduled with the CP7/OQ1
  grounding pass), the `capability_op` exclusion pin (§1 CP7 note), the D9 "tolerated"
  clause tightening (A1).
- No new invented surfaces: the four rows consume only the existing CP3 closed set and the
  CP6 refusal shape; the suite header's INVENTED SURFACES section is unchanged. Header
  updated instead: fold reference, thirty-row inventory (T18m/T18n/T18a/T18v entries), and
  the Verification block (19 fail / 11 pass of 30, three identical runs).

## Residual coverage after the fold

All six CP3 counted classes now have per-class membership teeth: CP3.1 T18w, CP3.2 T18r,
CP3.3 T18 (+T18e/f/i composition), CP3.4 T18m (+T18n), CP3.5 T18p, CP3.6 T18q/T18a/T18v
(+T18z pending pin). An implementation silently narrowing the closed set now fails at
least one row. Remaining known gaps are exactly the blue team's non-blocking list (§6),
unchanged.
