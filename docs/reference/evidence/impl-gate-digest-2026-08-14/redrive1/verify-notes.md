GATE_DIGEST-VERIFY v1
[attempt: 127404f3-53d0-460d-917a-dc56fd44e03d coordinator]
Wave: impl-gate-digest-2026-08-14-wave-b (redrive1)
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/**

## Summary

The row `row-gate-digest` settled — `signalOnMembersDone` was delivered ("The row settled …
pinned #175 semantics") — but the redrive again produced **no on-disk deliverable**: no
`notes-row-gate-digest.md` at the wavefile's report path, no digest implementation in
`impl/scripts/run-suite.mjs`, no fixture, no seeded-failure self-check. Per the #174 law (silence is
not death; read the row's notes) I read the row's notes on disk — there are none, at either the row
brief's path or the wavefile's report path. Every acceptance criterion in `row-gate-digest-brief.md`
is unmet. This is the **second consecutive wave** (wave-a → wave-b/redrive1) with the identical
failure mode. New this redrive: a **prior coordinator attempt** committed its own `verify-notes.md`
(snapshot `c38b04f0` in worktree `ws-8105bb30…`, attempt `c8cb5958-0993-425c-9a00-aabd1787022c`)
reaching the same needs-fold verdict — two independent coordinator passes agree, and the row still
left zero work product.

## Verification evidence (all repo-grounded)

- **E1 — Row notes absent at every named path.** The wavefile report path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/notes-row-gate-digest.md` does not
  exist. The row brief names the non-redrive path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/notes-row-gate-digest.md` — also absent.
  Repo-wide `find` for `notes-row-gate-digest*` returns nothing across the worktree, the main
  checkout, and every worktree under `.baton/wt/`. The redrive1 evidence dir holds only
  `coordinator-brief.md`, `row-gate-digest-brief.md`, `impl-gate-digest.wavefile`.
- **E2 — Runner unchanged.** `git diff --exit-code HEAD -- impl/scripts/run-suite.mjs` is clean;
  `grep -c digest impl/scripts/run-suite.mjs` → 0. I read the runner in full (279 lines): it has no
  `--digest` (or any) flag handling — line 105 forwards `process.argv.slice(2)` verbatim to the
  underlying `node --test`. The row's file partition is byte-identical to the wave base commit
  `5ae2c7e5`, and **no** worktree at that base has a dirty `run-suite.mjs`.
- **E3 — Acceptance command fails.** `node impl/scripts/run-suite.mjs --digest` exits **9** with
  `/opt/homebrew/Cellar/node/25.8.0/bin/node: bad option: --digest` — the flag is forwarded to
  `node --test`, which rejects it. No digest is written or printed.
- **E4 — No seeded-failure self-check.** No fixture and no new/missing/unchanged classifier exist
  in the partition or the runner; no fixture JSON appears in the redrive1 scope. With no code there
  is no host for such a self-check.
- **E5 — Working tree clean / no row commit in this worktree.** `git status --porcelain` is empty;
  the reflog shows only the base commit and a reset-to-HEAD — no row-authored commit.
- **E6 — A prior coordinator attempt exists; both wave reservations are coordinator-style.**
  `capacity/reservations.json` lists exactly two worker reservations for this wave at the current
  base `5ae2c7e5`: `ws-8105bb301713063d7ac0c9c3cf9bbecf` (created 16:38:23Z, materialized
  16:38:24Z) and `ws-b8823127192641fe7ee87f668128713a` (this worktree, created 16:39:46Z,
  materialized 16:39:46Z). Neither reservation carries a `role` tag. Worktree `ws-8105bb30…` HEAD
  is snapshot commit `c38b04f0` ("baton snapshot: ws-8105bb30…", author
  `baton-worker-deepseek:deepseek`, model deepseek-v4-flash, effort high) whose **only** change vs
  base is `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/verify-notes.md` (91 lines,
  `[attempt: c8cb5958-0993-425c-9a00-aabd1787022c coordinator]`, VERDICT needs-fold with blockers).
  That is the coordinator deliverable for this wave, from a distinct coordinator attempt, committed
  at 09:41:53 -0700 — while my session (this attempt) was already running. Both reserved workers
  produced/will produce a coordinator-style `verify-notes.md`; **no worker produced the row's
  `notes-row-gate-digest.md`**.
- **E7 — No dangling implementation.** `git fsck --no-reflogs` surfaces many dangling commits (other
  waves' snapshots in the shared object store), but no unreachable commit references
  `notes-row-gate-digest.md`, and no `run-suite.mjs` blob in the object store contains `digest`
  (blob scan over `git rev-list --objects --all` → 0 hits). The row's work does not exist even as an
  unreferenced commit: the row produced nothing, committed nothing, left nothing.

## Acceptance check (per row-gate-digest-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| `--digest` (or named flag) writes/prints per-suite {file, stage, code-class} digest | FAIL | E3: exit 9 `bad option: --digest`; no flag handling in runner (E2) |
| Stable failure-set hash | FAIL | absent (E2) |
| Diff vs accepted baseline (new/missing/unchanged) as DATA | FAIL | absent (E2) |
| DETERMINISTIC digest (sorted keys, no clocks, repo-relative paths) | FAIL | no digest exists to check (E2) |
| Seeded-failure self-check classifies new/missing/unchanged correctly | FAIL | absent (E4) |
| Runner default human output unchanged | vacuous-pass | E2: runner byte-identical to HEAD — nothing was changed, so nothing could be regressed |
| Notes `[attempt: <salt> row-gate-digest]` in first five lines | FAIL | notes file absent at both named paths (E1) |

## Spot-audit of two claims

The row brief's contract requires every claim to cite evidence and requires me to spot-audit two
claims against the repo. The row produced **no claims** — no notes and no code — so there is nothing
of the row's to audit; the only implicit row claims (a digest exists and runs; the row's notes
exist) are directly refuted by E3 (exit 9) and E1 (absent file). I record this as "no row claims
surfaced; audit is vacuous on an empty deliverable" — consistent with the wave-a verdict.

Because the wave's evidence dir does contain one claim-bearing document — the prior coordinator
attempt's `verify-notes.md` (committed at `c38b04f0`, attempt `c8cb5958`) — I spot-audited **two of
its claims** against the repo to keep the citation discipline meaningful:

| Claim (from `ws-8105bb30…` `verify-notes.md`) | Verified on disk | Result |
|---|---|---|
| "line 105 forwards `process.argv.slice(2)` verbatim to the underlying `node --test`" | `run-suite.mjs:105` — `const child = spawn(process.execPath, ['--import', watchdogUrl, '--test', ...process.argv.slice(2)], {` | ✓ ACCURATE |
| "`grep -c digest impl/scripts/run-suite.mjs` → 0" and no differing blob contains a digest impl | `grep -c digest` → 0; object-store blob scan over all `run-suite.mjs` blobs → 0 hits for `digest` | ✓ ACCURATE |

The prior coordinator's on-disk claims hold up; its verdict matches this pass.

### Spot-audit of the row brief's seed claims (the only row-side anchors available)

Because the row's deliverable is empty, I also audited the row brief's own factual claims about the
runner and the acceptance problem — the anchors the row's notes were supposed to inherit and extend:

| Claim (row-gate-digest-brief.md) | Verified on disk | Result |
|---|---|---|
| "the full gate's output is prose" | `run-suite.mjs:105` spawns `node --test` with `stdio: 'inherit'`; the runner's only emissions are prose stderr lines (`surface-conformance:`, `fixture-clock-lint:`, `baton test runner …` at lines 22/32/39/63/71/81/256/261/266) plus the child's human-readable test output. No machine-readable digest is emitted anywhere. | ✓ ACCURATE |
| "`impl/scripts/run-suite.mjs` (the runner — its output shape today)" | The runner is a process-group-managing wrapper around `node --test` (279 lines): it lints fixtures (line 19), runs surface-conformance checks (lines 35–43), then delegates to `node --test` (line 105). No flag parsing exists — argv is forwarded verbatim (line 105), so the output shape is node's, not the gate's. | ✓ ACCURATE |
| "orchestrator classifies expected-red vs unexpected failures BY HAND (a 32-file manual classification happened this campaign)" | The hand-classification phenomenon is corroborated: the friction ledger (`frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:120`) records the #105 full-gate acceptance requiring hand-tabulation of the failure distribution from a 700KB log (`grep "^✖"` + per-file attribution). The specific **"32-file" count is not independently corroborated in this repo** — a grep for `32-file` matches only the two row-brief copies, never a campaign record. | PARTIAL — phenomenon corroborated; the number is uncorroborated |

The third row is the one caveat: the count should not be re-cited as repo evidence by any future
fold without a campaign record; the brief's underlying point (classification is manual today) is
supported.

## Unverified / why

- **Which member `ws-8105bb30…` actually was.** It committed a coordinator-style `verify-notes.md`
  with a coordinator attempt salt, and the two wave reservations are both `kind: worker` with no
  `role` tag. I cannot distinguish (a) a second coordinator dispatch (row never given a worktree)
  from (b) the row's worktree driven with the coordinator's brief (a role/routing failure). Either
  way the row member was never correctly executed, but *which* is not decidable from inside this
  worktree.
- **Why the signal fired with no row work product.** The dispatcher reported the row settled, yet no
  row deliverable, row commit, or row work artifact exists in any worktree or the object store
  (E1/E5/E6/E7). I cannot distinguish a harness dispatch/routing failure from a row that silently
  produced nothing; the dispatcher's internal role→worktree mapping is not observable from here.
- **Row-side rationale.** No `notes-row-gate-digest.md` means the row recorded no judgment calls, no
  blockers, no stall reason, and no DECISION_REQUEST. Any row-side rationale is unknowable from the
  repo.
- **Row-brief path drift.** The redrive1 row brief names the notes path as
  `impl-gate-digest-2026-08-14/notes-row-gate-digest.md` (the wave-a path) while the redrive1
  wavefile's report/harvest target is `impl-gate-digest-2026-08-14/redrive1/notes-row-gate-digest.md`.
  Both are absent, so the drift does not change the verdict — but it should be reconciled before any
  re-drive so a landing row writes to the harvested path.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: `signalOnMembersDone` claims the row settled, yet the row left zero work product and no
notes — **twice in a row** (wave-a and this redrive1/wave-b show the identical pattern) — and this
redrive also saw **two coordinator-style workers** reserved while no row deliverable appeared
anywhere. Determining *why* (row never dispatched vs. row driven under the wrong brief vs. row
abandonment) and *whether to re-drive again* is not mine to decide: the coordinator deliverable is
verification only, and I am barred from editing the row's partition (`impl/scripts/run-suite.mjs`).
The gate digest (#149) remains entirely unimplemented after a full redrive.

Options:
1. **Re-drive `row-gate-digest` a third time** (operator/dispatcher authority) — the feature is
   wholly absent; the wave cannot be admitted as sound without an implementation.
2. **Fold this wave as blocked**, recording E1–E7 as the blockers, and require a re-drive before the
   gate can emit a digest.
3. **Audit the dispatch path first** — investigate why the row member settles with zero work product
   (and why two coordinator-style workers were reserved for a two-member wave) *before* any
   re-drive. The repeat of the exact wave-a failure mode, now with the new evidence that a prior
   coordinator attempt already landed, is itself the anomaly; re-driving into the same silence
   wastes seats.

Recommendation: **Option 2 now** (fold with blockers, citing E1–E7), then **Option 3** to audit the
dispatch/routing path before any Option 1 re-drive — the reproducible zero-work-product settlement
across two waves, plus the ambiguous dual-coordinator reservation, is a harness-behavior signal
worth understanding before spending a third seat.
