# #80 FOLD — red-team blockers → contract v1.1 changes

**Fold target:** `tg3-window-contract.md` v1.0 DRAFT → **v1.1** (same dir)
**Fold input:** `contract-redteam.md` §9 (3 numbered blockers: B1, B2, B3) + §7 open-question
verdicts + §1 HEAD-note (stale pin correction) + §4 implementer note (OQ-3 fold identity)
**Fold HEAD:** `2d9de15390bdfe8fc650a4199e45dd74629acfba` (current worktree HEAD)
**Verdict:** **FOLD-READY** — all 3 blockers folded; OQ-1/OQ-3 resolved, OQ-2 explicitly deferred.

Every anchor the fold touches was re-verified at the fold HEAD by `grep -an`/`sed -n` on the tree;
the NUL-bearing files (`application.mjs`, `coordination-store.mjs` — 3 NUL bytes each) by
grep/sed only (`coordinator.mjs`, `codex-appserver.mjs`, `claude-session.mjs`,
`cli-adapters.mjs` have 0 NUL bytes and were read whole). The #114 fence fix shifted five
`coordinator.mjs` anchors after `:10556` by **+3** between the red-team's attack-time pin and the
fold HEAD; each is re-verified at its new position (`:12053`, `:12454`, `:12816-12817`,
`:12827`, `:13206`).

---

## Blocker map (what → why → fix → where it landed)

### B1 — The expiry must re-check the evidence fold at fire time and settle constructively on observed start evidence
- **What:** `_expireSteeringCycle` runs the full final gate on any timer fire (guard only
  `task.status !== 'paused'`, `:2290`), never consulting whether start evidence was observed
  during the window. TW-05 (v1.0) staged a D2-gate defect — a valid `provider_call` observed
  in-window yet the cycle still expires — and kept the kill ("exposing the defect to a
  post-mortem").
- **Why:** a D2 consume-path defect then kills a healthy worker whose start evidence exists — the
  exact #55-class incident #80 exists to prevent, reproduced by the contract's own staged test.
  The v1.0 claim "the expiry now fires only when no start evidence exists" was false at fire
  time, and the control-law line (G10) was violated in the defect case.
- **Fix:** at expiry, before running the final: if `record.steering.observedEvidence` contains a
  start-class identity (`turn_started`, or a valid-phase `provider_call` per
  `_observeLogicalProviderCall` :9067-9097), settle constructively — `task → working`,
  `turn.settled {basis: 'steering_answered', via: 'evidence_gate_defect'}`, zero gate events —
  and receipt a named `steering.evidence_gate_defect` error event carrying the fold. Run the
  final only when the fold is empty of start-class evidence (the genuine honest stall). Fold
  records start-class kinds after phase/callId validity. TW-05 rewritten to assert the
  constructive settle + defect receipt.
- **Landed:** D3 (new "fire-time evidence re-check" paragraph), §3; the `steering.evidence_gate_defect`
  vocabulary row, §4; TW-05 (rewritten RED pin), §5; the control-law tightening in §6; OQ-3
  fold-identity note, §7; the residual-live note, §8.

### B2 — The `requested` class must be named and pinned honestly (dispatch receipt, not "queue ack"), its self-answering precondition made contract text, and its deferral quantified
- **What:** v1.0 D2 minted `resource.provider_call {phase:'requested'}` at turn-start dispatch —
  **before** the provider accepts — and named it "the provider queue ack" / "the honest START
  evidence." The class does not distinguish "dispatched at the provider" from "accepted into the
  provider queue"; a dead/hung provider after dispatch yields the receipt anyway, deflecting the
  honest stall to the wall budget.
- **Why:** (a) the overstatement is a post-mortem hazard — a fold recording `requested` is not
  evidence the provider engaged; (b) the anti-gaming guard is valid only because mode-`'turn'`
  dispatch is a gated steering/orchestrator admission (verified: arm sends `'nudge'` only
  `:2179`; `nudgeTurn` clears the steering timer first `:2433`; `_deliver`/`_deliverFollowUp`
  carry gates `:7268-7306`) — an unstated precondition; (c) the deferral bound is unquantified
  and is a #67-contract value (480-min wall budget) not the shipped backstop (HEAD watchdog
  default 2-min `stallMs`, `:1057-1058`).
- **Fix:** (1) rename the class in D2, the vocabulary table, and TW-02 to "the turn-start
  **dispatch receipt**"; (2) pin the emission point — codex at `_sendRequest('turn/start')`
  before the await (`codex-appserver.mjs:997`), claude pipe none (atomic,
  `claude-session.mjs:884-894`), cli-adapters at its exec/turn dispatch (`cli-adapters.mjs:120,
  155`); (3) add contract text that the `requested`-minting dispatch is a gated
  steering/orchestrator admission, never an automatic arm-time consequence; (4) quantify the
  dispatch-without-acceptance deferral and mark it depending-on-#67; (5) the fold must record the
  provider_call **phase** (`requested` vs `completed`).
