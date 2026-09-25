EVAL_R0-VERIFY v1

[attempt: c84cbcbe-878b-4296-af11-8789029d89ad coordinator]

# EVAL-R0 coordinator verification — eval-r0-2026-08-14-wave-c (redrive2)

Verified on disk per the #174 law: sibling worktrees at `../../wt/ws-*/` were checked for the
row's notes before any conclusion. This coordinator's worktree is `ws-356f1f01…` (base
`5ae2c7e5`); the wave-c pack lives at master `093da603`. Every claim below is cited evidence
(git objects, on-disk files, process state) or an explicitly named absence. No clocks, no
fabrication.

## VERDICT

**needs-fold with blockers — the row's deliverable is ABSENT as of this verification.** The
harvest-bound report `docs/reference/evidence/eval-r0-2026-08-14/redrive2/notes-row-eval-r0.md`
does not exist in this worktree, in any sibling worktree, in any branch, or in the git object
store. There is no attempt marker, no report, and therefore no eval number, no pivot-criterion
verdict, and no row claims to run or spot-audit. The wave cannot be certified "sound".

Blockers:
1. **Row deliverable absent (primary).** `redrive2/notes-row-eval-r0.md` exists nowhere
   (`git rev-list --all --objects | grep eval-r0-2026-08-14/redrive2` returns only the pack tree
   and `eval-r0.wavefile` blob from `093da603`). No sibling worktree (`../../wt/ws-*/`) contains
   the eval-r0 redrive2 directory, let alone the row's notes. The wavefile's harvest on this
   file (`mustContain "attempt:"`) cannot be satisfied by anything on disk today.
2. **Pack-materialization gap.** The wave-c pack (coordinator-brief, row-brief, wavefile) exists
   only at `093da603` on master. This coordinator worktree is checked out at base `5ae2c7e5`,
   which predates `093da603`, so the `redrive2/` directory is not materialized here. The only
   worktree at `093da603` is `ws-2a24f9dc…` (the v20 pack/flood launcher, holding
   `v20-redrive-2026-08-14.sh`). Whether a member session resolves its brief/harvest paths
   against the pack commit or against the worktree base is an authority-class question (DR-1).
3. **No signal.** No `signalOnMembersDone` result message has been delivered to this coordinator
   session. All 15 worktrees report `stoppedAt: null` in their metas — the v20 flood is
   in-flight, so the row may still be working. Per the #174 law a missing attempt marker is not
   a dead row; I record the deliverable as absent-as-of-this-verification, not as row-death.

## Evidence

- **Row deliverable search (exhaustive).** `ls` of this worktree's
  `docs/reference/evidence/eval-r0-2026-08-14/` and `find` of every sibling worktree at
  `../../wt/ws-*/docs/reference/evidence/` for `notes-row-eval-r0.md` and `eval-r0-report.md`:
  zero hits. `git rev-list --all --objects | grep eval-r0-2026-08-14/redrive2`: only the pack
  tree `6a131889…` and `eval-r0.wavefile` blob `99ce6557…` (both from `093da603`). No commit
  touches `redrive2/` other than the pack creation.
