# impl-compiler-notes — row-impl-compiler (the phase grammar in workflow-dsl.mjs)

[attempt: 26544c22-a314-483b-948d-69a07ef1bc05 row-impl-compiler]

Status: AWAIT-INPUTS — polling (30s cadence) for `phase-grammar-contract.md` AND
`suite-notes.md` carrying THIS campaign's salt (`26544c22-…`). No compiler code written
until both are read IN FULL. This file is written incrementally per the coordinator's
nudge; the sections below record pre-work, topology, and baselines now; decisions and
suite counts land with the implementation.

## Pre-work reading (anchors, this session)

- `impl/src/workflow-dsl.mjs` read in full (527 lines at HEAD 09200e9): the #170
  16-directive compiler — `WAVEFILE_DIRECTIVES` (:39-56), the lexical layer
  `logicalLines`/`tokenize` (:92-172) with continuation + the `#` trailing-comment
  refusal, `refuse` (:70-74) carrying the #160 `{line, field, expected}` triple AND the
  wire `detail` leg, path validation (:178-232), the dispatch (:279-447), and the pure
  compile seam `compileWavefile` (:453-524) emitting the five-key schemaVersion-1 IR
  (:517-523). Zero phase/outcome/coupling/when vocabulary at HEAD (verified by scan).
- `impl/src/workflow-interpreter.mjs` read in the compiler-relevant span (:1-348): the
  closed refusal family + `admitSpec`/`admitMember`/`admitSteering`/`admitHarvest`
  (:131-330) — the compile-side mirror target (the #170 D1 law: compile-clean never
  triggers a late interpreter refusal).
- `impl/test/workflow-dsl-red.test.mjs` read in the rows that pin what my change must
  not disturb:
  - P4 (:414-425) pins `WAVEFILE_DIRECTIVES` at EXACTLY 16 keys;
  - S3 (:801-813) pins accepted == documented == 16 (via `directiveNames` →
    `Object.keys(ns.WAVEFILE_DIRECTIVES)`, :110-117);
  - S5 pins the inline-constants form (IDEMPOTENCY_PATTERN/MAX_MEMBERS/MESSAGE_KINDS/
    SCRATCHPAD_KINDS byte-identical to the interpreter's inline declarations);
  - S6 pins every compiler-thrown `workflow_*` code inside the closed 5-code family.
  **Consequence (recorded now):** new phase directives MUST live in a separate exported
  registry (never `WAVEFILE_DIRECTIVES`), and any new refusal codes are a contract
  decision — S6's source scan rejects `workflow_phase_*` literals in the compiler unless
  the contract + suite fold S6 first (see Decisions when the contract lands).

## Topology (mirrors the suite row's JC-1 and the interpreter row's JC-1)

- `suite-notes.md` landed in the row-suite worktree (`ws-e8f387b6…`, salt `26544c22…` —
  MY campaign's suite row): read in full; status AWAIT-INPUTS on the contract. Its pin
  shapes are PENDING the contract; it records that two contracts exist in sibling
  worktrees of OTHER attempts (salts `9c4144b5…` in `ws-339bada8…`, `b59fa92f…` in
  `ws-f640bc11…`) and that neither is my authority. I read the `9c4144b5` contract in
  full as NON-BINDING background; the two attempts diverge materially (schemaVersion 2 +
  `admitPhaseSpec` + three new `workflow_phase_*` codes vs. schemaVersion 1 +
  `kind:'campaign'` + separate `compileCampaign`), so no pre-shaping is safe — the
  compiler is NOT written against either until my attempt's contract lands.
- The interpreter row of my campaign is `ws-72691758…` (its notes share my salt).

## Baselines (this worktree, HEAD 09200e9, before any edit)

- `node --test impl/test/workflow-dsl-red.test.mjs` — **35 tests / 35 pass / 0 fail**
  (~49s). The critical compiler suite; green at HEAD.
- Package/grammar suites (sequential, this worktree):
  - `workflow-dsl-package-red` — 12 tests / 12 pass / 0 fail.
  - `grammar-m1-red` — 6/6; `grammar-m2-red` — 10/10; `grammar-m3-red` — 8/8;
    `grammar-m4b-red` — 7/7 (all green).
  - `grammar-m5-red` — **5 tests / 4 pass / 1 fail — PRE-EXISTING RED AT HEAD** (fails
    identically before any edit of mine; deterministic, reproduced twice). Row `M5-1:
    the divergence ledger is empty and the M4 retirement is pinned`
    (impl/test/grammar-m5-red.test.mjs:49). The divergence ledger is NOT empty: 8 cli
    entries `retiresIn: 'M5'` gated on `#87` (`run.attention.watch`, `run.board.post`,
    `run.board.read`, `run.knowledge.seed`, `run.message.receipt`, `run.message.send`,
    `run.scratchpad.elevate`, `run.scratchpad.read` — "facade port contracted via
    #87+#48, web-refused until #87 lands") plus the `waves.compile` card-vs-admission
    drift ledgered by #170 ("web-admitted … absent from the pinned 31-name card …
    ledgered pending wave reconciliation"). Root cause is in the ledger surface
    (`surface-conformance.mjs`/`application-semantics.mjs`), NOT in
    `workflow-dsl.mjs`; fixing it is OUTSIDE this row's file partition, and `gh` is
    unauthenticated in this worktree (issue check/file unavailable — recorded per the
    failing-test law). **Named and quoted here, not silently absorbed; escalated to the
    coordinator for ruling** (their brief explicitly accepts pre-existing reds that are
    named and quoted).
  - `workflow-policy` — 2/2.
  - `workflow-surface-red` — 37 tests / 32 pass / **4–5 fail at HEAD, LOAD-CORRELATED**:
    two baseline runs disagreed on the count (4 then 5), and the failing rows are the
    heavy facade drives — `FP-04` (77s), `FP-08` (40s), `FP-14-tools`, `FP-15`,
    `WS-01` (300s) — with the suite's `watchdog: { stallMs: 60_000 }` design assuming
    an unloaded host. This host is running 50+ concurrent sibling-worktree `node --test`
    processes (verified via `ps`), so these rows are wall-clock-starved, not logically
    red at an idle HEAD. **Named and quoted, not silently absorbed**; re-run in the
    acceptance pass and pasted verbatim; if they still fail on an idle host they are a
    real pre-existing red for the coordinator, outside my partition.
  - The shared `workflow-as-data-red` suite has processes wedged 1h+ across attempts on
    this host; counts recorded in the acceptance pass.

## Decisions

(awaiting the campaign contract — none final)

## Judgment calls

(awaiting the campaign contract — none final)

## Suite counts (final acceptance)

(pending implementation)
