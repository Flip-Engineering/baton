# IMPL_RESULT_ACCESSOR-VERIFY v1
[attempt: cbfc2f74-fafb-4bbc-9f1e-b1846bdb624e coordinator]
wave: impl-result-accessor-2026-08-14-wave-a
verifier: coordinator (remaining member, pinned #175 semantics)
verified: 2026-08-14

## VERDICT: needs-fold with blockers

The single row under this coordinator — **row-result-accessor** — did NOT settle. The
acceptance cannot be green because the surfaces the contract pins do not exist at HEAD.

**Primary blocker: the row never landed.** Per the #174 law I verified on disk across all
sibling worktrees (`../../wt/ws-*/`, 47 wave worktrees scanned): no
`notes-row-result-accessor.md` exists in this worktree or any sibling; no `[attempt:]` marker
from the row anywhere; `impl/src/application.mjs` carries no `run.resultpin` / `waves.harvest`
surface; every wave worktree sits at the wave base `09200e9` with a clean tree
(`git status --porcelain` empty, `git rev-parse HEAD` = `09200e97…`). Silence is not death —
`not-landed` is recorded, not `dead`, and the disposition is escalated below.

## Signal status

`signalOnMembersDone row-result-accessor` (wavefile line 22) names the WATCHED row; per #175
the coordinator is the remaining member. On disk there is no row result to corroborate the
signal with — the row left no notes file, no implementation commit, and no worktree delta.
Per the #174 law the signal is therefore treated as "the wave has reached my turn; verify on
disk" — and the on-disk truth is that the row produced nothing. Recorded, not fabricated.

## Measured acceptance counts (run from the repo root)

### Primary suite — `impl/test/harvest-accessor-red.test.mjs` (`node --test` at the wave base)
- Completed tests at verdict time: **5 / ~39, all FAIL at their named stages** (measured):
  - `A1-resultpin-dispatch` (stage: ports absent) — FAIL
  - `A2-harvest-dispatch` (stage: ports absent) — FAIL
  - `A3-resultpin-closure` (stage: ports absent) — FAIL
  - `A4-harvest-closure` (stage: ports absent) — FAIL
  - `B1-stale-base` (stage: projection absent) — FAIL
- The full run is fleet-starved (sibling waves run concurrent suites in parallel; after
  ~1.5 h wall-clock the run had completed 5 of 39 tests and was stopped as impractical —
  each test's ceremony is starved ~100×). The remaining stages are deterministically RED by
  the spot-audit below — every surface the suite pins is absent from the code — with the
  guard rows green by the same audit. **The suite is NOT green at any named stage.**
- Suites are immutable: `git diff HEAD -- <suite>` is empty (all four suites at HEAD, unedited).

### Adjacent suites (measured, complete)
- `wave-observability-red`: **29 / 30 pass** — NOT the 30/30 the row brief expected.
  - `A6-4` (D5.2 web dispatch): web body returns `temporarily_unavailable` for a ghost-run
    `waves.list` where the facade/MCP return `wave_not_found`
    (`wave-observability-red.test.mjs:1018`). Deterministic, pre-existing at the wave base
    `09200e9`, unchanged by this wave (no impl landed). gh is unauthenticated in this
    worktree so I could not confirm an existing tracking issue.
- `waves-list-scaling-red`: **1 / 1 pass** (WLS-1). Not RED-by-design in this run — the
  roster-index pin is green at `09200e9`. Named, not absorbed.
- `event-log-read-scaling-red`: **2 / 2 pass** (ELRS-1, ELRS-2) — matches the brief.

## Spot-audit — two stages against the code (green must be earned by the impl, never suite edits)

### Stage A — HA-01 `ports absent` (Section A: A1-A4)
- Suite pins: `run.resultpin` / `waves.harvest` must dispatch as DIRECT ports, reaching the
  host policy seam (`application_unauthorized` for a shape-valid call; the commands' own
  `application_*_invalid` codes for shape failures — never `application_command_unavailable`).
- Code truth (audited): `APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:170`) contains
  neither key; `_commandDispatch` (`application.mjs:12613+`) has no `run.resultpin` /
  `waves.harvest` branch; `validateApplicationCommandArgs` (`application.mjs:1846-1848`)
  throws `application_command_unavailable` for a missing table entry. Live check:
  `run.resultpin` → `application_command_unavailable`, `waves.harvest` →
  `application_command_unavailable`.
- **RED is EARNED** — the ports genuinely do not exist. The measured A1-A4 failures match
  exactly this mechanism.

### Stage I — HA-09 `CLI verb absent` (Section I: I1/I3/I4)
- Suite pins: `parseBatonCli(['run','resultpin',RUN_ID])` → `run.resultpin`;
  `parseBatonCli(['waves','harvest',…])` → `waves.harvest`; `CLI_WEB_COMMANDS` gates both
  keys; `APPLICATION_SEMANTIC_REGISTRY` carries the two canonical rows.
- Code truth (audited): `application-cli.mjs` `CLI_WEB_COMMANDS` (lines 16-33) lists neither
  key; `parseBatonCli` has no resultpin/harvest branch (zero matches for
  `resultpin|waves.harvest` across `application-cli.mjs`); `application-semantics.mjs`
  `canonicalOperations` has no `run.resultpin` / `waves.harvest` rows (`run.result` is the
  occupied `run.episode` spelling, untouched). Live check: I3 false for both; I4 false for
  both; the I2 negative guard (four malformed spellings) and I5 episode guard
  (`run result` → `run.episode`) both pass as the suite expects.
- **RED is EARNED** — the CLI surface is genuinely absent.

### Guard-stage confirmation (what the suite says is green today stays green)
- M1: neither key in `APPLICATION_COMMAND_DEFINITIONS` — true. M2 sorted-key literals —
  suite self-check. I6 conformance — `surface-conformance: ok` (exit 0). I2/I5 — pass
  (live-checked above).

## Not green and why
1. `harvest-accessor-red` — every named stage RED: the row's implementation is absent
   (blocker #1).
2. `wave-observability-red` 29/30 — A6-4 fails at the wave base (pre-existing, unchanged).

## DECISION_REQUEST — authority-class ambiguity

**Question:** The single row under this coordinator (row-result-accessor) never landed — no
notes file, no implementation, no attempt marker in any sibling worktree. The row's
acceptance suite stays RED at every named stage until the accessor surfaces exist. The
disposition of a wave whose only row produced nothing is authority-class; I cannot decide
alone whether to (a) **fold** — re-drive row-result-accessor on the same contract so the
surfaces land and the suite can go green, or (b) **conclude** the wave as-is with the row
recorded not-landed and the acceptance red, or (c) another disposition the operator assigns.

**Options (for the answering authority):**
- **A (recommended): fold** — a fresh `row-result-accessor` attempt on the same
  `harvest-accessor-red` contract; the suite is the immutable contract and the file
  partition (`impl/src/application.mjs` additive seam + `application-cli.mjs` /
  `mcp-northbound.mjs` / `application-semantics.mjs` only where the suite's pins name them)
  is unchanged. This coordinator's verify-notes then re-runs.
- **B: conclude** — accept the wave as closed with the row not-landed; document the red
  acceptance as the measured state (this note is that record).
- **C: operator disposition** — assign otherwise.

Requested by: coordinator `[attempt: cbfc2f74-fafb-4bbc-9f1e-b1846bdb624e]`, verified on
disk 2026-08-14. No fabricated clock, no fabricated signal.
