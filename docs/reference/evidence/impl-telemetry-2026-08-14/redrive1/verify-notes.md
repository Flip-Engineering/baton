IMPL_TELEMETRY-VERIFY v1
[attempt: d6d859c7-9db8-4a27-9362-2f264f1a3496 coordinator]
Status: GROUNDED — awaiting row-telemetry settle signal (signalOnMembersDone). Sections §1–§4
are measured and final at base 09200e9; §5 (verdict, row counts, spot-audit) is written on
settle. This header block is replaced then.

# impl-telemetry redrive1 — coordinator verification notes

Coordinator: wave `impl-telemetry-2026-08-14-wave-b`, member `coordinator` (this worktree,
`ws-1b1187d205a60c97a6d6a17c39d9f112`, base `09200e9`). Row under verification: `row-telemetry`
(glm-5.3), contract: `impl/test/seat-telemetry-red.test.mjs` (#146) +
`impl/test/readiness-honesty-red.test.mjs` (#167). Verification law: the #174 paraphrase carried
by the coordinator brief — verify on disk in sibling worktrees `../../wt/ws-*/`; silence is not
death; read the row's notes file. Signal: `signalOnMembersDone row-telemetry` (pinned #175
semantics — I am the remaining member). gh is UNAUTHENTICATED in this worktree (verified:
`gh issue list` refuses, "please run gh auth login"); all evidence below is grounded in the code
and suite runs, none in GitHub.

## §1 Suites read in full, immutability baseline

Both contract suites read in full at base. SHA-256 at base `09200e9` (the row's tree must match
these byte-for-byte — suites are immutable, green must be earned by impl):

- `impl/test/seat-telemetry-red.test.mjs` — 301349633f491749f68955ef9c7c5554847beaddba2f72d72308d709fab1735f
- `impl/test/readiness-honesty-red.test.mjs` — 44ada6edeb8939cfb8ac30b2b18ee10d4c82946fbb39040803a930e5282e263d
- Adjacents: deepseek-routes-red 85cc0582…c3efb07 · glm-session dcb97cf8…492eb8 · adapter
  86611ab7…4a6235 · cli-adapters 1f6f0721…cc5fa5d
- Row partition files at base: application-deployment.mjs c3018c3e…cee8480 · baton.mjs
  340ff2fd…2884cf1

Suite stage inventories (from the suite headers, verified by run):
- seat-telemetry: 14 tests — rows A1–A11 RED at named stages (`doctor-seats-missing`,
  `capacity-deferred-missing`, `waves-capacity-missing`, `seats-freshness-label-missing`,
  `surface-teaching-missing`, `capacity-inflight-missing`, `inFlightRevision-missing`), A-L is
  the fixture-lint GREEN GUARD.
- readiness-honesty: 17 tests — 9 RED rows (A1a/A1b/A1c/A2/A3/A4/A5/A6/V-stale), 8 PIN rows
  (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) green at HEAD and must STAY green.

## §2 Measured baseline at base 09200e9 (my tree, run from repo root)

`node --test impl/test/<suite>.test.mjs`, measured this session:

| suite | tests | pass | fail | expected at base |
|---|---|---|---|---|
| seat-telemetry-red | 14 | 0 | 14 | RED (all rows fail at their named stage) — CONFIRMED |
| readiness-honesty-red | 17 | 8 | 9 | 8 pins green / 9 red rows fail at named stage — CONFIRMED, matches the suite header's recorded split exactly |
| deepseek-routes-red | 4 | 4 | 0 | green — CONFIRMED |
| glm-session | 11 | 10 | 1 | NOT green at base (see §4) |
| adapter | 42 | 42 | 0 | green — CONFIRMED |
| cli-adapters | 24 | 24 | 0 | green — CONFIRMED |

Every seat-telemetry red row failed AT ITS NAMED STAGE (assertion messages carry the stage
names) with one exception: **A-L, the suite's fixture-lint GREEN GUARD, also fails at base**
(timeout waiting for `ceiling-skip receipt minted`) — see §3.1.

## §3 Structural findings (measured, cited)

### §3.1 The A-L green-guard premise is destroyed by operator ruling #221, which is IN the base

- Commit `a3e96e8` "fix(#221): RIP OUT the invented seat-ceiling pre-cap — operator ruling" is
  an ancestor of base `09200e9` (git log). It removed the ceiling-skip from
  `coordinator.mjs:_dispatchPass` (verified: `_dispatchPass` at impl/src/coordinator.mjs:2911
  now dispatches unconditionally; the in-code comment cites #221: "Backpressure is
  provider-TRUE now … never a silent synthetic queue").
- `deferTaskDispatch` (the `task.dispatch_deferred` mint, coordination-store.mjs:13261) has NO
  caller in coordinator.mjs at base (`grep -n deferTaskDispatch impl/src/coordinator.mjs` → 0
  hits; `git log -S deferTaskDispatch -- impl/src/coordinator.mjs` names `a3e96e8`).
- The suite's A-L lint (seat-telemetry-red.test.mjs:217-242) and A2's fixture (:296-342) WAIT
  for a `task.dispatch_deferred` event that the base machinery never mints. A-L failed at base
  with exactly `Error: timeout waiting for ceiling-skip receipt minted` (7.3s); A2 with
  `timeout waiting for beta ceiling-skipped receipt` (7.4s).
- Consequence: A-L (green guard) and A2's premise are unsatisfiable at this base without
  re-adding coordinator.mjs receipt minting — which would contradict the #221 operator ruling
  AND fall outside the row's file partition.

### §3.2 The suites demand edits in files the row brief forbids

Row partition (row-telemetry-brief.md): `application-deployment.mjs` + `impl/scripts/baton.mjs`
+ NEW modules the suites name + this evidence tree. Explicitly forbidden: `application.mjs`,
`workflow-*.mjs`, the northbounds (other waves own them this window). Measured anchors:

- `waves.list` capacity block (A2/A3/A9-1): rendered in `application.mjs` (wave rows pushed at
  application.mjs:~11925; handler dispatch `waves.list` → `waveList` at application.mjs:12719).
  Anchor cited by the suite itself: "application.mjs:11811-11818".
- `doctorReadiness` seats for the BatonApplication path (A4/A5/A6/A9-2/A9-3 call
  `host.application.doctorReadiness()` on `BatonApplication`): defined at
  application.mjs:12540.
- readiness-honesty A1c/A2 (and seat-telemetry A5/A7/A11): byte-scans of `web-northbound.mjs` (`_handleOperatorRead`),
  `application-cli.mjs` (`doctor()`), `mcp-northbound.mjs` (`_freshDoctorReadings`/
  `_freshDoctorReadiness`, `baton_deployment_doctor` tool text) — northbounds, forbidden.
- readiness-honesty A3: `PROVIDER_TERMINAL_GUIDANCE` + `projectTypedTerminalCause` in
  `application-semantics.mjs` — not in the partition.
- readiness-honesty A4: quota classification + no-auto-re-probe in `route-liveness.mjs`
  `ensure()` — not in the partition.

Consequence: "both suites green at every named stage" is unsatisfiable within the row's
partition at this base even setting §3.1 aside. Row-by-row earnability (by fixture surface):

- **seat-telemetry IN-partition (openBaton deployment fixtures → BatonDeployment.doctorReadiness
  at application-deployment.mjs:1333 / card at :1375): A1, A8, A10.** These the row can
  genuinely earn. (A1's card-inheritance leg, A8's additive-posture + occupancy-null
  correction, A10's occupancy===seats single-source — all on the deployment class.)
- **seat-telemetry MIXED (three-file source scans spanning application-deployment.mjs AND
  mcp-northbound.mjs AND application-cli.mjs): A5, A7, A11** — 2 of 3 scanned files are
  northbounds; not fully earnable in-partition.
- **seat-telemetry OUT entirely: A-L, A2 (§3.1 receipt premise), A3, A9-1 (application.mjs
  waveList rows ~:11925), A4, A6, A9-2, A9-3 (application.mjs BatonApplication.doctorReadiness
  :12540 — the openHost fixtures build BatonApplication via src/index.mjs).**
- **readiness-honesty IN-partition (openBatonDeployment fixtures → application-deployment.mjs,
  fleet.roster facade :1324): A1a, A1b, V-stale (enumerable verdict/probedAt composition on the
  deployment doctor/roster rows), A6 (#livenessGate scans application-deployment.mjs only).**
  A5 is behaviorally in-partition on the doctor row but its preflight leg may require
  wave-driver.mjs verdict consultation (out) — judged on settle.
- **readiness-honesty OUT: A1c, A2 (northbound + application-cli scans), A3
  (application-semantics.mjs), A4 (route-liveness.mjs quota class + no-auto-re-probe).**

### §3.3 Suite-vs-contract lineage note

contract-146.md (v1.1 fold, verified at HEAD `e371f70`) predates the #221 rip-out; its D1/D2
pins assume the #10 durable deferral receipts are being minted. The suites (attempt
`ea57954b…`) were authored against that pre-#221 world. This is the root of §3.1.

## §4 glm-session GL2 flake (adjacent, failing-test law)

`glm-session` is 10/11 at base: `GL2: exact GLM dispatch rejects a different wire-observed
model before accepting provider output` (glm-session.test.mjs:165) failed in the full-suite run
and in isolated run 1, PASSED in isolated runs 2 and 3 (`node --test --test-name-pattern GL2`:
fail, pass, pass). Failure mode: the `resource.provider_call`/`content.message` event lands
before the model_mismatch crash is observed (:181 `c.events.some(...) === false` assert) — a
race, non-deterministic. Actions per the failing-test law: fix/root-cause — NOT mine to make
(this verifier's scope is read-and-run plus this evidence tree; the adjacent belongs to other
waves); flaky-issue check/file — IMPOSSIBLE here, `gh` unauthenticated (verified above).
Recorded here as the tracking artifact; recommend a `bug`-tagged flaky issue once auth exists.
This flake is NOT attributable to the row (present at base, row partition excludes
glm-session surfaces).

## §5 Row verification (written on settle)

PENDING — row-telemetry has not settled: no `notes-row-telemetry.md` and no in-partition impl
changes exist in ANY sibling worktree `../../wt/ws-*/` as of this grounding (verified by poll;
other waves' worktrees are active and correctly left alone). A background watcher polls the
siblings for the row's report or impl changes.

### §5.x DECISION_REQUEST (authority-class ambiguity) — filed at settle with the row's outcome

The acceptance ("both suites green at every named stage … adjacents green-unchanged") cannot be
met by ANY correct row impl inside the row's partition at base 09200e9 (§3.1, §3.2). Options:

- **Option A — re-scope the wave's acceptance to the row's real partition.** Judge the row on
  the in-partition stages only (deployment.doctor/card seats via `openBaton` fixtures, baton.mjs
  leg, readiness-projection module, #218 queue read), require every out-of-partition row to stay
  RED-at-its-named-stage (proving no suite edit), pins stay green, adjacents unchanged. The
  out-of-partition stages are re-driven by a later wave that owns application.mjs /
  northbounds / coordinator.
- **Option B — widen the row's partition** (application.mjs, mcp/web northbounds,
  application-cli.mjs, application-semantics.mjs, route-liveness.mjs) so the suites can go
  fully green. Contradicts the brief's "other waves own them this window" and multiplies
  merge conflict risk across the ~15 live sibling worktrees.
- **Option C — restore the deferral receipts in coordinator.mjs** to satisfy A-L/A2. Directly
  contradicts operator ruling #221 (in-base commit `a3e96e8`); requires operator authority,
  not row or coordinator authority.

My recommendation: **Option A**, with #221 treated as binding (Option C is not ours to make).
The #218 addendum's queue read must still land in the row's impl regardless.
