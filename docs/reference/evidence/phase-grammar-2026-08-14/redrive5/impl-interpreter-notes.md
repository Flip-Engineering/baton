# impl-interpreter notes — the phase driver in the workflow interpreter (rd5)

[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-impl-interpreter]
[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-impl-interpreter]
[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-impl-interpreter]
[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-impl-interpreter]
[attempt: e354aeda-f975-4520-83a6-7533eb6ff998 row-impl-interpreter]

Date: 2026-08-14 · Role: `row-impl-interpreter` · Campaign: phase-grammar-2026-08-14-wave-a-rd5.

Status: **AWAIT-INPUTS** — polling (30s cadence, no clock-capped give-up) for
`phase-grammar-contract.md` + `suite-notes.md` (main evidence dir and redrive5). No code is
written until both are read IN FULL per the brief's await-inputs discipline.

## Pre-work reading (this session, before inputs)

- `impl/src/workflow-interpreter.mjs` re-read in full (1124 lines at HEAD 5ae2c7e5): `admitSpec`
  (:134-166) over the closed `SPEC_FIELDS` (:51) — **PIN-C: this exact array is source-pinned by
  `workflow-dsl-red.test.mjs`; the phase schema MUST be a parallel validator, never an extension of
  `admitSpec`'s fields**; `runWorkflow` (:550-739) — render objectives + salt (:575),
  base-commit machinery (:595-603, async + skip-if-clean), `waves.start approve:true` (:608),
  the `settle()` closure (:632-716), `driveLane` (:805-975) with the #163 quiescence vocabulary
  (QUIESCENCE_MIN_SILENT_POLLS=8, QUIESCENCE_CONFIRMATION_POLLS=2, QUIESCENCE_STUCK_MIN_POLLS=96,
  ACTIVE_TURN_PHASES, UNRECOVERABLE_TERMINAL_PHASES), `harvestOne` (:741-780) reading the
  authoritative result sha via `git show` with attempt-marker + mustContain checks, the seven-key
  sorted receipt (:707-715).
- `impl/src/workflow-dsl.mjs` read in full (526 lines) for context — the compiler row's file, never
  touched by me.
- `impl/test/workflow-as-data-red.test.mjs` (30/30 at HEAD), `workflow-dsl-red.test.mjs` (35/35,
  incl. the PIN-C exact-array pin), `workflow-dsl-package-red.test.mjs` (12/12), `workflow-surface-red.test.mjs`
  (35 pass / 2 pre-existing red: FP-14-tools, FP-15 — verified PRE-EXISTING at HEAD, unrelated to
  the interpreter). Baseline suite counts recorded.
- Prior-redrive contracts recovered from git history and read IN FULL as non-binding background
  (each carries a DIFFERENT row-contract salt — not my attempt's authority):
  - rd1 `phase-grammar-contract.md` (snapshot 71d75539, salt 7d31c695): phasefile grammar,
    schemaVersion-1 campaign, `kind:'campaign'`, separate `compileCampaign`, `when eq <name> "<lit>"`.
  - rd3 `phase-grammar-contract.md` (snapshot 37e6f755, salt 9c4144b5): **schemaVersion-2 phase spec
    composed of schemaVersion-1 waves** — `{schemaVersion:2, idempotencyKey, phases:[{name, kind,
    when, outcomes, coupling, checkpoint, members, steering, harvest}], steering, scope}`; derived
    per-phase wave keys `<idempotencyKey>.<phaseName>`; three new codes
    `workflow_phase_invalid` / `workflow_phase_outcome_invalid` / `workflow_phase_gate_invalid` +
    runtime `workflow_phase_coupling_unavailable`; checkpoint rides the existing
    `answer_decision` attention shape; `option` ids closed `continue|amend|abort`; `tight` coupling
    refuses at drive time (#102), `shared` runs loud-degraded (#158).
  - rd3 `suite-notes.md` (snapshot 5edb0c94, salt 26544c22): the suite drives the interpreter
    through a FAKE BATON FACADE (scripted `waves.start` returning scripted per-member handles —
    inspect/status/act/answer/_command) rather than the full BatonApplication/MockAdapter stack;
    asserts ORDER over recorded `waves.start` invocations per phase, outcome extraction from
    harvested bytes, and fold/park behavior. RED stages at HEAD:
    `workflow_phase_compile_missing` (compiler) / `workflow_phase_driver_missing` (driver).
- Wave topology recorded: wave members are coordinator / row-contract / row-suite / row-impl-compiler /
  row-impl-interpreter; report paths land in the MAIN evidence dir
  (`docs/reference/evidence/phase-grammar-2026-08-14/`). The contract row and suite row are both
  upstream of me (suite-notes depends on the contract AND the suite file). Sibling worktree
  ws-7cc67995 (attempt w-554, base 5ae2c7e5) is the wave's coordinator row — still active.

## Anticipated design (PENDING the rd5 contract — the contract decides, this is my read of rd3)

- Dispatch in `runWorkflow`: after JSON.parse, `raw.schemaVersion === 2` → campaign branch
  (`admitPhaseSpec` + per-phase drive); `1` → existing single-wave path byte-unchanged.
- `admitPhaseSpec(raw, repoRoot)`: closed validator over the schemaVersion-2 shape (parallel to
  `admitSpec`; **never mutates SPEC_FIELDS/MEMBER_FIELDS**). Per-phase round-trip law: each phase
  lowered to a schemaVersion-1 wave is `admitSpec`-accepted.
- Campaign drive: for each phase in order — evaluate `when` over the outcome ledger (false → record
  `folded`, all phase outcomes `absent`, continue); derive wave key `<idempotencyKey>.<phaseName>`;
  drive the phase wave via the EXISTING single-wave path; extract declared outcomes from the phase
  receipt's harvest (first line containing the `line` pattern — deterministic bytes, never prose);
  checkpoint phase parks and surfaces the `answer_decision`-shaped packet, routes on the closed
  option id; `tight` coupling refuses at drive time naming #102.
- Mid-flight amendment: a settled-phase ledger keyed by the phase-addressable derived key; on
  re-drive, settled phases read from the ledger (never re-`waves.start`-ed — the derived key is
  #183 terminal-once), only unsettled/amended phases re-drive. No new wall-clock caps (#163 law).

## Poll log

- Polls at 30s cadence, checking both `docs/reference/evidence/phase-grammar-2026-08-14/` and
  `redrive5/` for `phase-grammar-contract.md` + `suite-notes.md`, plus master as a secondary merge
  signal. Absent through the pre-work window (~10:18–10:35 PDT). The contract row has not published.
