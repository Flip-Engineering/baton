PHANTOM-ROOT-VERIFY v1
[attempt: 8acdcc3d-17ab-471c-9525-0cce86606e3d coordinator]
Status: GROUNDED — PASS. All three rows (row-task-namespace #200, row-admission-align #207,
row-spawn-window #199) settled with on-disk deliverables; each red-first pin suite is GREEN at
its row state and was RED at the pre-change base; the interpreter/wave/coordinator/DSL battery
suites are byte-identical and green. This report carries the required marker line
`PHANTOM-ROOT-VERIFY v1`.

# phantom-root wave-h — coordinator verification notes

Coordinator: wave `phantom-root-2026-08-15-wave-h`, member `coordinator` (this worktree
`ws-63a47fb92284a7d4011eb70d2373f57a`, base `fc9733ff`). Rows under verification:
`row-task-namespace` (#200 — member task ids carry the wave namespace), `row-admission-align`
(#207 — wave admission refuses briefs members cannot start), `row-spawn-window` (#199 — no
failed-verdict inside the spawn-confirmation window). Contracts: issues #199/#200/#207 — `gh`
is UNAUTHENTICATED in this worktree (verified: `issue://199` resolution fails with "GitHub CLI
is not authenticated"), so each row grounded its contract in the repo's own measured history
(issue #200 → lifecycle-contracts evidence `redrive3/contract-members.md` row A2/D2.1; #199/#207
→ the wave pack `4ff9b9fb`, the surface fix `852700a5`, and the row briefs, which are
byte-identical to the wave-h copies at `595b68de` in the main checkout). Verification law: the
acceptance authority is each row's red-first pin green at ITS HEAD; interpreter/wave/coordinator
batteries unchanged; verdict written on settle (pinned #175 semantics — I am the remaining
member, signalled by `signalOnMembersDone`).

## §1 Suites read, immutability baseline (SHA-256, first 16 hex, this session at fc9733ff)

Batteries (the acceptance's "unchanged" set) — same values at base AND at every row state
(measured in each row's worktree; all byte-identical):

- `test/workflow-as-data-red.test.mjs` 069fb14906b770a4 — the interpreter battery (#114)
- `test/wave-driver-red.test.mjs` 40472d27d48556a2 — the wave battery
- `test/coordinator.test.mjs` 11970b86e90f92b9 — the coordinator battery
- `test/workflow-dsl-red.test.mjs` 366e73a23e0c0bd5 — the DSL/compile surface battery
- `test/workflow-dsl-package-red.test.mjs` 28f18b2a40dc3680 — the DSL package battery

Row-partition source files at base (anchors; the rows edit them — immutability NOT required):

- `src/wave.mjs` 215296b218e2957d · `src/workflow-interpreter.mjs` b6d5776de117775c
- `src/limits.mjs` 45b06693e9a35333 · `src/coordinator.mjs` bc3c6429fdf15e83
- `src/application.mjs` (task-namespace row site) · `src/application-semantics.mjs`,
  `src/wave-driver.mjs` (spawn-window row sites)

The rows' pin suites are ABSENT at base (glob `impl/test/*spawn-window*`,
`*objective-admission-align*`, `*wave-task-namespace*` → no matches at fc9733ff) — the
red-first files were created by the rows, never edited into an existing suite.

## §2 Measured baseline at base fc9733ff (my tree, clean, run from impl/)

`node --test test/<suite>.test.mjs`:

| suite | tests | pass | fail | notes |
|---|---|---|---|---|
| workflow-as-data-red | 31 | 31 | 0 | green (21.3 s) |
| wave-driver-red | 10 | 10 | 0 | green (10.9 s) |
| coordinator | 58 | 58 | 0 | green (1.5 s) |
| workflow-dsl-red + workflow-dsl-package-red | 47 | 47 | 0 | green (241.7 s) |

All five battery suites green at base; the rows' fixes keep them green-unchanged (see §4).

## §3 Row states on settle (per-row HEAD and deliverables)

| row | worktree | state on settle | deliverable files |
|---|---|---|---|
| row-task-namespace | ws-e16ec265… | HEAD `8599e782` baton snapshot, tree clean | `impl/src/application.mjs` (runId digest folds waveId when present + normalizeIntent comment amendment); `impl/test/wave-task-namespace-red.test.mjs` (new); `notes-row-task-namespace.md` + brief copy in wave-h scope |
| row-admission-align | ws-6784184d… | snapshot `9f3d766f` + working-tree changes (settled with uncommitted impl/test edits — the pin ran green against this exact state) | `impl/src/workflow-interpreter.mjs` (renderObjective admission check: FRAME_LIMITS['run.objective'] cap on the RENDERED objective, workflow_spec_invalid naming brief bytes + rendered bytes + cap; D5 64KiB envelope unchanged and checked first); `impl/test/objective-admission-align-red.test.mjs` (new); `notes-row-admission-align.md` |
| row-spawn-window | ws-4e112579… | HEAD `84704bf8` baton snapshot, tree clean | `impl/src/application-semantics.mjs` (typedTerminalEvidence + SPAWN_WINDOW_CONFIRMATION_READS=3); `impl/src/wave.mjs` (terminalFrom failed-class gate, settle suspicious-streak); `impl/src/wave-driver.mjs`, `impl/src/workflow-interpreter.mjs`, `impl/src/coordinator.mjs` (_ownedHarnessRetry, spawned/process_started owned-retry binding); `impl/test/spawn-window-red.test.mjs` (new); `notes-row-spawn-window.md` |

Harvest requirements: all three `notes-row-*.md` exist under the wave-h scope and carry the
attempt line within the first five lines:
- `notes-row-spawn-window.md` → `[attempt: 8acdcc3d-17ab-471c-9525-0cce86606e3d row-spawn-window]` (line 2)
- `notes-row-admission-align.md` → `[attempt: 8acdcc3d-… row-admission-align]` (line 1)
- `notes-row-task-namespace.md` → `[attempt: 8acdcc3d-… row-task-namespace]` (line 1)

## §4 Verification runs (this session)

### 4a. Red-first confirmed at the pre-change base (fc9733ff, throwaway worktree)

Copied the rows' exact pin files (byte-identical SHAs to the row states) into a clean base
worktree and ran all three together: **6 fail / 3 pass** — every red-pin row RED at pre-change
head, and the green-guard rows pass at base exactly as the row notes claim:

| pin | base (pre-change) | row state |
|---|---|---|
| A1 admission refusal naming byte counts | FAIL | PASS |
| A2 strict rendered-objective boundary | FAIL | PASS |
| A3 64KiB+1 → workflow_objective_ref_invalid (guard) | PASS | PASS |
| SW-1 failed-phase w/o evidence defers | FAIL | PASS |
| SW-1b persistent streak confirms (guard) | PASS | PASS |
| SW-2 double-spawn bound, no kill | FAIL | PASS |
| SW-3 typed cause immediate (guard) | PASS | PASS |
| #200 distinct keys → distinct task ids | FAIL | PASS |
| #200 back-compat same-key re-drive | FAIL | PASS |

### 4b. Pin suites green at each row state

| row | pin suite run | result |
|---|---|---|
| row-spawn-window | `node --test test/spawn-window-red.test.mjs` | 4/4 pass (546 ms) |
| row-admission-align | `node --test test/objective-admission-align-red.test.mjs` | 3/3 pass (3.4 s) |
| row-task-namespace | `node --test test/wave-task-namespace-red.test.mjs` | 2/2 pass (8.4 s) |

### 4c. Batteries unchanged at every row state

Battery suite files byte-identical at base and at all three row states (SHA table §1). Fresh
runs at row states — all green:

| row state | suites run | result |
|---|---|---|
| row-spawn-window HEAD | coordinator 58/58 · wave-driver 10/10 · workflow-as-data 31/31 · DSL pair 47/47 | all pass |
| row-admission-align state | workflow-as-data 31/31 · coordinator+wave-driver 68/68 | all pass |
| row-task-namespace HEAD | coordinator+wave-driver+workflow-as-data 99/99 | all pass |

## §5 Per-row verdicts

| row | verdict | basis |
|---|---|---|
| row-task-namespace (#200) | PASS | pin 2/2 green at HEAD `8599e782`, RED at base; derivation folds waveId only when present (ordinary runs byte-unchanged, back-compat pin green); batteries green-unchanged; judgment calls recorded (fix site = application.mjs start(), same-key leg asserts store truth) |
| row-admission-align (#207) | PASS | pin 3/3 green at settled state, RED at base; admission refusal names both byte counts, typed workflow_spec_invalid; D5 envelope untouched (A3 guard); contract-2 judgment call recorded (64KiB stays the envelope; effective ceiling = run cap — client-leg nonempty makes OQ5 spill unreachable); batteries green-unchanged |
| row-spawn-window (#199) | PASS | pin 4/4 green at HEAD `84704bf8`, RED at base; terminal evidence = typed cause only, streak-confirmed by evidence count (3 sweeps, 3794b583 pattern, no clocks); double-spawn bound to same member (generation advance, never a new claim — SW-2 pins claims.length 1); batteries green-unchanged |

## §6 Judgment calls recorded (coordinator)

1. Marker line `PHANTOM-ROOT-VERIFY v1` carried verbatim (harvest requirement) — the line names
   the verification run, not the outcome; the verdict is PASS (see §5).
2. The admission-align row settled with its implementation in the working tree (snapshot
   `9f3d766f` holds only the pin file; the interpreter change and final pin edits were
   uncommitted on settle). Verification ran against the settled working-tree state — the exact
   state the wavefile harvest reads — not the stale snapshot; that state is green (3/3).
3. `gh` unauthenticated: issue texts were not fetchable; each row grounded its contract in
   repo-committed evidence (contract-members.md D2.1; wave pack; surface fix). No authority
   ambiguity arose in verification — the closed contracts, red-first pins, and battery
   immutability are all directly observable and measured here.
4. No row required a DECISION_REQUEST (none of the rows reported one; each recorded its
   judgment calls in its notes, all within the closed contracts).

## §7 Cleanup / scope

No source was edited by the coordinator. The throwaway base worktree used for the red-first
re-run was removed (`git worktree remove --force` + prune). All deliverables and this report
live inside the assigned path scope `docs/reference/evidence/phantom-root-2026-08-15/wave-h/**`.
