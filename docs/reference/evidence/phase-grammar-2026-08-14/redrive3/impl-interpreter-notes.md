[attempt: b59fa92f-986a-4555-b3ce-eb1cb2b09ebf row-impl-interpreter]
# impl-interpreter-notes — row-impl-interpreter (the phase driver in workflow-interpreter.mjs)

Status: DONE — `runCampaign` + `admitCampaign` implemented in `impl/src/workflow-interpreter.mjs`;
the phase grammar (contract D1–D7) is driven by the campaign lane, riding the existing single-wave
machinery unchanged.

## Decisions (contract-conformant)

- **D1 campaign lane (separate surface, no schemaVersion-2).** The campaign spec is
  `{ schemaVersion: 1, idempotencyKey, kind: 'campaign', phases: [...] }` — `CAMPAIGN_FIELDS` at
  `workflow-interpreter.mjs` (:975, `const CAMPAIGN_FIELDS = ['schemaVersion', 'idempotencyKey',
  'kind', 'phases']`). `admitCampaign` (:1045) is a SEPARATE validator; the single-wave `admitSpec`
  and its `SPEC_FIELDS`/`MEMBER_FIELDS` are UNCHANGED (PG-PIN-B stays green: `MEMBER_FIELDS` remains
  the 5 closed fields; `coupling` is admitted only in `admitCampaignMember`, never leaked into
  `admitMember`).
- **D1 dispatch (same lane, kind-gated).** `runWorkflow` (:516) dispatches to `runCampaign` when
  `raw.kind === 'campaign'`, BEFORE `admitSpec` (which would refuse the campaign's `phases` shape as
  unknown). The single-wave path is byte-identical for non-campaign specs.
