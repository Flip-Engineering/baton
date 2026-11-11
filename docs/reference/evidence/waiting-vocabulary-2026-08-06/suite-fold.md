# Fold — blue-team report into the issue #10 red-first suite

Date: 2026-08-06.
Fold of `suite-blueteam.md` (attempt `bt-2026-08-06T20:17:48.311Z`, verdict **NOT-READY**,
3 blockers) into `impl/test/issue10-waiting-vocabulary-red.test.mjs`.
Contract: `waiting-vocabulary-contract.md` v1.1 — **not edited** (all three blockers were
additive row/assertion fixes within the suite's existing surfaces; no contract drift was found
to correct).

All three blockers were confirmed against the tree before folding (read via `grep -an`/`sed -n`
per the NUL discipline). No blue-team claim was rejected.

---

## Blocker → change map

### Blocker 1 — `plan_approval` stale/expiry edge untested (D7, §6 PA-EXIT, §4 `plan_approval_expired`)
**Fold:** new RED row **PA-EXIT-EXPIRY** (`stage[plan-approval-expiry-missing]`), inserted
between PA-EXIT and PA-HONEST.
- Stages the exact stale window the contract pins: an approval **recorded without dispatch**
  reads `phase 'approved'` + `waitingOn: null`; once the TTL lapses, a dispatch attempt is
  refused with `plan_approval_expired` while the view truth stays `approved`/`null`.
- Staging note: the app-level `application.approve()` dispatches synchronously (task created →
  phase `running`), so the `approved`-with-no-task phase is unreachable through the public
  path. The row records the approval directly via
  `driver.coordinator.approvePlan(...)` (mirroring the exact call `application.approve` makes),
  which leaves the run at `approved` with no task binding — the contract's D7 stale window.
- Uses a **per-test** `goalPlanPolicy` (`approvalTtlMs: 250`) rather than mutating the shared
  policy — a shared low TTL would break CC-EXIT's slot-freed re-dispatch. The dispatch refusal
  rides pre-existing machinery (the `:10707` TTL check behind `previewPlanDispatch`), so the
  refusal assertion is green pre-impl AND under the correct impl; the RED discriminator is
  `view.waitingOn === null` on the stale edge, failing at the row's **own** named stage.
- Discriminates both wrong impls the report names: one that keys `waitingOn` on
  "no `plan.approval_decided`" (keeps `plan_approval` set after expiry → fails the
  `waitingOn === null` assert) and one that clears `waitingOn` but keeps the phase
  `awaiting_plan_approval` (fails the `phase === 'approved'` assert).

### Blocker 2 — CC-SHOW never asserts `since.eventSeq === <receipt seq>` (D5 Arm 1, §6 capacity_ceiling SHOW)
**Fold:** CC-SHOW now fetches the `task.dispatch_deferred` receipt from
`driver.coordination.events(1)` and asserts
`view.waitingOn.since.eventSeq === receipt.seq`, with a PIN that the receipt exists. This
mirrors DP-START/SP-SHOW/PA-START (the other three `turnEpoch null` rows already read the live
store event) and closes the exception the FALSE-GREEN hunt flagged (a fixed or invented seq no
longer passes). The kind-flip dependency the report cites (DP-EXIT-b asserts a kind change but
not a `since` jump) is now covered on the Arm-1 side.

### Blocker 3 — spawning run-view `detail.window` untested (§3 shape law)
**Fold:** SP-SHOW now asserts `view.waitingOn.detail.window === 'spawn'` plus
`detail.workerId`/`taskId`/`vendor` present on the run view, inside the same try block that
asserts `since.eventSeq`. This is the contract's "never implementer-chosen" detail — a
detail-less or wrongly-windowed projection fails all three surfaces (view / outline /
runs.list, since SP-SHOW projects through all of them). The worktree/recovery windows remain
covered at the coordinator level by SP-START-WT/RECOVERY; the report's "ideally" extension
(drive worktree/recovery through the view surfaces) is deferred — see Rejected/deferred #6.

---

## Non-blocking recommendations folded