- **Spot-audit A — pre-registration rung table.** `docs/reference/evidence/eval-scoping-2026-08-03/eval-r0-preregistration.md`
  (issue #107, dated 2026-08-07) lists five rungs with impl/base commits. All ten commits exist
  (`git cat-file -e` OK): `ac5bd80`, `2f2d23b`, `e0f9d57`, `2e22197`, `480154a`, `3733096`,
  `6d0ca11`, `47993f7`, `bb85e35`, `bbf6791`. All five grading suites are present at the named
  commits: `trust-gate-steering-red.test.mjs @2f2d23b`, `kg-settlement-red.test.mjs @2e22197`,
  `wave-grammar-red.test.mjs @480154a`, `diagnostics-red.test.mjs @6d0ca11`,
  `grammar-m5-red.test.mjs @bb85e35`. CONFIRMED.
- **Spot-audit B — wave-a §4.1 M5 plant defect (re-checked independently).**
  `git grep -c checkBannedTokens bb85e35 -- impl/scripts/surface-conformance.mjs` = 2 hits;
  `bbf6791` = 0 hits (file absent at base); `grammar-m5-red.test.mjs` absent at `bbf6791`.
  The planted-suite-at-base load-error consequence is real. CONFIRMED.
- **Spot-audit B2 — wave-a §4.4 #64 byte-identity (re-checked independently).**
  `git diff 2f2d23b ac5bd80 -- impl/test/trust-gate-steering-red.test.mjs | wc -l` = 0
  (byte-identical). CONFIRMED.
- **Spot-audit C — wave-a §2.2/§2.3 t0/t1 tables (re-computed from the committed artifacts at
  `317f3a6f`, the wave-a row's snapshot).** The t0-results/*.txt summary counts
  (`ℹ tests/pass/fail`) read exactly: trust-gate 21/7/14 · kg-settle 24/3/21 · wave-grammar
  5/0/5 · diagnostics 8/1/7 · alias-m5 1/0/1 — every base RED, matching the wave-a
  coordinator's table and the pre-registration's t0 mandate. The t1-results/*.txt counts read
  exactly: 21/21 · 24/24 · 5/5 · 8/8 · 5/5 (all green at each impl commit). CONFIRMED.
- **Wave-a §3.1 auth finding re-confirmed.** `deepseek_key.json` (55 B) and `glm_key.json`
  (64 B) both exist at the main repo root `$HOME/Development/Experiments/baton/`.
  The deployment resolves the credential via `deepseekCredentialProjection(repoRoot)` →
  `join(repoRoot,'deepseek_key.json')` (`impl/src/application-deployment.mjs:107-110`, `:857`).
  The credential is present at the main repo root; whether an eval session sees it depends on
  its `repoRoot` resolution, not on absence. So wave-a's §3.1 claim (both keys "no glm_key
  either") is partly wrong exactly as wave-a's coordinator recorded.
- **The #221 law (capacity).** Commit `a3e96e8` "fix(#221): RIP OUT the invented seat-ceiling
  pre-cap — operator ruling" removes the invented seat-ceiling; backpressure is provider-TRUE
  (typed 429/rate_limited, retried, ledgered) — never a silent synthetic queue. Wave-a's §3.2
  capacity model (invented seat-hours) predates this ruling and is not a valid STOP reason
  under current rules. An eval row must measure against the live resident, not an invented cap.
- **`gh` is unauthenticated in this worktree** (verified: "You are not logged into any GitHub
  hosts"). Per the brief's allowance, grounding is in the repo docs — the pre-registration is
  present and read in full.

## What I ran

All read-only (the brief's law: read-and-run only outside my deliverable):
- `git cat-file -e` on the 10 rung commits and 5 suite blobs (Spot-audit A).
- `git grep -c checkBannedTokens` at `bb85e35` vs `bbf6791`; `git cat-file -e` on
  `grammar-m5-red.test.mjs @bbf6791` (Spot-audit B).
- `git diff 2f2d23b ac5bd80 -- impl/test/trust-gate-steering-red.test.mjs` (Spot-audit B2).
- `git show 317f3a6f:…/t0-results/*.txt` and `…/t1-results/*.txt`, extracting the
  `ℹ tests/pass/fail` summary lines (Spot-audit C).
- `find`/`ls` across all 15 sibling worktrees for the row's notes and the eval-r0 redrive2 dir.
- `git rev-list --all --objects | grep eval-r0-2026-08-14/redrive2`.
- `gh auth status`; `ls` of the two credential files at the main repo root.
- `grep` of `deepseekCredentialProjection` in `impl/src/application-deployment.mjs`.

## Anything unverified and why

- **The row's report itself (the protocol-as-registered runs, the numbers, the pivot-criterion
  verdict).** Absent — nothing to run, no claim to check. The two arms (SOLO vs DRIVEN) have
  not produced any artifact verifiable from this coordinator seat.
- **Whether the row is still in-flight or stalled.** All worktrees' metas report
  `stoppedAt: null`; the resident flood is active. This verification is a point-in-time
  absence; if the row settles after this note, re-verification is required.
- **Issue #107's tracker text.** `gh` unauthenticated; grounding is in the repo's
  pre-registration text (present). Any tracker-vs-repo discrepancy is outside what this
  coordinator can check.
- **The eval session's `repoRoot` resolution (does it reach the main-repo-root credentials?).**
  Not decidable from a member worktree — depends on how the operator re-dispatches. This is
  the substance of the wave-a §3.1 correction and remains open.

## DECISION_REQUEST — authority-class ambiguity

- **DR-1 (deliverable-path + pack-resolution binding).** The wavefile/harvest binds
  `redrive2/notes-row-eval-r0.md` and `redrive2/verify-notes.md`; the row brief's partition
  reads `eval-r0-2026-08-14/**` with deliverable `notes-row-eval-r0.md` (no directory prefix)
  — the same class of brief-vs-harvest disagreement that missed wave-a's harvest. The pack
  lives only at `093da603`, not in this worktree's base. Confirm the governing resolution:
  pack commit `093da603` for brief/harvest paths, with member worktrees at the wave base; and
  reconcile the row brief's stale directory-less path.
- **DR-2 (row absence → wave action).** The row has not delivered as of this verification and
  no signal has arrived. Options: (a) **HOLD** — re-verify once the row settles (the flood is
  in-flight; a missing attempt marker is not a dead row per #174); (b) **FOLD-NOW** — accept
  the absent-deliverable blocker and re-dispatch the row with the redrive2 pack materialized
  into its worktree; (c) **PROVISIONAL-ACCEPT** — accept the wave-a `verify-notes.md` as the
  substrate record, require the row's `notes-row-eval-r0.md` before any arm session is
  dispatched. Recommendation: (a) with a bounded re-check, because the row is the only producer
  of the eval number and the flood is demonstrably still running.
- **DR-3 (stale re-drive labeling).** The redrive2 row brief's RE-DRIVE NOTES header says
  "(wave-b, 2026-08-14)" while this dispatch is wave-c — a stale label that should be corrected
  so future verifications can cite the right wave without ambiguity.

The M5 plant-defect and #63 suite-digest sub-questions (§6.1/§6.2 of the wave-a row's report)
are sealed-protocol amendments that need the operator under any option; this coordinator
independently re-confirmed the underlying facts (Spot-audits B and B2) and does not decide them.
