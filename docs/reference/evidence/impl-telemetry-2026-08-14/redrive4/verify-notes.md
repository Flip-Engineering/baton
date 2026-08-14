IMPL_TELEMETRY-VERIFY v1
[attempt: 15e60cea-7b65-495f-8679-bbdcd0108d46 coordinator]
Status: GROUNDED — row-telemetry has NOT settled (no notes-row-telemetry.md and no in-partition
impl changes in ANY sibling worktree ../../wt/ws-*/ as of this grounding). §1–§4 are measured
and final at base dc476d87; §5 records the verdict (needs-fold with blockers) and the
DECISION_REQUEST. Every number below was re-measured this session at this base by me; nothing is
carried from redrive1/2/3 notes without re-measurement. (redrive3's verify-notes.md is itself a
byte-copy of redrive2's — same `[attempt: 7663f995…]` salt and "wave-c"/"REDRIVE-2" labels — so
every anchor here is re-derived fresh at dc476d87, not inherited.)

# impl-telemetry redrive4 — coordinator verification notes

Coordinator: wave `impl-telemetry` redrive4, member `coordinator` (this worktree
`ws-b2298a8a7b24becd9f50082f117cbeb2`, base `dc476d87`). Row under verification:
`row-telemetry` (contract `impl/test/seat-telemetry-red.test.mjs` #146 +
`impl/test/readiness-honesty-red.test.mjs` #167 + the #218 queue-read addendum). Verification
law: #174 paraphrase — verify on disk in sibling worktrees `../../wt/ws-*/`; silence is not
death; read the row's notes file. Signal: `signalOnMembersDone row-telemetry` (pinned #175 — I
am the remaining member). gh is UNAUTHENTICATED in this worktree (verified: `gh issue list`
refuses "please run gh auth login"); all evidence below is grounded in code and suite runs, none
in GitHub.

## §1 Suites read in full, immutability baseline (SHA-256, first 16 hex, at dc476d87)

- `impl/test/seat-telemetry-red.test.mjs` 301349633f491749
- `impl/test/readiness-honesty-red.test.mjs` 44ada6edeb8939cf
- Adjacents: deepseek-routes-red 85cc05825b5a9301 · glm-session dcb97cf8387efd77 · adapter
  86611ab73b61b005 · cli-adapters 1f6f072117b144b4
- Row partition files at base: application-deployment.mjs d60bb9eb58b19a21 (CHANGED from
  redrive1/2/3's c3018c3e179e5375 — commit `ed655c3e` "fix(#220)" rewrote only the snapshot
  committer-name strings in `repositorySnapshot`, verified `git show`; it does NOT add
  seats/verdict/probedAt/inFlightRevision) · baton.mjs 340ff2fd84cb9fde (unchanged) ·
  readiness-projection.mjs ABSENT (the row creates it).
- No commit in `5ae2c7e5..dc476d87` touched any of the six acceptance suites (verified
  `git log --oneline 5ae2c7e5..dc476d87 -- <six suites>` → empty). The six suites are
  byte-identical to redrive1's recorded SHAs.

Stage inventories (suite headers, confirmed by run):
- seat-telemetry: 14 tests — RED rows A1–A11 at named stages (`doctor-seats-missing`,
  `capacity-deferred-missing`, `waves-capacity-missing`, `seats-freshness-label-missing`,
  `surface-teaching-missing`, `capacity-inflight-missing`, `inFlightRevision-missing`), A-L the
  fixture-lint GREEN GUARD.
- readiness-honesty: 17 tests — 9 RED rows (A1a/A1b/A1c/A2/A3/A4/A5/A6/V-stale), 8 PIN rows
  (A1p/A3p/A4p/A5p/A6p/P-stale/A-L/A-Lcap) green at HEAD and must STAY green.

## §2 Measured baseline at dc476d87 (my tree, clean, run from repo root)

`node --test impl/test/<suite>.test.mjs` (node v25.8.0):