- **DP-START `pausedTurns()` vacuity (blue-team drift 2 + rec).** The header's pin list
  claimed the #88 preflight is "vacuously safe for every kind (CC-START, DP-START, PS-START)"
  but DP-START did not assert it. Folded the assertion:
  `assert.equal(driver.coordinator.pausedTurns({ taskId: task.id }).length, 0, 'PIN: ...')`
  — the header claim is now true. (This also flips the report's drift finding #2 to fixed.)
- **D9-SHAPE extension (blue-team rec).** Extended to assert the interaction shape
  (`blocked: true, waiting: false`) and the pure working shape (`blocked: false, waiting:
  false`) carry both flags explicitly, so a blocked shape without a `waiting` field is caught
  alongside the checkpoint shape already covered.
- **Header hygiene (blue-team drift #1 + rec).** The verified-split block now states the
  exercised-stage count precisely: 14 distinct stages fire (the pre-fold drift was 14 claimed /
  13 exercised; the fold's new `plan-approval-expiry-missing` stage brings exercised to 14,
  making the inventory count true again — `waiting-on-honest-null-missing` still never fires
  because PS-HONEST fails at `reduceMember-missing` first). The five rows that fail one stage
  earlier than their named stage (CC-EXIT, DP-EXIT-a/b/c, PS-EXIT) and PS-HONEST's unreached
  named stage are called out explicitly rather than "each fails at its NAMED stage".

---

## Before / after split

| | Before (Ring-3, blue-team-verified) | After (fold) |
|---|---|---|
| tests | 38 | **39** |
| RED fail | 35 | **36** |
| PIN pass | 3 (D9-INVARIANT, EXO-1, EXO-2) | **3** (unchanged) |
| distinct stages exercised | 13 (header claimed 14 — drift) | **14** (all firing; header claim now true) |
| new stage | — | `plan-approval-expiry-missing` (PA-EXIT-EXPIRY) |

Verified from repo root, `node --test impl/test/issue10-waiting-vocabulary-red.test.mjs`:
three consecutive runs, each **36 fail / 3 pass / 0 cancelled / 0 skipped / 0 todo**
(~15.8s). PA-EXIT-EXPIRY fails at its OWN named stage (`plan-approval-expiry-missing`).
All 36 RED rows fail at stage-tagged feature assertions; none at a PIN assertion or a fixture
error. Split is exact and stable.

---

## Rejected / deferred items (with reasons)

1. **Grep-style "no new `setTimeout`/`*Ms` knob" row** (blue-team rec, D8/§7 campaign law) —
   **deferred**. The campaign law is a diff-scoped review check: a suite row can only grep the
   final tree, where it cannot distinguish the pre-existing wall-time machinery (coordinator
   watchdog `stallMs` / `_setTimeout`, `_progressTiming` block) from a newly added clock without
   a brittle scope definition. The contract itself calls the law "grep-able" — the grep belongs
   in the implementation plan's diff-scoped review checklist, not a suite row. Not gated.
2. **`lifecycle.crashed phase:'spawn'|'worktree'` → terminal → `waitingOn:null`** — **deferred**.
   Not a blue-team blocker. Staging requires an adapter that crashes at spawn plus asserting the
   terminal-run honest null, which needs a separate coordinator-harness staging path; the
   honest-null rule for terminal members is already implied by the honest-null law (D4) and the
   EXIT rows assert null after the covered exits. Deferred to the implementation plan.
3. **Terminal-`stallAction` exit for provider_stalled** — **deferred**. All PS rows use
   `stallAction: 'none'`; a terminal-`stallAction` exit needs a new watchdog action
   configuration and a distinct exit path. Same class of work as #2.
4. **capacity_ceiling cancellation EXIT row (receipt present, then cancelled)** — **deferred**.
   The cancellation exit is already covered for dispatch_pending (DP-EXIT-c); a
   receipt-then-cancel row would largely re-assert the same exit mechanism under a different
   `since`. Not gated by the report.
5. **Harness `approvalTtlMs` lowering / stub clock** (blue-team note in Blocker 1) — **not
   done, deliberately**. A shared harness TTL change would perturb CC-EXIT's 1000ms-delay
   dispatch and the STRIP rows' stall timing. The fold uses a per-test policy override instead,
   which is hermetic and leaves every other row's timing untouched.
6. **SP worktree/recovery windows through the view surfaces** (blue-team Blocker 3 "ideally")
   — **deferred**. The native-spawn window is now pinned on the view; the worktree/recovery
   windows are asserted at the coordinator `_publicHandle` level (SP-START-WT/RECOVERY). Driving
   all three windows through the run view is more surface than the blocker requires and would
   add rows whose staging (deferred worktree creation + recovery re-spawn through the harness)
   is not yet fixture-supported. Not gated.

---

## Verification note

- **NUL discipline:** only `impl/src/application.mjs` and `impl/src/coordination-store.mjs`
  contain NUL bytes; all source reads for the fold used `grep -an`/`sed -n`. The suite and
  this summary are plain text.
- **Contract:** unchanged. No contract-surface-name mismatch, wrong-code claim, or missing-law
  claim was found in the report; all three blockers reproduced exactly as written on the tree.
- **Execution contract:** verification command `true` (executable), argv `[]`, cwd `.`,
  exit 0 — confirmed.
- **Scope:** only `impl/test/issue10-waiting-vocabulary-red.test.mjs` edited, plus this summary
  under `docs/reference/evidence/**`.
