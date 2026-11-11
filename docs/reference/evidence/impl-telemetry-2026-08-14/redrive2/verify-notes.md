IMPL_TELEMETRY-VERIFY v1
[attempt: 7663f995-5032-4aad-be5e-dd8a06fd31f5 coordinator]
Status: GROUNDED — row-telemetry is mid-impl in sibling worktree (partition files dirty, notes
not yet written); §1–§4 are measured and final at base 5ae2c7e5; §5 (verdict, row counts,
spot-audit) is written on settle. This is the REDRIVE-2 grounding: every number below was
re-measured this session at this base by me; nothing is carried from redrive1's notes without
re-measurement (and one redrive1 anchor-set is re-derived below after a measurement pitfall).

# impl-telemetry redrive2 — coordinator verification notes

Coordinator: wave `impl-telemetry-2026-08-14-wave-c`, member `coordinator` (this worktree
`ws-c7944a399093520f243d39735275d76c`, base `5ae2c7e5`). Row under verification:
`row-telemetry` (glm-5.3, worktree identified on disk: `ws-06061e8a898e163496a840272f627b5f` —
first sibling to dirty the partition files `impl/src/application-deployment.mjs`,
`impl/scripts/baton.mjs`, and create `impl/src/readiness-projection.mjs`). Contract:
`impl/test/seat-telemetry-red.test.mjs` (#146) + `impl/test/readiness-honesty-red.test.mjs`
(#167), plus the #218 queue-read addendum. Verification law: #174 paraphrase in the coordinator
brief — verify on disk in sibling worktrees `../../wt/ws-*/`; silence is not death; read the
row's notes file. Signal: `signalOnMembersDone row-telemetry` (pinned #175 semantics — I am the
remaining member). gh is unauthenticated in this worktree; all evidence is grounded in code and
suite runs, none in GitHub.

## §1 Suites read, immutability baseline (SHA-256, first 16 hex, this session at 5ae2c7e5)

- `seat-telemetry-red.test.mjs` 301349633f491749 — byte-identical to redrive1's recorded SHA
- `readiness-honesty-red.test.mjs` 44ada6edeb8939cf — identical
- Adjacents: deepseek-routes-red 85cc05825b5a9301 · glm-session dcb97cf8387efd77 · adapter
  86611ab73b61b005 · cli-adapters 1f6f072117b144b4 — all identical
- Row partition files at base: application-deployment.mjs c3018c3e179e5375 · baton.mjs
  340ff2fd84cb9fde — identical to redrive1's; the four commits 09200e9..5ae2c7e5 did not touch
  any of the above (verified `git diff --stat 09200e9..5ae2c7e5`).

The row's tree must match these byte-for-byte at settle — suites are immutable; green is earned
by impl only.

Stage inventories (suite headers, confirmed by run):
- seat-telemetry: 14 tests — RED rows A1–A11 at named stages (`doctor-seats-missing`,
  `capacity-deferred-missing`, `waves-capacity-missing`, `seats-freshness-label-missing`,
  `surface-teaching-missing`, `capacity-inflight-missing`, `inFlightRevision-missing`), A-L the
  fixture-lint GREEN GUARD.
- readiness-honesty: 17 tests — 9 RED rows (A1a/A1b/A1c/A2/A3/A4/A5/A6/V-stale), 8 PIN rows
  (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) green at HEAD, must STAY green.

## §2 Measured baseline at base 5ae2c7e5 (my tree, clean, run from repo root)

`node --test impl/test/<suite>.test.mjs`:

| suite | tests | pass | fail | at base |
|---|---|---|---|---|
| seat-telemetry-red | 14 | 0 | 14 | all rows RED; A-L guard ALSO fails (§3.1) |
| readiness-honesty-red | 17 | 8 | 9 | 8 pins green / 9 red rows — matches header split |
| deepseek-routes-red | 4 | 4 | 0 | green |
| glm-session | 11 | 11 | 0 | green THIS run — the GL2 race flake recorded by redrive1 did not reproduce (see §4) |
| adapter | 42 | 42 | 0 | green |
| cli-adapters | 24 | 24 | 0 | green |

## §3 Structural findings (re-measured independently at 5ae2c7e5)

### §3.0 Measurement pitfall, recorded for the record

`application.mjs` and `coordination-store.mjs` contain NUL bytes (the readiness-honesty suite
header states this explicitly and scopes its source scans to the NUL-free inventories).
Plain `grep -n` on `application.mjs` treats it as binary and returns NOTHING — my first anchor
sweep falsely suggested redrive1's anchors were stale. Re-run with `grep -an` (text-forced):
the anchors exist and are simply line-shifted by the +53 net lines of 85519556/8ec52a6c. All
application.mjs anchors below are text-forced greps at 5ae2c7e5.

### §3.1 The A-L green-guard premise is destroyed by operator ruling #221, which is in the base

Re-verified at 5ae2c7e5, independently:
- `git log -S deferTaskDispatch -- impl/src/coordinator.mjs` → last touch `a3e96e88`
  "fix(#221): RIP OUT the invented seat-ceiling pre-cap — operator ruling", an ancestor of base
  (git log). Text-forced grep for `deferTaskDispatch` in coordinator.mjs: zero call sites — the
  mint has no caller.
- Measured this session: A-L fails `Error: timeout waiting for ceiling-skip receipt minted`
  (12.5s); A2 fails `timeout waiting for beta ceiling-skipped receipt` (10.7s) — the suite waits
  on a `task.dispatch_deferred` event the base machinery never mints.
- Consequence unchanged: A-L (a GREEN GUARD) and A2's premise are unsatisfiable at this base
  without re-adding coordinator.mjs receipt minting — contradicting #221 and outside the row's
  partition.

### §3.2 The suites demand edits in files the row brief forbids (anchors re-measured at 5ae2c7e5)

Row partition: `application-deployment.mjs` + `impl/scripts/baton.mjs` + NEW modules the suites
name + this evidence tree. Forbidden: `application.mjs`, `workflow-*.mjs`, the northbounds.
Measured anchors (text-forced):
- `waves.list` dispatch → `waveList` at application.mjs:12772 (`if (name === 'waves.list')
  return this.waveList(...)`); wave-row roster construction around :11925 region. A2/A3/A9-1
  anchor here (the suite itself cites "application.mjs:11811-11818"). OUT of partition.
- `BatonApplication.doctorReadiness` defined at application.mjs:12593; the openHost fixtures
  build BatonApplication via src/index.mjs. A4/A5/A6/A9-2/A9-3 exercise this path. OUT.
- readiness-honesty A1c (:687+) byte-scans `web-northbound.mjs` (`_handleOperatorRead`,
  confirmed present), `application-cli.mjs` (`doctor()` at :2071), `mcp-northbound.mjs`
  (`_freshDoctorReadiness`/`baton_deployment_doctor`) — northbounds, OUT.
- readiness-honesty A3 imports `projectTypedTerminalCause` from `application-semantics.mjs`
  (suite :79; `PROVIDER_TERMINAL_GUIDANCE` at application-semantics.mjs:2109) — OUT.
- readiness-honesty A4 pins quota classification + re-probe cadence in `route-liveness.mjs`
  (`ensure()` at :132; constants cited by the suite at :13/:17) — OUT.

Earnability by fixture surface therefore matches redrive1's split (I re-derived it from the
suites, not copied): seat-telemetry IN-partition A1/A8/A10 (openBaton deployment fixtures →
BatonDeployment.doctorReadiness/card in application-deployment.mjs), MIXED A5/A7/A11,
OUT A-L/A2/A3/A4/A6/A9-1/A9-2/A9-3; readiness-honesty IN-partition A1a/A1b/A6/V-stale
(+A5's deployment-doctor leg), OUT A1c/A2/A3/A4.

### §3.3 Suite-vs-contract lineage

The suites were authored (attempt ea57954b…) against a pre-#221 world whose contract-146 D1/D2
pins assume #10 deferral receipts are minted. Root cause of §3.1; unchanged by redrive.

## §4 glm-session GL2 — re-measured

glm-session measured 11/11 green at base THIS session (two full runs of the sweep). Redrive1
recorded the GL2 race (`resource.provider_call`/`content.message` landing before the
model_mismatch crash is observed) failing once in three runs. My runs did not reproduce it; the
flake classification (non-deterministic event race, present at base, NOT attributable to the
row) stands on redrive1's three-run evidence plus my two non-reproducing runs. Per the
failing-test law: not fixable in this verifier's scope (read-and-run + this evidence tree);
flaky-issue check/file IMPOSSIBLE — gh unauthenticated (verified: `gh issue list` refuses,
"please run gh auth login"). This note remains the tracking artifact; recommend a `bug`-tagged
flaky issue once auth exists.

## §5 Row verification (written on settle)

PENDING — row-telemetry is mid-impl in `ws-06061e8a…` (measured: application-deployment.mjs
+80/−11, baton.mjs +7, readiness-projection.mjs new; no notes file yet as of this grounding).
A watcher polls the siblings for `notes-row-telemetry.md`; settle also arrives as the
signalOnMembersDone message. On settle: run both suites + four adjacents FROM THE ROW'S TREE,
spot-audit two stages against the row's code, record measured counts and the #218 queue-read
check, then finalize the verdict below.

### §5.x DECISION_REQUEST (authority-class ambiguity) — carried, re-grounded at 5ae2c7e5

The acceptance ("both suites green at every named stage; adjacents green-unchanged") cannot be
met by ANY correct row impl inside the row's partition at base 5ae2c7e5 (§3.1, §3.2 —
re-measured). Options:

- **Option A — re-scope acceptance to the row's real partition.** Judge on in-partition stages
  only; require out-of-partition rows to stay RED-at-named-stage (proving no suite edit); pins
  stay green; adjacents unchanged; #218 queue read lands regardless. Out-of-partition stages
  re-driven by a later wave that owns application.mjs / northbounds / coordinator.
- **Option B — widen the row's partition** (application.mjs, mcp/web northbounds,
  application-cli.mjs, application-semantics.mjs, route-liveness.mjs). Contradicts "other waves
  own them this window"; multiplies conflict risk across ~17 live sibling worktrees.
- **Option C — restore #10 deferral receipts in coordinator.mjs** to satisfy A-L/A2. Directly
  contradicts operator ruling #221 (in-base `a3e96e88`); requires operator authority.

Recommendation: **Option A** (#221 binding; Option C is not ours to make). The verdict in §5 is
written under Option A semantics unless the operator rules otherwise before settle.
