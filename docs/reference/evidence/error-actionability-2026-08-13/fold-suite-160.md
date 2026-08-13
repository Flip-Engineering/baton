# FOLD-SUITE-160 — finding → resolution map (#160 error-actionability-red, suite folded per blue-team)

`[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf160]`

- **Date:** 2026-08-13
- **Suite folded (in place):** `impl/test/error-actionability-red.test.mjs` — 22 tests. The
  suite's own sacred attempt header `[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512
  row-suite-160]` is untouched.
- **Authority (contract):** `docs/reference/evidence/error-actionability-2026-08-13/contract-fold.md`
  v1.1 §4 RED-FIRST ACCEPTANCE PINS — untouched this fold (the fold edits the SUITE only).
- **Binding inputs (read fully):** `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-160.md`
  (verdict NEEDS-FOLD; its fold-instruction set = the work list) and
  `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-qa.md` §#160 (QA **UPHOLD**; no missed
  attacks). Shared frame: `docs/reference/evidence/fold-2026-08-13-c/foundry-brief.md` (read first).
- **Verification HEAD:** `e371f70` (this worktree). Every seam touched was re-verified at this
  HEAD this session (`grep -an`/`sed -n` on `application.mjs`/`coordination-store.mjs`; plain
  grep/read elsewhere). No clocks introduced; `localeCompare` unused; sorted-key literals in
  ACTUAL order.
- **Fold method:** every blue-team finding is FOLDED (suite changed — new assertion cited) /
  STRUCK (evidence) / ESCALATED (why not folded). No silent drops. Every capability row still
  FAILS at HEAD at a named stage; PIN rows stay green.

---

## 1. Baseline split (measured this session at HEAD `e371f70`, before fold)

Both runs via `node --test impl/test/error-actionability-red.test.mjs` (full output to
`/tmp/sf160-baseline1.out`):

| Run | tests | pass | fail | exit |
|-----|-------|------|------|------|
| 1   | 22    | 5    | 17   | 1    |
| 2   | 22    | 5    | 17   | 1    |

RED rows (17): W1 W2 W3 W4 W5 W6 W7 W8 M1 M2 M3 M4 M5 C1 C2 C3 S2.
GREEN rows (5): X1 X2 X3 S1 S3. Matches the suite header's declared split.

## 2. Blue-team verdict → fold action (the numbered blockers, §7)

| # | Blocker | Disposition | Resolution |
|---|---------|-------------|------------|
| 1 | **M5 BROKEN** — line 488 hard-codes the `command_outcome_unknown` stateful fallthrough that the M1/M2-required repair eliminates; the row is un-greenable as written | **FOLDED** | M5 stage marker relaxed: `assert.ok(['command_outcome_unknown', 'decision_text_exceeded'].includes(mcpError(first).code), …)`. The row's true pin (the replay sink, lines 494-496 — a same-idempotencyKey retry must carry `decision_text_exceeded` + the coaching triple, never `command_outcome_unknown`) is unchanged and remains the discriminator. Verified red at HEAD on that pin after the fold. |
| 2 | **M3 SHALLOW** — a constant `field` + canned message turns it green; the offending-member (index/role) pin is unenforced | **FOLDED** | M3 now asserts the offending member's identity: `field` must include `'1'` (index of the second member) or `'designer'` (its role) — a generic `field: 'members'`, a canned `field: 'coder'` (the VALID first member), or `field: '0'` all fail. The fixture is unchanged (member[1] missing `exact` → `invalid_wave_start`). |
| 3 | **W3 SHALLOW** — a `run_act`-only remap turns it green without exactObject validation | **FOLDED** | W3 now pins the offending arg key: `assertActionableTriple(…, { code: 'application_action_invalid', field: 'inputs', … })`. A canned `error(400, 'application_action_invalid', validation)` never names `inputs` and fails. **Judgment call (see §5):** the fixture was also corrected — the original `extraField: 1` never reached the exactObject seam (see §3). |
| 4 | **Fold B3 formula insufficient for MCP coaching** — the R2 helper must construct `detail` from the cause's root coaching fields, not pass `cause?.detail` (null for every coaching throw) | **STRUCK (as a suite change) / recorded** | This finding is about contract text (contract-fold.md §D4 R2's `laneCraftedToolError(cause) = … cause?.detail ?? null …`), not the suite. The suite is already correct: M1/M2/M5 assert the full triple on the wire (`assertCoachingTriple` requires `cap`/`actual`/`unit: 'bytes'`/`gracefulPath` in `detail`), which the literal pass-through formula cannot satisfy — the blue-team's own Mut C′ proved it (pass 5, unchanged). No suite change needed; the fix belongs to the contract's D4 R2 helper formula when the repair is implemented. Recorded here for the contract fold. |

## 3. Additional suite defect found this fold (blue-team §6.2 partial, extended)

**W3 fixture tested the WRONG seam (judgment call — blue-team did not flag it).** Empirically
verified at HEAD: the original fixture `run_act` args `{ runId, actionId, inputs, extraField }`
reddened as `invalid_command` / `unknown_argument_field` — the web envelope's own unknown-arg
closure (`validateEnvelope`, `web-northbound.mjs:410-412`) rejects `extraField` BEFORE
`validateApplicationCommandArgs` runs (probe: `{"code":"invalid_command","message":
"unknown_argument_field"}`). So the row never exercised the exactObject refusal it claims to pin.
**FOLDED:** the fixture now uses `args: { runId: 'run-web-a', actionId: 'act-1' }` (missing the
required `inputs` key) — passes the envelope arg closure, reaches the `run.act` exactObject arm
(`application.mjs`), which throws `application_action_invalid` (probe at HEAD:
`{"code":"invalid_command","message":"application_command_arguments_invalid"}` — still red, now
for the right reason). The `field: 'inputs'` pin (blocker 3) names the offending missing arg key.

## 4. SOUND rows and PIN rows — no change (per blue-team §3/§4/QA)

- **SOUND (untouched):** W1 W2 W4 W5 W6 W7 W8 M1 M2 M4 C1 C2 C3 S2 — the fold adds no assertion
  to a row the blue-team verdict'd SOUND (their cheapest-wrong-impl discriminator stands).
- **PIN rows (biting, untouched):** X1 X2 X3 S1 S3 — green at HEAD by construction and verified
  green after the fold; they are the gate that keeps the code-only / secret-quoting shapes red.

## 5. Judgment calls (recorded)

1. **W3 fixture correction** — beyond the blue-team's "pin the offending key": the original
   fixture was inert against the exactObject seam. Correcting it to a missing-required-key shape
   is the only honest way to make the row pin what it claims (an exactObject refusal). Without
   it, a field pin on `extraField` would have pinned the `unknown_argument_field` seam (a W2
   duplicate), not W3's F1×web exactObject row.
2. **M3 field encoding** — pinned as `field` includes `'1'` OR `'designer'` (contract F7 says
   "index/role"; the impl may encode either), rather than an exact literal. This still defeats a
   constant/generic remap and names the actual offender without over-pinning an unlanded encoding.
3. **M5 stage marker** — adopted the blue-team's suggested relaxation verbatim; the row's true
   discriminator (replay sink) is untouched.

## 6. Post-fold measured splits (re-run TWICE, both recorded)

After the fold, at HEAD `e371f70`, via `node --test impl/test/error-actionability-red.test.mjs`
(outputs `/tmp/sf160-fold-run1.out`, `/tmp/sf160-fold-run2.out`):

| Run | tests | pass | fail | exit |
|-----|-------|------|------|------|
| 1   | 22    | 5    | 17   | 1    |
| 2   | 22    | 5    | 17   | 1    |

Also re-verified via the documented `node impl/scripts/run-suite.mjs
impl/test/error-actionability-red.test.mjs`: 22 tests — pass 5 / fail 17 (exit 1).

**RED honesty preserved:** the split is unchanged because the fold hardens assertions inside rows
that are already red, never makes a row pass at HEAD. Folded rows still fail at HEAD at a named
stage, for the RIGHT reason:

- **W3** → `W3: expected code application_action_invalid` (the named validator refusal is still
  swallowed — the fixture now reaches the exactObject seam, message `application_command_arguments_invalid`).
- **M3** → `M3: a next action or graceful path is present` (the surfacing is still code-only).
- **M5** → `M5: the replay path carries the typed coaching code` (the stage marker now passes; the
  replay sink still loses the coaching code).
- PIN rows X1 X2 X3 S1 S3 remain green.

## 7. Scope + escape-class check

- `pwd` at every write = `/Users/wahargis/Development/Experiments/baton/.baton/wt/ws-f4fd5a06aad15554e439ed043449b79c`
  (the `ws-*` worktree). No write landed in the main checkout.
- Written files (this worktree only): `impl/test/error-actionability-red.test.mjs` (folded in
  place) and `docs/reference/evidence/error-actionability-2026-08-13/fold-suite-160.md` (this map).
- The contract (`contract-fold.md`) and the blue-team artifacts are untouched.
- No authority-class ambiguity arose → no DECISION_REQUEST required.

## Deployment verification

Per the execution contract: executable `true`, args `[]`, cwd `.`, expected exit `0` — the fold
changes test assertions only; the suite's HEAD exit status is unchanged (1, all capability rows
red), which is the honest post-fold state, and the verifier (`true`) exits 0. Git status in the
worktree: `impl/test/error-actionability-red.test.mjs` (new, untracked) and this file (new,
untracked).
