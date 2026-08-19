# ROW NOTES — wave-e row-cadence (attempt 5884e780-5ba4-493b-a7fd-8b6974b772cb)

Deliverable: leg-b activity honesty + settle pacing, implemented and verified in this worktree
(HEAD b1328c10). Red-first pin suite: `row-cadence-pins.mjs` (this directory). Files changed:
`impl/src/application.mjs`, `impl/src/wave-driver.mjs`. Nothing else.

## Contract → implementation map

### 1. Leg-b catatonia refinement (classification folds member-activity evidence)
`impl/src/application.mjs` `_progressTiming`: the LIVENESS classification now folds the
member-activity horizon. `view.activity.lastActivityAt` (the existing `_activityProjection`
store projection — application.mjs:8099-8140) is the latest member-originated evidence event
(content.tool_call / content.message / resource.* included, NOT only checkpoints/messages). The
silence basis (`silenceMs`, the `progressClass` input the drivers fold) is measured against the
later of the last meaningful event and the member's own last activity, so a tool-calling member
whose events advance never reads `silent` — and the store projection itself is pinned by RC-1.

Boundary kept intact (AX-1 rule 3, pinned by the landed AX1-F battery row): telemetry is not a
forward-progress MILESTONE — `lastProgress.at` stays the last meaningful event. The
reconciliation is that liveness (silence/classification) folds activity while milestone
semantics stay meaningful-only. The interpreter's drive-loop consumption of `lastProgress.at`
(workflow-interpreter.mjs:531-533's own contract mirror) is outside this row's path scope; its
classification inputs (outline progressClass + silenceMs) are now honest.

### 2. settleTimeoutMs is pacing only — never a terminal basis
Audited every use: `impl/src/wave-driver.mjs` — the field appears exactly in DEFAULT_POLICY,
freezePolicy validation, and ONE runtime use: `wave.settle({ timeoutMs: policy.settleTimeoutMs })`
which runs AFTER the drive loop's basis is decided from member evidence. It bounds outcome
collection, never fate. Documented at the policy declaration and the settle call; RC-2 pins both
behaviorally (a 1ms settle window still yields the member-evidence `completed` basis) and
statically (the closed 3-occurrence reference set, no basis assignment touches it).

### 4. Every member stop carries its DECISION basis (verdict + signal)
`impl/src/wave-driver.mjs`: the close reason is now `Wave driver settled: basis=<verdict>
signal=<signal>` from the closed `STOP_BASIS_SIGNALS` vocabulary (completed→all-members-settled,
stall→wave-stall-marker, aborted→abort-signal; abnormal exit→unknown/driver-abnormal-exit). The
reason rides the member stop outline's `lastAction.reason` (the run.stop response view wave.mjs
close consumes) and its ledger `reasonDigest` binding. RC-4 pins the completed and stall paths;
RC-5 pins the abort path — never the opaque digest-of-a-constant.

### 5. The drive loop never classifies a member terminal on a non-evidence signal
Audited: every terminal classification in the loop rests on member evidence — the per-poll
status read (outline.terminal / applicationTerminal / result_ready), the claim resolution, the
start-failure count, and the L5 wave-level stall marker (a digest of the member status views).
RC-5 proves it end-to-end: with a sub-second stall window and a member whose content.tool_call
activity advances every poll, the drive never breaks `stall` — only the operator abort stops it,
and that stop names `basis=aborted signal=abort-signal`.

## Red-first evidence

At the pre-change head (b1328c10), the final pin code was RED on RC-1, RC-4 (×2), RC-5 and
GREEN on RC-2 (×2) — the settle-pacing law already held, which is exactly what RC-2 documents
and regression-guards. Post-change, all 6 pins GREEN.

| Pin | Pre-change | Post-change | What it pins |
|-----|-----------|-------------|--------------|
| RC-1 | RED (`'silent'`) | GREEN | tool-call-only member (no checkpoints/messages) classifies non-silent while its events advance; the activity projection carries the latest member ts |
| RC-2 | GREEN | GREEN | 1ms settle window still yields `completed`; every `settleTimeoutMs` reference is pacing-only |
| RC-4 | RED | GREEN | completed + stall stops carry `basis=… signal=…` on the stop outline and its ledger binding |
| RC-5 | RED | GREEN | evidence-advancing member never classified terminal; abort stop names its signal |

## Battery status

The wave-driver, wave-driver-policy, semantic-progress, transport-liveness-235, issue55-stall,
cli-wave-fidelity, issue10-blocked-interaction (incl. AX1-F), issue10-waiting-vocabulary,
bidirectional-driver, claim-preflight, recipes, wave-settle-error-surfacing, waves-list-scaling,
wave-grammar, wave-observability (incl. the wave lane), wave-attach, waves-run-detach suites:
GREEN (no new failures). The quiescence-completion battery (15 rows) is green except the R5
survivor-harvest row, which is a PRE-EXISTING load-sensitive flake — it fails identically at the
pre-change head and passes on re-run (its own fixture comments document the history). The
phase84/85 context-map rows and seat-telemetry/doctor-seats rows fail on this sandbox for
environmental/pre-existing reasons unrelated to this row (missing codex provider credentials →
`route_credentials_unprojected`; unlanded red pins at HEAD).

Verification contract of this row: direct executable `true`, args `[]`, cwd `.`, exit 0 —
satisfied. Acceptance authority (coordinator brief): the named red-first pins run green at this
HEAD; the wave-driver and progress suites unchanged.
