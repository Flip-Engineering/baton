# #163

[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 row-bt163]

**Shared-publish durable fallback.** The live `shared` scratchpad append verb does not exist at HEAD
`e371f70` (facade dispatch exposes only `run.scratchpad.read` / `run.scratchpad.elevate`,
`application.mjs:12522-12523`; no `run.scratchpad.append` branch anywhere in `impl/src/`). The live
publish FAILED; this refusal is the evidence, recorded per the frame. This file is the coordinator
brief's documented durable-fallback channel, placed inside this row's write scope
(`docs/reference/evidence/blue-team-2026-08-13-b/**`).

Full report: [`../blueteam-163.md`](../blueteam-163.md) in this directory.

## One-line verdict

**NEEDS-FOLD** — named rows **R2** (pin `term.role === 'q-a'`; the totality-rule attribution is
unpinned), **R3** (assert the B3 projection form, not identifier presence), **R4c / R4d**
(region-scope to the reset-set and to `normalizeDriver` + the loop condition), **N3** (the A9/G8
re-wake leg is unpinned); class note on R4a/R4b/R4e/R6 existence-anchor statics. Core composition
R1+R2+N2+N1+P1+P2 is SOUND.

## Split record

Four runs at HEAD `e371f70` (two initial + two incremental re-runs): **15 tests / 3 pass / 12
fail**, byte-identical row sets every time, matching the declared notes (`suite-notes-163.md`).
Green today: P1, P2, N1 (by design). Red at their named stages: R1–R6, N2, N3.

## Per-row verdicts

| Row | Verdict | Cheapest wrong impl (or bite) |
|---|---|---|
| R1 | SHALLOW | Relabel-on-quiet at the verdict seam; no cadence window, confirmation poll, or three-leg predicate needed |
| R2 | SHALLOW | Any-member `wave_terminalized_unrecoverable` line at loop exit; **role not pinned** — a wrong impl may terminalize the quiet member and pass |
| R3 | SHALLOW | Dead `lastProgress/silenceMs/progressClass` fields or a comment; projection need not be wired to `io` |
| R4a | SHALLOW | Dead module-scope constants / comment |
| R4b | SHALLOW | Dead `ACTIVE_TURN_PHASES` set that gates nothing |
| R4c | SHALLOW | Comment / dead array listing the four REARM_KINDS literals |
| R4d | SHALLOW | No-op `if (driver.hardCapMs === null)` branch or comment |
| R4e | SHALLOW | Dead constants / comments satisfying each literal |
| R5 | SHALLOW | Loop-exit line; DR-1(a) hard-break TIMING unpinned (continue-to-completion and hard-break yield byte-identical receipts) |
| R6 | SHALLOW | Literal edit to `hardCapMs: null` with another clock alive elsewhere |
| N1 | SOUND | Kills the non-gated predicate under `LANE_DRIVER`; only the null-gate passes N1+N2 together |
| N2 | SOUND | Kills the bare-constant window; `s400≥650`, `s800≥1450`, `s800>s400+300` force cadence scaling (2× exact multiplier not pinned — minor precision note) |
| N3 | SHALLOW | Re-wake leg only bites declare-too-early; fails to stop members still passes (parked member emits nothing post-park) |
| P1 | SOUND | Kills lane-policy change / happy-path break / receipt-key drift |
| P2 | SOUND | Kills the pure-silence relabel (p2-a is `blocked_interaction:*`, not a candidate) and a dropped stuck-decision steering entry |

Law re-check: all frame laws PASS (named stages, hermetic, no clocks as controls, namespace
imports, sorted-key literal in codepoint order, watchdog.stallMs 60_000 + comment, no absolute
line-window anchors, verbatim suite attempt line, split stability). Full table in the report.
