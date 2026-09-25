GATE_DIGEST-VERIFY v1
[attempt: dec9541d-ca01-40f1-a6bd-25e4081aa30f coordinator]
Wave: impl-gate-digest-2026-08-14-wave-d (redrive3)
VERDICT: needs-fold with blockers
Scope: docs/reference/evidence/impl-gate-digest-2026-08-14/redrive3/**

## Summary

The row `row-gate-digest` settled — the `signalOnMembersDone` result message ("The row settled …
pinned #175 semantics") was delivered to me as the remaining member — but the redrive again
produced **no on-disk deliverable**: no `notes-row-gate-digest.md` at the wavefile's report/harvest
path, no digest implementation in `impl/scripts/run-suite.mjs`, no fixture, no seeded-failure
self-check. Per the #174 law (silence is not death; read the row's notes) I read the row's notes on
disk — there are none, at either the row brief's path or the wavefile's report path. Every
acceptance criterion in `row-gate-digest-brief.md` is unmet. This is the **third consecutive drive**
(wave-a → wave-b/redrive1 → wave-d/redrive3) with the identical zero-work-product failure mode; the
gate digest (#149) remains entirely unimplemented.

## Verification evidence (all repo-grounded)

- **E1 — Row notes absent at every named path.** The wavefile report/harvest target
  `docs/reference/evidence/impl-gate-digest-2026-08-14/redrive3/notes-row-gate-digest.md` does not
  exist. The row brief names the non-redrive path
  `docs/reference/evidence/impl-gate-digest-2026-08-14/notes-row-gate-digest.md` — also absent.
  Repo-wide `find` for `notes-row-gate-digest*` returns nothing (only prior `verify-notes.md` files
  for wave-a and redrive1/2 exist). The redrive3 evidence dir holds exactly three files:
  `coordinator-brief.md`, `impl-gate-digest.wavefile`, `row-gate-digest-brief.md`.
- **E2 — Runner unchanged.** `git diff --exit-code HEAD -- impl/scripts/run-suite.mjs` is clean;
  `md5` of `run-suite.mjs` at HEAD equals the md5 at the base commit `3560c93d`
  (`f3f6e8787d3aadf40ae88a378b75a49c`). `grep -n digest impl/scripts/run-suite.mjs` → 0 matches. I
  read the runner in full: it has no `--digest` (or any) flag handling — line 105 forwards
  `process.argv.slice(2)` verbatim to the underlying `node --test`. The row's file partition is
  byte-identical to the wave base.
- **E3 — Acceptance command fails, before flag handling.** `node impl/scripts/run-suite.mjs --digest`
  exits **1** with prose stderr only:
  `surface-conformance: novel divergence: mcp.web-bridge:<tool>.name` findings. The runner's
  surface-conformance gate (lines 35–43: `if (surfaceFindings.length > 0 || enumFindings.length >
  0) process.exit(1);`) fails before the `node --test` spawn at line 105, so `--digest` never
  reaches the child. **No digest is written or printed.** This drive's failure mode differs from
  wave-a/redrive1 (exit **9**, `bad option: --digest`) because this worktree's gate trips on a
  pre-existing surface divergence first — but the acceptance criterion fails identically.
- **E4 — The surface divergence is pre-existing at the wave base, independent of the row.**
  `impl/src/mcp-web-bridge.mjs` is present in the base commit `3560c93d`'s tree. The ledger
  (`impl/scripts/surface-divergence-ledger.json`) contains **0** `mcp.web-bridge` entries at both
  HEAD and base. The snapshot commit `1c2e04ae` (HEAD) changed only
  `impl/test/reap-on-terminal-red.test.mjs` (67 insertions / 39 deletions) — a different wave's work
  in the shared effective tree, not row-gate-digest work, and not the row's partition. The
  divergence therefore exists at the wave base; the gate would fail in this worktree even with a
  correct `--digest` handler. This is an environmental/ledger-staleness state, not a row artifact.
- **E5 — No seeded-failure self-check.** No fixture, no fixture JSON, no `fixture*` directory, and no
  new/missing/unchanged classifier exist anywhere in the redrive3 partition (`find` returned
  nothing). With no code there is no host for a self-check.
- **E6 — Working tree clean; no row commit.** `git status --porcelain` is empty. HEAD is the
  snapshot commit; its only content change vs base is `impl/test/reap-on-terminal-red.test.mjs`,
  which is outside the row's partition (`impl/scripts/run-suite.mjs` + the evidence dir). No
  row-authored commit exists in this worktree's history.
- **E7 — No row work in history or the shared object store.** `git log --all --` over the redrive3
  row report path returns no commit ever touching `notes-row-gate-digest.md`; a blob scan of every
  `run-suite.mjs` blob in `git rev-list --objects --all` finds **0** blobs containing `digest`. The
  row's work does not exist even as an unreferenced commit: it produced nothing, committed nothing,
  left nothing.

## Acceptance check (per row-gate-digest-brief.md)

| Criterion | Result | Evidence |
|---|---|---|
| `--digest` (or named flag) writes/prints per-suite {file, stage, code-class} digest | FAIL | E3: exit 1 before flag handling; E2: no flag handling exists |
| Stable failure-set hash | FAIL | absent (E2) |
| Diff vs accepted baseline (new/missing/unchanged) as DATA | FAIL | absent (E2) |
| DETERMINISTIC digest (sorted keys, no clocks, repo-relative paths) | FAIL | no digest exists to check (E2) |
| Seeded-failure self-check classifies new/missing/unchanged correctly | FAIL | absent (E5) |
| Runner default human output unchanged | vacuous-pass | E2: runner byte-identical to base — nothing changed, so nothing could regress |
| Notes `[attempt: <salt> row-gate-digest]` in first five lines | FAIL | notes file absent at both named paths (E1) |

## Spot-audit of two claims

The row brief's contract requires every claim to cite evidence and requires me to spot-audit two
claims against the repo. The row produced **no claims** — no notes and no code — so there is nothing
of the row's to audit; the only implicit row claims (a digest exists and runs; the row's notes exist)
are directly refuted by E3 (exit 1, no digest) and E1 (absent file). I record this as "no row claims
surfaced; audit is vacuous on an empty deliverable" — consistent with the wave-a and redrive1/2
verdicts. To keep the citation discipline meaningful I spot-audited **two of the row brief's seed
claims** (the only row-side anchors on disk), as the prior drives did:

| Claim (row-gate-digest-brief.md) | Verified on disk | Result |
|---|---|---|
| "the full gate's output is prose" | `run-suite.mjs:105` spawns `node --test` with `stdio: 'inherit'`; the runner's only emissions are prose stderr lines (`fixture-clock-lint:`, `surface-conformance:`, `baton test runner …` at lines 22/32/39/63/71/81/256/261/266) plus the child's human-readable test output. My own run of the command (E3) produced prose stderr only — no machine-readable digest anywhere. | ✓ ACCURATE |
| "orchestrator classifies expected-red vs unexpected failures BY HAND (a 32-file manual classification happened this campaign)" | The hand-classification phenomenon is corroborated: the friction ledger (`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md:120`) records the #105 full-gate acceptance requiring hand-tabulating the failure distribution from a 700KB log (`grep "^✖"` + per-file attribution), citing #149 as the follow-on. The specific **"32-file" count is not independently corroborated** — a repo grep for `32-file` matches only the row-brief copies, never a campaign record. | PARTIAL — phenomenon corroborated; the number is uncorroborated |

The caveat stands as in prior drives: the "32-file" count should not be re-cited as repo evidence by
any future fold without a campaign record; the brief's underlying point (classification is manual
today) is supported by the friction ledger.

## Unverified / why

- **Why the signal fired with no row work product.** The dispatcher reported the row settled, yet no
  row deliverable, row commit, or row work artifact exists in this worktree, in history, or in the
  shared object store (E1/E6/E7). I cannot distinguish a harness dispatch/routing failure from a row
  that silently produced nothing; the dispatcher's internal role→worktree mapping is not observable
  from here. This is the **third consecutive drive** with the identical pattern.
- **Cause of the mcp.web-bridge surface divergence.** The divergence is verifiably present at the
  wave base (E4) and blocks the gate in this worktree before flag handling, but whether the ledger
  is stale relative to `impl/src/mcp-web-bridge.mjs` or the surface was added without a ledger entry
  is not decidable from inside this worktree. It is orthogonal to the digest feature (the row never
  touched it) but worth noting for the operator: any `--digest` run in this worktree state is masked
  by the surface gate.
- **Row-side rationale.** No `notes-row-gate-digest.md` means the row recorded no judgment calls, no
  blockers, no stall reason, and no DECISION_REQUEST. Any row-side rationale is unknowable from the
  repo.
- **Row-brief path drift (persists).** The redrive3 row brief names the notes path as
  `impl-gate-digest-2026-08-14/notes-row-gate-digest.md` (the wave-a path) while the wavefile's
  report/harvest target is `impl-gate-digest-2026-08-14/redrive3/notes-row-gate-digest.md`. Both are
  absent, so the drift does not change the verdict — but it should be reconciled before any re-drive
  so a landing row writes to the harvested path.

## DECISION_REQUEST — authority-class ambiguity

Ambiguity: `signalOnMembersDone` claims the row settled, yet the row left zero work product and no
notes — for the **third consecutive drive** (wave-a, wave-b/redrive1, wave-d/redrive3 show the
identical zero-work-product pattern; the acceptance command now also fails earlier on a pre-existing
surface divergence, E3/E4). Determining *why* (row never dispatched vs. row driven under the wrong
brief vs. row abandonment) and *whether to re-drive a fourth time* is not mine to decide: the
coordinator deliverable is verification only, and I am barred from editing the row's partition
(`impl/scripts/run-suite.mjs`). The gate digest (#149) remains entirely unimplemented after three
drives.

Options:
1. **Re-drive `row-gate-digest` a fourth time** (operator/dispatcher authority) — the feature is
   wholly absent; the wave cannot be admitted as sound without an implementation.
2. **Fold this wave as blocked**, recording E1–E7 as the blockers, and require a re-drive before the
   gate can emit a digest.
3. **Audit the dispatch path first** — investigate why the row member settles with zero work product
   across three drives *before* any re-drive. The repeat of the exact wave-a failure mode is itself
   the anomaly; re-driving into the same silence wastes seats. Additionally note the pre-existing
   surface divergence (E4) that currently masks any `--digest` run in this worktree.

Recommendation: **Option 2 now** (fold with blockers, citing E1–E7), then **Option 3** to audit the
dispatch/routing path before any Option 1 re-drive — the reproducible zero-work-product settlement
across three drives is a harness-behavior signal worth understanding before spending a fourth seat.
