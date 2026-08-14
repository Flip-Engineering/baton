GATE_DIGEST-VERIFY v1
[attempt: a1e80a83-4422-4c7c-a288-ce96cff30f44 coordinator]
Wave: impl-gate-digest-2026-08-14-wave-c (redrive2)
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/impl-gate-digest-2026-08-14/redrive2/**

## Summary

The row `row-gate-digest` settled — `signalOnMembersDone` was delivered (seq 117641: "The row
settled … pinned #175 semantics") — but the redrive again produced **no on-disk deliverable**: no
`notes-row-gate-digest.md` at the wavefile's report path (`redrive2/notes-row-gate-digest.md`), no
digest implementation in `impl/scripts/run-suite.mjs`, no fixture, no seeded-failure self-check.
Per the #174 law (silence is not death; read the row's notes) I read the row's notes on disk —
there are none, at any named path. Every acceptance criterion in `row-gate-digest-brief.md` is
unmet. This is the **third consecutive wave** (wave-a → redrive1/wave-b → redrive2/wave-c) with
the identical failure mode. **Decisive new evidence this redrive:** the coordination event log shows
the wave-c plan contained **exactly one plan node (`work`, the coordinator)** and exactly **one
task was created** (`baton-b5880c3217ee546990a0db31-work`, the coordinator's). The `row-gate-digest`
member was **never dispatched as a task at all** — no row task, no row worktree reservation, no row
worker session — yet the dispatcher ADMITTED the wave as if both members were rostered and the
orchestrator signalled the row settled.

## Verification evidence (all repo-grounded)

- **E1 — Row notes absent at every named path.** The wavefile report path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive2/notes-row-gate-digest.md` does not
  exist. The row brief names the non-redrive path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/notes-row-gate-digest.md` — also absent.
  Repo-wide `find` for `notes-row-gate-digest*` under `.baton` returns nothing.
- **E2 — Runner unchanged.** `git diff --exit-code HEAD -- impl/scripts/run-suite.mjs` is clean;
  `grep -c digest impl/scripts/run-suite.mjs` → 0. I read the runner in full (279 lines): it has no
  `--digest` (or any) flag handling — line 105 forwards `process.argv.slice(2)` verbatim to the
  underlying `node --test`. The row's file partition is byte-identical to the wave base commit
  `5ae2c7e5`.
- **E3 — Acceptance command fails.** `node impl/scripts/run-suite.mjs --digest` exits **9** with
  `/opt/homebrew/Cellar/node/25.8.0/bin/node: bad option: --digest` — the flag is forwarded to
  `node --test`, which rejects it. No digest is written or printed.
- **E4 — No seeded-failure self-check.** No fixture and no new/missing/unchanged classifier exist
  in the partition or the runner; no fixture JSON appears in the redrive2 scope. With no code there
  is no host for such a self-check.
- **E5 — Working tree clean / no row commit.** `git status --porcelain` was empty before I created
  this deliverable's directory; the reflog shows only the base commit and a reset-to-HEAD — no
  row-authored commit.
- **E6 — The row was never dispatched as a task (decisive, from the coordination log).** In run
  `run-de07506afaa94320d94fac42b4c8b066` (`state/coordination/events.jsonl`):
  - seq 117628: `wave.started`, roster `["coordinator","row-gate-digest"]`.
  - seq 117629: `plan.version_proposed` — the plan's node list contains **only `"key":"work"`**
    (the coordinator). No row node exists.
  - seq 117631: `plan.node_dispatched` (node `work`); seq 117632: `task.created` with id
    `baton-b5880c3217ee546990a0db31-work` (brief = the coordinator brief, attempt
    `a1e80a83-4422-4c7c-a288-ce96cff30f44`).
  - seq 117634: `worker.generation_bound` → w-563 (this session).
  - seq 117638: `web.command_completed` "v20-gate-digest-c" → verdict **WAVE-ADMITTED**,
    members `["coordinator","row-gate-digest"]` — the dispatcher admitted the wave claiming both
    members, though only the coordinator node exists.
  - seq 117639/117641: `message.sent` (brief, then result "The row settled …").
  The **only** `taskId` in the entire run is `baton-b5880c3217ee546990a0db31-work`. No
  `row-gate-digest` task was ever created.
- **E7 — No dangling implementation.** `git rev-list --objects --all` over every `run-suite.mjs`
  blob: none contains `digest`. No dangling commit references `notes-row-gate-digest.md`. The row's
  work does not exist even as an unreferenced commit.
- **E8 — No row worktree reservation.** `capacity/reservations.json` shows exactly **one**
  reservation in the wave-c window (17:14–17:16Z): `ws-b40b90a7342664d0a92157d295c152e0` — this
  coordinator worktree. The four reservations at 17:10–17:11Z are different resource IDs (other
  waves). No row worktree was ever reserved for this wave.

## Acceptance check (per row-gate-digest-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| `--digest` (or named flag) writes/prints per-suite {file, stage, code-class} digest | FAIL | E3: exit 9 `bad option: --digest`; no flag handling in runner (E2) |
| Stable failure-set hash | FAIL | absent (E2) |
| Diff vs accepted baseline (new/missing/unchanged) as DATA | FAIL | absent (E2) |
| DETERMINISTIC digest (sorted keys, no clocks, repo-relative paths) | FAIL | no digest exists to check (E2) |
| Seeded-failure self-check classifies new/missing/unchanged correctly | FAIL | absent (E4) |
| Runner default human output unchanged | vacuous-pass | runner identical to HEAD (E2) — nothing was changed, so nothing could be regressed |
| Notes `[attempt: <salt> row-gate-digest]` in first five lines | FAIL | notes file absent (E1) |

## Spot-audit of two claims

The row brief's contract requires every claim to cite evidence and requires me to spot-audit two
claims against the repo. The row produced **no claims** — no notes and no code — so there is
nothing of the row's to audit. Following the redrive1 precedent, I audited the row brief's own
factual anchors (the only row-side claims available), plus verified the prior coordinator's
on-disk record:

| Claim | Verified on disk | Result |
|---|---|---|
| Row brief: "the full gate's output is prose" | `run-suite.mjs:105` spawns `node --test` with `stdio: 'inherit'`; the runner's only emissions are prose stderr lines (`surface-conformance:`, `fixture-clock-lint:`, `baton test runner …`) plus the child's human-readable test output. No machine-readable digest is emitted anywhere. | ✓ ACCURATE |
| Row brief: "orchestrator classifies expected-red vs unexpected failures BY HAND (a 32-file manual classification happened this campaign)" | Hand-classification phenomenon corroborated: `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:120` records the #105 full-gate acceptance requiring hand-tabulation of the failure distribution from a 700KB log (`grep "^✖"` + per-file attribution), and line 121 files #149 (the gate closing digest) as the fix. The specific **"32-file" count is not independently corroborated** — a grep for `32-file` matches only the row-brief copies, never a campaign record. | PARTIAL — phenomenon corroborated; the number is uncorroborated |

The prior coordinator's on-disk claims (redrive1 `verify-notes.md`, snapshot `c38b04f0` /
`093da603` in the pack) also survive re-audit: its E2 line-105 forwarding claim and
`grep -c digest` → 0 claim both reproduce exactly.

## Unverified / why

- **Why the signal fired with no row task.** The dispatcher ADMITTED the wave (seq 117638,
  `WAVE-ADMITTED`, members `["coordinator","row-gate-digest"]`) and the orchestrator signalled the
  row settled (seq 117641) even though the wave-c plan contained only the coordinator node and no
  row task was ever created (E6). This is now the **third consecutive occurrence** of the exact
  wave-a failure mode, and the event log proves this time the row was never even dispatched as a
  task. Whether the roster-vs-plan mismatch is a planner derivation defect (roster ≠ node set), a
  wave-admission check that admits on roster rather than realized nodes, or a
  `signalOnMembersDone` that fires on an un-dispatched member is not decidable from inside this
  worktree — but the evidence points at the harness dispatch path, not at row behavior.
- **Row-side rationale.** No `notes-row-gate-digest.md` means the row recorded no judgment calls,
  no blockers, no stall reason, and no DECISION_REQUEST. Any row-side rationale is unknowable from
  the repo.
- **Row-brief path drift persists.** The redrive2 row brief still names the notes path as
  `impl-gate-digest-2026-08-14/notes-row-gate-digest.md` (the wave-a path) while the wavefile's
  report/harvest target is `redrive2/notes-row-gate-digest.md`. Both are absent, so the drift does
  not change the verdict — but it should be reconciled before any re-drive so a landing row writes
  to the harvested path.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: `signalOnMembersDone` claims the row settled, yet the row left zero work product and no
notes — **three times in a row** (wave-a, redrive1/wave-b, redrive2/wave-c) — and this redrive's
coordination log now proves the row member was **never dispatched as a task** (E6/E8): the plan had
one node, one task, one reservation, all coordinator. Determining *why* the dispatcher admitted a
two-member wave and signalled a settled row with only the coordinator realized, and *whether to
re-drive again*, is not mine to decide: the coordinator deliverable is verification only, and I am
barred from editing the row's partition (`impl/scripts/run-suite.mjs`). The gate digest (#149)
remains entirely unimplemented after two redrives.

Options:
1. **Re-drive `row-gate-digest` a fourth time** (operator/dispatcher authority) — the feature is
   wholly absent; the wave cannot be admitted as sound without an implementation.
2. **Fold this wave as blocked**, recording E1–E8 as the blockers, and require the dispatch path
   to be fixed before any re-drive.
3. **Audit the dispatch path first** — investigate why a two-member wave plan realizes only the
   coordinator node, why the wave is ADMITTED on roster rather than realized nodes, and why
   `signalOnMembersDone` fires for a member that was never dispatched. The repeat of the exact
   wave-a failure mode across three waves, now proven to be a dispatch-side (not row-side) absence,
   is the anomaly; re-driving into the same silence wastes seats.

Recommendation: **Option 3 first** (audit the planner/dispatch path — the coordination log gives it
a precise starting point: the wave-c plan's node set vs. its roster), then **Option 2** (fold this
wave with E1–E8 as blockers) until the dispatch is proven to realize both members, and only then
re-drive per Option 1. The evidence this redrive is no longer merely "silence"; it is a reproducible
harness behavior: a two-member wave whose plan and reservations contain only the coordinator.
