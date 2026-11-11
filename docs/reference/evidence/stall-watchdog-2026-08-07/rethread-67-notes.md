# #67 RETHEAD NOTES — retire the `stallMs: 0` "disable watchdog" test idiom

**Status:** DONE — 83 disable sites re-threaded to a valid positive `stallMs`, 1 refusal site kept.
**Date:** 2026-08-13
**Brief:** `rethread-67-brief.md` (this directory)
**Contract:** `stall-watchdog-contract.md` v1.1 (unchanged by this wave)
**Boundary:** `impl/test/**` only — no `impl/src/**` edits. No clocks. NUL discipline respected
(`application.mjs` / `coordination-store.mjs` never read whole by this wave).

---

## What changed

The #67 impl landed `createDriver`'s deployment-seam admission: `watchdog.stallMs` must be a
positive integer strictly less than the node wall (`DEFAULT_BUDGET.wallMin * 60_000`); a
non-positive or wall-exceeding value refuses with the typed `watchdog_stall_exceeds_wall`. The
pre-#67 test idiom `watchdog: { stallMs: 0 }` ("disable the watchdog for this fixture") therefore
threw at setup in every `createDriver`-based fixture, and silently disabled the watchdog in every
`new Coordinator({...})`-based fixture.

This wave re-threads every `stallMs: 0` DISABLE site to `stallMs: 60_000` (a valid positive
integer, ~1 min, far inside the 480-min wall and larger than every touched suite's runtime, so the
watchdog never fires — the "disabled" semantics are preserved). Each site keeps its other
options (no `stallAction` was invented; `stallAction: 'none'` — outside the contract vocabulary —
is never introduced). A one-line fixture-contract comment is appended to every re-threaded site:
`// valid positive stallMs; watchdog never fires in this window`.

Sites where `stallMs: 0` is the REFUSAL payload (the A3-class row) are **KEPT** — that row is green
BECAUSE the deployment seam refuses the non-positive value.

**Site totals:** 83 re-threaded (`stallMs: 0` → `stallMs: 60_000`) across 24 files; 1 kept
(`stall-watchdog-red.test.mjs` A3); 4 comment-only mentions in `stall-watchdog-red.test.mjs` are
documentation and left as-is. `stall-watchdog-red.test.mjs` is therefore **not edited** — its every
`stallMs: 0` code site is a refusal row.

## Per-file outcome table

Verified from the repo root with `node --test impl/test/<file>` (each file run individually).
Green suites pass; red suites fail at exactly their header's named stages — no row fails at a
`watchdog_stall_exceeds_wall` setup-throw.

| # | file | sites | outcome |
|---|------|------:|---------|
| 1 | phase11-acceptance-integration | 19 | ✅ 25/25 pass |
| 2 | phase11-concurrent-grok-reap | 1 | ✅ 1/1 pass |
| 3 | phase11-coordination-store | 15 | ✅ 30/30 pass |
| 4 | phase11-governance | 11 | ✅ 17/17 pass |
| 5 | phase12-web-northbound | 1 | ✅ 33/33 pass |
| 6 | phase26-structured-merge | 3 | ✅ 16/16 pass |
| 7 | phase50-cairn-scratch-correction | 5 | ✅ 14/14 pass |
| 8 | phase56-drain-and-close | 7 | ✅ 38/38 pass |
| 9 | phase57-adversarial-governance | 1 | ✅ 12/12 pass |
| 10 | phase57-provider-callback-integrity | 1 | ✅ 15/15 pass |
| 11 | phase57-provider-governance | 1 | ✅ 24/24 pass |
| 12 | phase57-provider-turn-release | 1 | ✅ 4/4 pass |
| 13 | phase58-driver-sparse-projection | 1 | ✅ 1/1 pass |
| 14 | phase75-task-topology | 1 | ✅ 20/20 pass |
| 15 | board-workerhalf-red | 1 | ✅ 24/24 pass (feature landed — green) |
| 16 | briefing-pack-red | 1 | ✅ 31/31 pass (feature landed — green) |
| 17 | phase91-semantic-interrupt-preservation-red | 6 | ✅ 25/25 pass (feature landed — green) |
| 18 | reflex2-boards-red | 1 | ✅ 19/19 pass (feature landed — green) |
| 19 | reply-chains-red | 1 | ✅ 26/26 pass (feature landed — green) |
| 20 | workflow-surface-red | 1 | ✅ 37/37 pass (feature landed — green) |
| 21 | harvest-accessor-red | 1 | 🔴 5 pass / 34 fail at named stages |
| 22 | nested-orchestration-red | 1 | 🔴 7 pass / 8 fail at named stages |
| 23 | orchestrator-wake-red | 1 | 🔴 6 pass / 30 fail at named stages |
| 24 | tight-cell-red | 1 | 🔴 9 pass / 30 fail at named stages |
| 25 | stall-watchdog-red | 0 | ✅ 27/27 pass (NOT edited — A3 refusal kept) |

Totals: 83 sites re-threaded, 1 kept, 25 files (24 edited + 1 verified-unedited).

Red-suite named-stage check (the brief's corruption guard): each red suite still fails at its
header's own stages, e.g. `harvest-accessor-red` → `ports absent` / `projection absent` /
`harvest absent` / `tools absent` / `wire vocabulary absent` / `CLI verb absent` / `rows absent`;
`nested-orchestration-red` → `connection-mint-missing` … `orphan-sweep-missing`;
`orchestrator-wake-red` → `attention-wait-command-missing` …; `tight-cell-red` → the
`cell-*-missing` / `group-*-refusal` / `per-*-missing` stages. No setup-throw in any row.

## Sites kept and why

- `impl/test/stall-watchdog-red.test.mjs:565` — the A3 row
  `admissionRefusal({ watchdog: { stallMs: 0 } })`. This `stallMs: 0` is the REFUSAL-test payload:
  the row asserts `watchdog_stall_exceeds_wall` BECAUSE the deployment seam refuses a non-positive
  value. Re-threading it would break the pin. Kept exactly.
- `impl/test/stall-watchdog-red.test.mjs:38, 811, 850, 916` — comment-only mentions of `stallMs: 0`
  (the row-inventory A3 line and the three D1/D2/D5 fixture-contract comments). Documentation, not
  a site; left as-is.

## Verification

- 24 edited files: `node --test impl/test/<file>` — outcomes per the table above (green suites pass;
  red suites fail at their named stages; no `watchdog_stall_exceeds_wall` setup-throw anywhere).
- `impl/test/stall-watchdog-red.test.mjs` (un-edited): 27/27 pass.
- Deployment verification command: executable `true`, arguments `[]`, working directory `.`,
  expected exit `0`.
