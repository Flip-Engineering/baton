IMPL_RESULT_ACCESSOR-VERIFY v1
[attempt: 17eb06f7-d549-40d7-aa2e-99ce5e1cb0b5 coordinator]
Status: GROUNDED — awaiting row-result-accessor settle signal (signalOnMembersDone, pinned #175 semantics).
Baseline sections below are measured and final at this writing; §Verdict/§Measured/§Spot-audit are
completed when the row settles and its notes are read on disk (#174 law). This header block is
replaced then.

# impl-result-accessor wave-c (redrive2) — coordinator verification notes

Coordinator: wave `impl-result-accessor-2026-08-14-wave-c` (waveId `wave:918e87b33d6e258107053aa5fb23f2a8`,
started seq 113883), member `coordinator` (this worktree `ws-2c91835d…`, worker `w-549`, attempt
`17eb06f7…`). Row under verification: `row-result-accessor` (worker `w-550`, run
`run-3187aaaba58310b5fe3be64a58b311d4`), contract: `impl/test/harvest-accessor-red.test.mjs`
(#99 + #179 — the run.result()/waves.harvest materialization surface). Verification law: the
#174 paraphrase in the coordinator brief — verify on disk in sibling worktrees `../../wt/ws-*/`;
silence is not death; read the row's notes file. Signal: `signalOnMembersDone row-result-accessor`
(pinned #175 semantics — I am the remaining member). gh is not used; all evidence below is
grounded in the code and suite runs.

## Row identity (from the coordination event log, cited)

- `seq 113883` `wave.started` — roster `["coordinator","row-result-accessor"]`, idempotency
  `impl-result-accessor-2026-08-14-wave-c`.
- `seq 113887/113888` — coordinator task `baton-b35f899067aaa3d1455d4de7-work` claimed by
  `w-549` (deepseek/deepseek-v4-flash/high) → this worktree.
- `seq 113894` `steering.registered` — row route `run-3187aaaba58310b5fe3be64a58b311d4`,
  waveRole `row-result-accessor`, deepseek/deepseek-v4-flash/high.
- `seq 113898/113899` — row task `baton-b45cc9451a0e1ef4ddca925d-work` claimed by `w-550`.
- Row worktree identified on disk: `../../wt/ws-2a24f9dc708ece2be2288e581562442c` (HEAD
  `093da603` — the v20 re-drive pack that seeded `redrive2/` briefs; base `5ae2c7e5` upstream).
  At this writing its `impl/src/application.mjs` has no `run.resultpin`/`waves.harvest` seam and
  no `redrive2/notes-row-result-accessor.md` exists yet — the row has not settled.

## Suite immutability baseline (sha-256, my tree at base `5ae2c7e5`)

- `impl/test/harvest-accessor-red.test.mjs` — f9e6f0578095e16ca58265c680abde01b8e962560b887ce6036aea4380a9a427
- `impl/test/wave-observability-red.test.mjs` — d32c7f347ce3e1506a79229e6a56e6245817a51093c972179f37125e0e306d97
- `impl/test/waves-list-scaling-red.test.mjs` — 9e1ac2d806718bf10bc2ba3d29ed671435bca96cbd6db495c9c7e399aa5c0086
- `impl/test/event-log-read-scaling-red.test.mjs` — 2bf46b7daafb19eeda7a3e0ae9c31cda8946f8a0f4a25c97c28486331b6fe32d

The suites are immutable; green must be earned by the impl, never by suite edits. The row's tree
must keep these byte-for-byte.

## Measured baseline at base `5ae2c7e5` (run from repo root)

`node impl/scripts/run-suite.mjs impl/test/<file>`:

| suite | tests | pass | fail | expected at base |
|---|---|---|---|---|
| harvest-accessor-red | 39 | 5 | 34 | RED at named stages (ports absent) — CONFIRMED |
| wave-observability-red | 30 | 30 | 0 | green 30/30 — CONFIRMED |
| waves-list-scaling-red | 1 | 1 | 0 | WLS-1 green at base (fixed by 85519556) — CONFIRMED; brief's "RED-by-design" caution: name it, don't absorb it |
| event-log-read-scaling-red | 2 | 2 | 0 | green 2/2 — CONFIRMED |

harvest-accessor-red RED-at-base split: 5 guards green (I2-cli-negative, I5-cli-episode,
I6-conformance, M1-static, M2-static); every capability row fails at its NAMED stage with
`application_command_unavailable` (ports absent) — e.g. A1 `run.resultpin` dispatch,
E1 `waves.harvest` receipt, H1 tools, I1 CLI verbs, N2 pre-gate. This is the contract's expected
start; the row's impl must turn the named stages green by correct implementation only.

## Pending (written on settle)

- VERDICT (sound / needs-fold with blockers) + measured post-impl counts + anything not green
  and why.
- Adjacents green-unchanged re-measurement (wave-observability-red 30/30, waves-list-scaling-red
  1/1, event-log-read-scaling-red 2/2).
- Spot-audit of two stages against the code (green earned by impl, never suite edits).
- DECISION_REQUEST on authority-class ambiguity.

---
Execution contract: reviewer executable `true`, argv `[]`, cwd `.`, expected exit 0 — passes
unchanged.
