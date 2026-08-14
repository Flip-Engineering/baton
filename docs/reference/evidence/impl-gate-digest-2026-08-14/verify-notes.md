GATE_DIGEST-VERIFY v1
[attempt: d5c8f39e-e03a-4e60-b7ae-bd59245ff209 coordinator]
Wave: impl-gate-digest-2026-08-14-wave-a
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/impl-gate-digest-2026-08-14/**

## Summary

The row `row-gate-digest` settled with **no on-disk deliverable**. There is no implementation of
the machine-readable gate-failure digest (#149), no `notes-row-gate-digest.md`, no fixture, and no
evidence to audit. The signal (`signalOnMembersDone`) fired, but nothing was produced. Per the
#174 law I read the row's notes on disk — there are none. Every acceptance criterion in
`row-gate-digest-brief.md` is unmet.

## Verification evidence (all repo-grounded)

- **E1 — Working tree clean.** `git status --porcelain` is empty; the reflog for this worktree
  shows only the base commit and a reset-to-HEAD (no row commit).
- **E2 — Row notes absent.** The required
  `docs/reference/evidence/impl-gate-digest-2026-08-14/notes-row-gate-digest.md` does not exist;
  repo-wide `find` for `notes-row-gate-digest*` and `verify-notes*` returns nothing. The scoped
  evidence dir contains only `coordinator-brief.md`, `row-gate-digest-brief.md`,
  `impl-gate-digest.wavefile`.
- **E3 — Runner unchanged.** `git diff --exit-code HEAD -- impl/scripts/run-suite.mjs` is clean;
  `grep -n digest impl/scripts/run-suite.mjs` returns no matches. The row's file partition
  (`impl/scripts/run-suite.mjs`) is byte-identical to the wave base commit.
- **E4 — Acceptance command fails.** `node impl/scripts/run-suite.mjs --digest` exits **9** with
  `node: bad option: --digest` (the flag is forwarded to the underlying `node --test`, which
  rejects it). No digest is written or printed.
- **E5 — No seeded-failure self-check.** No fixture and no classifier for
  new/missing/unchanged failure classes exist anywhere in the partition; with no code there is no
  host for such a self-check.
- **E6 — Harness state.** This run's plan (`plan:04987135…`, seq 98623) contains a single `work`
  node — the coordinator (w-434). The row brief text ("machine-readable gate failure digest")
  appears **0** times in `state/coordination/events.jsonl`; the only `task.created` events in this
  run's window are the coordinator and two unrelated tasks for other waves (w-435, w-436). No row
  worker session exists under the harness runtime for this run. The `result` message
  (message:b76b4f47…) "The row settled … pinned #175 semantics" was delivered at seq 98636.
- **E7 — Object store clean.** `git fsck --no-reflogs` reveals no dangling commit whose tree
  contains a `--digest` implementation of `impl/scripts/run-suite.mjs` or a
  `notes-row-gate-digest.md`; `git log --all --grep=digest` has no row-authored commit. The row's
  work does not exist even as an unreferenced commit — the row produced nothing, committed
  nothing, and left nothing.

## Acceptance check (per row-gate-digest-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| `--digest` (or named flag) writes/prints per-suite {file, stage, code-class} digest | FAIL | E4: exit 9 `bad option: --digest`; no flag handling in runner (E3) |
| Stable failure-set hash | FAIL | absent (E3) |
| Diff vs accepted baseline (new/missing/unchanged) as DATA | FAIL | absent (E3) |
| DETERMINISTIC digest (sorted keys, no clocks, repo-relative paths) | FAIL | no digest exists to check (E3) |
| Seeded-failure self-check classifies new/missing/unchanged correctly | FAIL | absent (E5) |
| Runner default human output unchanged | vacuous-pass | runner identical to HEAD (E3) — nothing was changed, so nothing could be regressed |
| Notes `[attempt: <salt> row-gate-digest]` in first five lines | FAIL | notes file absent (E2) |

## Spot-audit of two claims

The row brief's contract requires every claim to cite evidence and requires me to spot-audit two
claims against the repo. The row produced **no claims** — no notes and no code — so there is
nothing to audit. The only implicit claim (that a digest exists and runs) is directly refuted by
E4. I record this as "no claims surfaced; audit is vacuous on an empty deliverable."

## Unverified / why

- **Why the signal fired without a row task.** The orchestrator reported the row settled, but no
  row task/session exists in the coordination events or harness runtime for this run (E6). I
  cannot distinguish a harness dispatch/routing failure from a row that silently produced nothing.
- **Row-side rationale.** No `notes-row-gate-digest.md` means the row recorded no judgment calls,
  no blockers, and no DECISION_REQUEST. Any stall reason is unknowable from the repo.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: `signalOnMembersDone` claims the row settled, yet the row left zero work product and no
notes, and no row worker session exists for this run. Determining *why* (harness dispatch failure
vs row abandonment) and *whether to re-drive* is not mine to decide: the coordinator deliverable
is verification only, and I am barred from editing the row's partition
(`impl/scripts/run-suite.mjs`) — the gate digest (#149) remains entirely unimplemented.

Options:
1. **Re-drive `row-gate-digest`** (operator/dispatcher authority) — the feature is wholly absent;
   the wave cannot be admitted as sound without an implementation.
2. **Fold this wave as blocked**, recording E1–E7 as the blockers, and require a re-drive before
   the gate can emit a digest.
3. **Audit the dispatch path first** — investigate why `signalOnMembersDone` fired with no row
   task before re-driving, to avoid re-driving into the same silence.

Recommendation: **Option 2 now** (fold with blockers), then **Option 3** to audit the dispatch
before any Option 1 re-drive — the complete absence of a row worker session is itself anomalous
and should be understood before spending another seat.