- **Landed:** D2 (rewritten with honest naming, pinned mint point, zombie-answer
  discrimination, quantified deferral, contract-text self-answering precondition), §3; the
  `requested` vocabulary row (renamed + pinned), §4; TW-02 (rewritten RED pin), §5; the
  depending-on-#67 posture in §6; OQ-1 resolution, §7.

### B3 — The unshipped-work dependence must be marked on every load-bearing row, not only in G7
- **What:** the subsumption analysis and several pins depend on #67 v1.1 contract text
  (`REARM_KINDS`, the 480-min wall budget, the in-flight-turn gate) — none of which exists at
  HEAD (`turnInFlight` = 0 hits; `REARM_KINDS` = 0 hits). G7 declared the analysis is against
  the contract, but the consequences were not stamped: TW-09 bundled the #67 REARM_KINDS
  assertion into a GREEN pin with the shipped half; D2's "the wall budget's backstop (G7)" and
  §2's "watchdog half closed" read as operative at HEAD.
- **Why:** a GREEN pin that asserts contract text (REARM_KINDS byte-unchanged) is untestable at
  HEAD and would mislead the implementing team into skipping it; the "watchdog half closed"
  summary is only true once #67 ships.
- **Fix:** split TW-09 into (a) the shipped half — `_armWatchdog` working-only `:8733`,
  `_observeWatchdogEvent` provider-call tracking `:9151` — GREEN at HEAD, and (b) a
  depending-on-#67 row — the REARM_KINDS non-change asserted against #67 contract text, verified
  when #67 folds. Stamp D2's wall-budget backstop and §2's watchdog-half verdict as
  depending-on-#67 rows. Correct the §8/§1 HEAD pin.
- **Landed:** §2 ("watchdog half" + "stall-seam cycle" stamped depending-on-#67); a new G13
  ground truth pinning the shipped 2-min `stallMs` watchdog default (`:1057-1058`) so the §2
  stamp reads against a named shipped half; D2's deferral quantified + stamped (§3); D4's
  REARM_KINDS row stamped (§3); TW-09 split (§5); the depending-on-#67 law in §6; the corrected
  HEAD pin + anchor re-pins, §8.

---

## Open-question verdicts (§7)

| OQ | Red-team verdict | Fold disposition | Reason |
|----|------------------|------------------|--------|
| OQ-1 codex-first emission order | SOUND — codex-first right | **RESOLVED** | Emission point pinned per B2: codex at `:997` before the await (the `turn/start` → `turn/started` gap is the observed #80 shape), cli at exec/turn dispatch, claude pipe none (atomic). TW-02 staged against a slow-start adapter. |
| OQ-2 `progress`-phase answer | SOUND — deferring is correct | **DEFERRED** | No adapter emits `progress` today; guard is phase-validity and any valid provider call is start evidence. No code decision until an adapter emits it. |
| OQ-3 `observedEvidence` fold bound | SOUND-with-note — must keep start-class identity | **RESOLVED-with-note** | CP4 shape law holds; with B1 the fold must keep the start-class KIND (and for provider_call the phase), not just a dedup count, because the expiry re-check consumes the kind. Folded into D3 and the OQ-3 row. |

---

## HEAD pin and anchor corrections

- **v1.0 pinned** `0b5df0c`; the red-team's attack-time pin was `8aa9f4c`; the fold pins the
  current worktree HEAD `2d9de15`. The deltas between these are doc-only + the #114 fence fix.
- **#114 fence fix shift:** the fence-resolution change adds **+3 lines** to `coordinator.mjs`
  after `:10556`, moving five anchors: `:12050→:12053` (turn_started observe site, G4/D2),
  `:12451→:12454` (scratchpad observe site, D2), `:12813-12814→:12816-12817` (default case,
  G5/D2), `:12824→:12827` (`_observeWatchdogEvent` feed, G5), `:13203→:13206` (`steered`
  receipt, G3/D3). Each re-verified at the fold HEAD.

---

## Campaign-law compliance (self-applied)

- **No clocks as controls:** no new bound fires on elapsed time without an evidence check — B1's
  fire-time re-check makes the expiry's "fires only when no start evidence exists" true at fire
  time for the start classes; the one-shot count-based bound is preserved; no bigger window, no
  re-arm loop, no `*Ms` knob.
- **Citations re-verified at the fold HEAD** (`grep -an`/`sed -n`; the two NUL files by grep/sed
  only); the shifted anchors re-pinned (see above).
- **Sorted-key literals ACTUAL order:** `LOGICAL_CALL_PHASES` reused, not duplicated;
  `localeCompare` banned.
- **Depending-on-#67 posture:** every row riding #67 contract text is stamped and names its
  target-state value (wall budget `DEFAULT_BUDGET.wallMin * 60_000`; `REARM_KINDS`), per the
  #114-B3/#97 precedent.
- **Deliverables:** ONLY `tg3-window-contract.md` (v1.1) + `contract-fold.md` (this file) were
  edited in this directory.
- **Deployment verification command** (Baton): executable `true`, arguments `[]`, expected exit 0.