| suite | tests | pass | fail | at base |
|---|---|---|---|---|
| seat-telemetry-red | 14 | 0 | 14 | all rows RED; A-L guard ALSO fails (§3.1) |
| readiness-honesty-red | 17 | 8 | 9 | 8 pins green / 9 red rows — matches header split |
| deepseek-routes-red | 4 | 4 | 0 | green |
| glm-session | 11 | 11 | 0 | green THIS run — GL2 race not reproduced (§4) |
| adapter | 42 | 42 | 0 | green |
| cli-adapters | 24 | 24 | 0 | green |

## §3 Structural findings (re-measured independently at dc476d87)

### §3.1 The A-L green-guard premise is still destroyed by operator ruling #221 (in the base)

- `git log -S deferTaskDispatch -- impl/src/coordinator.mjs` → last touch `a3e96e88` "fix(#221):
  RIP OUT the invented seat-ceiling pre-cap — operator ruling"; `git merge-base --is-ancestor
  a3e96e88 HEAD` → true. The mint `deferTaskDispatch` survives only as a definition
  (coordination-store.mjs:13287); `grep -an deferTaskDispatch impl/src/*.mjs` → zero call sites.
- Measured this session: A-L fails `Error: timeout waiting for ceiling-skip receipt minted`
  (24.7s); A2 fails `Error: timeout waiting for beta ceiling-skipped receipt` (17.2s). The suite
  waits on a `task.dispatch_deferred` event the base machinery never mints.
- The intervening commit `3794b583` ("tri-state the worktree-availability read") touched
  coordinator.mjs but did NOT restore the caller (verified `git show 3794b583`). Consequence
  unchanged: A-L (a GREEN GUARD) and A2's premise are unsatisfiable at this base without
  re-adding coordinator.mjs receipt minting — contradicting #221 and outside the row's partition.

### §3.2 The suites demand edits in files the row brief forbids (anchors re-measured at dc476d87)

Row partition: application-deployment.mjs + impl/scripts/baton.mjs + NEW modules the suites name +
this evidence tree. Forbidden: application.mjs, workflow-*.mjs, the northbounds. Measured anchors:

- `waves.list` → `waveList` at application.mjs:11890 (wave-row roster ~:11853). A2/A3/A9-1 anchor
  here (the suite itself cites "application.mjs:11811-11818"). OUT of partition.
- `BatonApplication.doctorReadiness` at application.mjs:12593 — the openHost fixtures build
  BatonApplication via src/index.mjs; A4/A6/A9-2/A9-3 exercise this path. OUT.
- readiness-honesty A1c/A2 (and seat-telemetry A5/A7/A11) byte-scan web-northbound.mjs
  (`_handleOperatorRead`), application-cli.mjs (`doctor()` at :2071), mcp-northbound.mjs
  (`_freshDoctorReadiness` / `baton_deployment_doctor`) — northbounds, OUT.
- readiness-honesty A3: `PROVIDER_TERMINAL_GUIDANCE` + `projectTypedTerminalCause` in
  application-semantics.mjs (suite :79) — OUT.
- readiness-honesty A4: quota classification + no-auto-re-probe in route-liveness.mjs `ensure()`
  (:132) — OUT.

Earnability by fixture surface (re-derived from the suites, not copied):

- seat-telemetry IN-partition A1/A8/A10 (openBaton fixtures → BatonDeployment.doctorReadiness
  application-deployment.mjs:1335 / card :1377), MIXED A5/A7/A11 (three-file source scans spanning
  application-deployment.mjs + mcp-northbound.mjs + application-cli.mjs), OUT A-L/A2/A3/A4/A6/
  A9-1/A9-2/A9-3.
- readiness-honesty IN-partition A1a/A1b/V-stale (enumerable verdict/probedAt/static composition
  on the deployment doctor row :1335 + roster projection :1425) and A6 (#livenessGate scans
  application-deployment.mjs only — the gate exists at :1382 but is consulted by `run()` alone at
  :1452; startMany/workflow/explore/review at :1456/:1465/:1474/:1479 lack it); A5 partially
  (doctor-row verdict leg IN; its preflight-refusal leg may need wave-driver.mjs — judged on
  settle). OUT A1c/A2/A3/A4.

### §3.3 Suite-vs-contract lineage + the #218 queue read

The suites (attempt `ea57954b…`) predate #221; contract-146's D1/D2 pins assume #10 deferral
receipts are minted. Unchanged by redrive. #218 addendum: the seat telemetry must expose the
QUEUE (per-adapter inFlight/ceiling/seat_queued with member ids + queue position) — CONFIRMED NOT
suite-pinned (`grep -n "seat_queued\|queued\|queue"` over both suites → zero hits). This is a
suite gap; the row must name it in its notes and pin the queue read in its impl anyway (the
surface-honesty law: the machinery knows → the surface says).

## §4 glm-session GL2 (adjacent, failing-test law)

glm-session measured 11/11 green THIS run. redrive1 recorded the GL2 race
(`resource.provider_call`/`content.message` landing before the model_mismatch crash is observed)
failing once in three runs; this run did not reproduce it (nor did redrive2/3's). The flake
classification (non-deterministic event race, present at base, NOT attributable to the row)
stands. gh unauthenticated → flaky-issue check/file IMPOSSIBLE (verified above). This note is the
tracking artifact; recommend a `bug`-tagged flaky issue once auth exists.

## §5 VERDICT + row verification

### §5.1 VERDICT: needs-fold with blockers

Two independent blockers:

1. **Row NOT settled.** No `notes-row-telemetry.md` and no in-partition impl changes
   (application-deployment.mjs / baton.mjs / readiness-projection.mjs) exist in ANY sibling
   worktree as of this grounding — polled `git status` across all `../../wt/ws-*/`. The only
   application-deployment.mjs edit is in `ws-210e5e0f`, which is the honesty-package wave's
   `row-deploy2`, not this row. There is no impl to verify; "the requested repository improvement
   is implemented" is FALSE at this grounding.
2. **The acceptance is unmeetable within the row's partition at dc476d87** (§3.1, §3.2). No
   correct impl can turn both suites fully green without (a) restoring the #221-removed receipt
   minting in coordinator.mjs and (b) editing application.mjs / the northbounds /
   application-cli.mjs / application-semantics.mjs / route-liveness.mjs — all forbidden by the
   row brief.

Anything not green, and why:

- seat-telemetry-red 14/14 fail. A-L and A2: `task.dispatch_deferred` receipt never minted (#221).
  A1/A3/A4/A5/A6/A7/A8/A9-1/A9-2/A9-3/A10/A11 fail at their named stage — the
  seats/capacity/inFlightRevision/observedAtEventSeq surfaces do not exist at HEAD
  (`grep observedAtEventSeq|inFlightRevision impl/src/*.mjs` → zero hits).
- readiness-honesty-red 9/9 red rows fail: verdict/probedAt/static projection absent
  (`grep probedAt|probe-verified impl/src/*.mjs` → zero hits), forceProbe absent (zero hits),
  provider_quota absent from PROVIDER_TERMINAL_GUIDANCE (zero hits), #livenessGate consulted by
  `run()` only.
- Adjacents all green-unchanged (4/4, 11/11, 42/42, 24/24).

### §5.2 DECISION_REQUEST (authority-class ambiguity) — re-grounded at dc476d87

The acceptance ("both suites green at every named stage; adjacents green-unchanged") cannot be
met by ANY correct row impl inside the row's partition at base dc476d87 (§3.1, §3.2). Options:

- **Option A — re-scope acceptance to the row's real partition.** Judge on the in-partition
  stages only; require every out-of-partition row to stay RED-at-its-named-stage (proving no
  suite edit); pins stay green; adjacents unchanged; the #218 queue read lands regardless.
  Out-of-partition stages are re-driven by a later wave that owns application.mjs / northbounds /
  coordinator.
- **Option B — widen the row's partition** (application.mjs, mcp/web northbounds,
  application-cli.mjs, application-semantics.mjs, route-liveness.mjs). Contradicts "other waves
  own them this window"; multiplies merge-conflict risk across the 11 live sibling worktrees.
- **Option C — restore #10 deferral receipts in coordinator.mjs** to satisfy A-L/A2. Directly
  contradicts operator ruling #221 (in-base `a3e96e88`); requires operator authority.

Recommendation: **Option A** (#221 is binding; Option C is not ours to make). This verdict and the
PENDING row verification are written under Option A semantics unless the operator rules otherwise.
