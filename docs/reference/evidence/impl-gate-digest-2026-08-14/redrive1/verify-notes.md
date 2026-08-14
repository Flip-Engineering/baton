GATE_DIGEST-VERIFY v1
[attempt: c8cb5958-0993-425c-9a00-aabd1787022c coordinator]
Wave: impl-gate-digest-2026-08-14-wave-b (redrive1)
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/**

## Summary

The row `row-gate-digest` settled (signalOnMembersDone delivered — "pinned #175 semantics"), but
the redrive produced **no on-disk deliverable**: no `notes-row-gate-digest.md` at the wavefile's
report path, no digest implementation in `impl/scripts/run-suite.mjs`, no fixture, no seeded-failure
self-check. Per the #174 law (silence is not death; read the row's notes), I read the row's notes on
disk — there are none. Every acceptance criterion in `row-gate-digest-brief.md` is unmet. This is
the **second consecutive wave** (wave-a → wave-b/redrive1) with the identical failure mode:
`signalOnMembersDone` fired, and the row left zero work product.

## Verification evidence (all repo-grounded)

- **E1 — Row notes absent.** The wavefile report path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive1/notes-row-gate-digest.md` does not
  exist; repo-wide `find` for `notes-row-gate-digest*` returns nothing. The redrive1 evidence dir
  contains only `coordinator-brief.md`, `row-gate-digest-brief.md`, `impl-gate-digest.wavefile`.
- **E2 — Runner unchanged.** `git diff --exit-code HEAD -- impl/scripts/run-suite.mjs` is clean;
  `grep -c digest impl/scripts/run-suite.mjs` → 0. I read the runner in full (279 lines): it has no
  `--digest` (or any) flag handling — line 105 forwards `process.argv.slice(2)` verbatim to the
  underlying `node --test`. The row's file partition is byte-identical to the wave base commit.
- **E3 — Acceptance command fails.** `node impl/scripts/run-suite.mjs --digest` exits **9** with
  `/opt/homebrew/Cellar/node/25.8.0/bin/node: bad option: --digest` — the flag is forwarded to
  `node --test`, which rejects it. No digest is written or printed.
- **E4 — No seeded-failure self-check.** No fixture and no new/missing/unchanged classifier exist in
  the partition or the runner; grep for the classifier's vocabulary returns only the brief text and
  the wave-a verify-notes, never code. With no code there is no host for such a self-check.
- **E5 — Working tree clean / no commit.** `git status --porcelain` is empty; the reflog shows only
  the base commit (`5ae2c7e5`) and a reset-to-HEAD — no row-authored commit.
- **E6 — No dangling implementation.** `git fsck --no-reflogs` surfaces dangling commits, but
  grepping every differing `impl/scripts/run-suite.mjs` blob (29 blobs differ from HEAD — other
  waves' base snapshots in the shared object store) for `digest` yields **0** hits, and no dangling
  tree references `notes-row-gate-digest.md`. The row's work does not exist even as an unreferenced
  commit: the row produced nothing, committed nothing, left nothing.

## Acceptance check (per row-gate-digest-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| `--digest` (or named flag) writes/prints per-suite {file, stage, code-class} digest | FAIL | E3: exit 9 `bad option: --digest`; no flag handling in runner (E2) |
| Stable failure-set hash | FAIL | absent (E2) |
| Diff vs accepted baseline (new/missing/unchanged) as DATA | FAIL | absent (E2) |
| DETERMINISTIC digest (sorted keys, no clocks, repo-relative paths) | FAIL | no digest exists to check (E2) |
| Seeded-failure self-check classifies new/missing/unchanged correctly | FAIL | absent (E4) |
| Runner default human output unchanged | vacuous-pass | E2: runner byte-identical to HEAD — nothing was changed, so nothing could be regressed |
| Notes `[attempt: <salt> row-gate-digest]` in first five lines | FAIL | notes file absent (E1) |

## Spot-audit of two claims

The row brief's contract requires every claim to cite evidence and requires me to spot-audit two
claims against the repo. The row produced **no claims** — no notes and no code — so there is nothing
to audit. The only implicit claims (a digest exists and runs; the row's notes exist) are directly
refuted: E3 (exit 9) and E1 (absent file). I record this as "no claims surfaced; audit is vacuous on
an empty deliverable" — consistent with the wave-a verdict.

## Unverified / why

- **Why the signal fired without a row task.** The dispatcher reported the row settled, but no row
  deliverable, no row commit, and no row work artifact exists in the worktree or object store
  (E1/E5/E6). I cannot distinguish a harness dispatch/routing failure from a row that silently
  produced nothing — the dispatcher's internal event log is not reachable from this worktree.
- **Row-side rationale.** No `notes-row-gate-digest.md` means the row recorded no judgment calls, no
  blockers, no stall reason, and no DECISION_REQUEST. Any row-side rationale is unknowable from the
  repo.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: `signalOnMembersDone` claims the row settled, yet the row left zero work product and no
notes — **twice in a row** (wave-a and this redrive1/wave-b show the identical pattern). Determining
*why* (harness dispatch failure vs row abandonment) and *whether to re-drive again* is not mine to
decide: the coordinator deliverable is verification only, and I am barred from editing the row's
partition (`impl/scripts/run-suite.mjs`). The gate digest (#149) remains entirely unimplemented after
a full redrive.

Options:
1. **Re-drive `row-gate-digest` a third time** (operator/dispatcher authority) — the feature is
   wholly absent; the wave cannot be admitted as sound without an implementation.
2. **Fold this wave as blocked**, recording E1–E6 as the blockers, and require a re-drive before the
   gate can emit a digest.
3. **Audit the dispatch path first** — investigate why `signalOnMembersDone` fired with no row task
   *before* any re-drive. The repeat of the exact wave-a failure mode (signal without work product,
   no worker session artifact) is itself the anomaly; re-driving into the same silence wastes seats.

Recommendation: **Option 2 now** (fold with blockers), then **Option 3** to audit the dispatch path
before any Option 1 re-drive — the reproducible zero-work-product settlement across two waves is a
harness-behavior signal worth understanding before spending a third seat.