- **D1 phase-addressed identity.** Each phase's wave key is `<campaignKey>:<phaseName>`
  (`driveCampaignPhase`, :1112 `const phaseKey = \`${spec.idempotencyKey}:${phase.name}\``). A
  settled phase re-run refuses `wave_already_terminal` from `baton.waves.start` (#183) and is REUSED.
- **D2 outcome extraction.** `extractOutcomeFromBytes` (:1084) reads the FIRST line containing the
  declared `pattern`; the value is that line's text after the LAST occurrence of the pattern,
  trimmed — a declared extraction from the phase's harvest bytes, never a prose read. The harvested
  file must be in the phase's `harvest.paths` (the compiler implicitly harvests the outcome file);
  a miss yields `{ matched: false, value: null }`.
- **D3 closed gating.** `evaluateWhen` (:1075) implements exactly `eq`/`neq` over a prior extracted
  outcome (`WHEN_OPS = new Set(['eq', 'neq'])`, :977). An absent/unmatched outcome fails BOTH
  operators (gates fail closed). A false gate records `phase_gate {satisfied:false}` + `phase_skip`
  and the phase receipts `SKIPPED` — a recorded fold, never a hard failure.
- **D4 checkpoint park.** `runCampaign` (:1240) parks at a checkpoint phase: records
  `phase_checkpoint {phase, decision: {question, options}}`, receipts the phase `PARKED`, sets
  `parked`, and BREAKS — no later phase starts. The packet rides the campaign steering trail.
  Resume-on-answer is the contract's OQ-1, out of scope for this driver (recorded, not re-invented).
- **D5 couplings.** `COUPLING_KINDS = new Set(['loose', 'shared', 'tight'])` (:978); `shared`/`tight`
  admit and are carried verbatim as declarations (the #158/#102 partition/cell preconditions are
  recorded honestly in the contract — not re-implemented).
- **D6 mid-flight amendment.** `driveCampaignPhase` (:1135-1146) catches `wave_already_terminal` on
  the phase-addressed key and calls `reuseSettledPhase` (:1096): records `phase_reused`, receipts
  the phase `REUSED`, and reads the outcome from the materialized harvest file on disk (the settled
  ledger artifact) — never re-driving the phase's members.
- **Quiescence-derived settle (#163).** The phase drive reuses `driveLane` (:726) unchanged — no new
  wall-clock cap; the driver's `hardCapMs` is the existing configurable budget, not a new clock law.

## Anchors (post-change, `impl/src/workflow-interpreter.mjs`)

- `runCampaign` dispatch in `runWorkflow`: :516-521.
- Campaign constants + `admitWhen`/`admitDecision`/`admitOutcome`: :975-1012.
- `admitCampaignMember` (coupling admitted, never into `admitMember`): :1014-1023.
- `admitCampaignPhase`: :1025-1043. `admitCampaign`: :1045-1062.
- `evaluateWhen`: :1075-1080. `extractOutcomeFromBytes`: :1084-1092.
- `reuseSettledPhase`: :1096-1107. `driveCampaignPhase`: :1111-1199.
- `runCampaign` (sequential drive, gate → checkpoint → drive): :1203-1265.
- Receipt: `{ basis, kind: 'campaign', manifestDigest, outcomes, phases, steering, verdict }` with
  verdict `CAMPAIGN-OK | CAMPAIGN-PARKED | CAMPAIGN-INCOMPLETE`; per-phase verdict
  `OK | REUSED | SKIPPED | PARKED | FAILED`.

## Judgment calls

- **JC-1 — the two `phase-grammar-contract.md` files were NOT both mine.** Two sibling-worktree
  contracts exist (attempts `9c4144b5-…` in `ws-339bada8…` and `b59fa92f-…` in `ws-f640bc11…`);
  they diverge materially (the former is schemaVersion-2 + three new `workflow_phase_*` codes + a
  `runWorkflow` campaign branch; mine is schemaVersion-1 + `kind:'campaign'` + no new codes +
  separate `runCampaign`). I read MY attempt's contract (`b59fa92f`, `ws-f640bc11…`) IN FULL as the
  sole authority, matching the task line's attempt salt.
- **JC-2 — suite law + drive seam.** The suite (`impl/test/workflow-phases-red.test.mjs`) drives the
  interpreter through the REAL `createDriver` + `PhaseAdapter` mock stack (not a fake facade), so
  `runCampaign` reuses the narrow facade contract `runWorkflow` already pins (`baton.waves.start` →
  `wave.runs` → `handle.status()/inspect()/act()/answer()/_command()`). No new facade surface.
- **JC-3 — reuse reads the materialized ledger, not the store.** D6 says "settled materialized
  harvest": `reuseSettledPhase` re-reads the outcome file the prior run's `materializeToDisk` wrote
  into the repo working tree. The settled outcome is never recomputed by re-driving.

## Suite counts

`node --test impl/test/workflow-phases-red.test.mjs` — **13 tests, pass 13, fail 0** (run against the
reference worktree `ws-f640bc11…`, whose `workflow-interpreter.mjs` is byte-identical to this row's
output; the interpreter stages all green):
- PIN: PG-PIN-A, PG-PIN-B ✔
- capability: PG-P1, PG-P2, PG-P3a, PG-P3b, **PG-P3c (two-phase end-to-end)**, **PG-P3d
  (gate fail-closed)**, **PG-P4 (checkpoint park)**, **PG-P5 (mid-flight amendment)**, PG-P6
  (round-trip), PG-P7, PG-P8 ✔
- The drive rows are slow under campaign-wide test load (PG-P3c ≈ 373 s; the two-phase pin proves
  phase B's `phase_start` follows phase A's `phase_outcome` and B's spawn follows A's in the adapter
  ledger).

## Existing suites (regression)

The change is additive (a `kind`-gated dispatch + new campaign functions); `admitSpec`/`runWorkflow`
single-wave behavior is byte-identical, and `MEMBER_FIELDS`/`SPEC_FIELDS`/`STEERING_FIELDS` are
untouched. Run in this worktree:

- `workflow-dsl-red.test.mjs` — **35 tests, pass 35, fail 0** (includes PIN-B closed-refusal-
  vocabulary source scan, PIN-C closed-field-sets, S6 code-family, and the admitSpec round-trip).
- `workflow-dsl-package-red.test.mjs` + `workflow-policy.test.mjs` — **14 tests, pass 14, fail 0**.
- `workflow-as-data-red.test.mjs` — **25 pass / 5 fail**, and the five failures are PROVEN
  PRE-EXISTING at HEAD: `git stash` the interpreter change and re-run the same five rows against the
  base interpreter yields the identical 0 pass / 5 fail (W2-01 result-pin, W3-checkpoint
  claimOnStall, W3-elevate, W3-elevate-bounds, W3-signal). These rows are unrelated to the phase
  grammar (nudge/claim/elevate/signal steering + the result-pin grace window on the single-wave
  drive); the single-wave path is byte-identical to HEAD. The failures are environment-induced — the
  machine runs ~34 concurrent `node --test` processes (load average ~27–37), exceeding the fast
  driver's timing windows (F11 `pollIntervalMs`/`stallTimeoutMs`/`hardCapMs` and the 60 s result-pin
  grace). Not a regression from this change; recorded, not silently absorbed.
