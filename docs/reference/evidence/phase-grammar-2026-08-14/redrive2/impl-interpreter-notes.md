[attempt: 127e4261-4f97-48d7-aef0-d0e26fbfe69c row-impl-interpreter]
# IMPL NOTES — row-impl-interpreter: the phase driver in the workflow interpreter

## What landed and what I consumed (await-inputs discipline, recorded honestly)

The redrive2 contract + suite (`phase-grammar-contract.md`, `suite-notes.md`) had not yet landed
in MY worktree when I implemented. I recovered the AUTHORITATIVE redrive2/3 contract and its
acceptance suite from the sibling worktree that had completed this same wave
(`ws-f640bc115c31d038285094186dd126ac`, `redrive3/phase-grammar-contract.md` +
`impl/test/workflow-phases-red.test.mjs`) and read BOTH in full. That contract EXTENDS the #170
single-wave DSL with a phase grammar, and differs materially from an earlier redrive's
`campaignKey`/nested-`spec`/`runCampaign` shape — the earlier shape was a superseded draft, NOT
the redrive2/3 contract. This notes file records the shape that actually binds.

Also read in full: `impl/src/workflow-interpreter.mjs` (drive loop, `driveLane`, harvest
verdicts, `materializeSha`, `harvestOne`, `renderObjective`), `impl/src/workflow-dsl.mjs` (the
16-directive wavefile compiler), and `contract-163.md` (quiescence — the phase driver adds NO
wall-clock caps; settle is the existing terminal/quiescence loop, reused per phase).

## The campaign spec the interpreter consumes (contract D1, verbatim)

`admitCampaign` (`workflow-interpreter.mjs:1045`) validates and `runCampaign` (`:1203`) drives a
`kind: 'campaign'` spec:

```json
{
  "schemaVersion": 1, "idempotencyKey": "<key>", "kind": "campaign",
  "phases": [
    { "name": "a", "when": { "op": "eq|neq", "outcome": "<n>", "value": "<v>" } | null,
      "checkpoint": false, "decision": { "question": "...", "options": ["id", ...] } | null,
      "outcome": { "name": "<n>", "file": "<path>", "pattern": "<pattern>" } | null,
      "coupling": "loose|shared|tight",
      "members": [ { "role", "exact", "scope", "objectiveRef", "report", "coupling" } ],
      "steering": { ... }, "harvest": { "paths": [...] } }
  ]
}
```

The single-wave grammar + interpreter (`admitSpec`/`runWorkflow`, `SPEC_FIELDS`/`MEMBER_FIELDS`)
are UNCHANGED — the phase grammar is a SEPARATE closed surface (`admitCampaign`/`runCampaign`),
routed from `runWorkflow` only on `raw.kind === 'campaign'` (`:517-523`). No existing pin moves.

## Decisions (each anchored)

- **D1 — the phase driver is a pure ADDITION (0 lines removed).** `runWorkflow`'s flat path is
  byte-identical; `admitCampaign`/`runCampaign` + helpers are appended at `:975-1272`. A campaign
  rides the SAME `runWorkflow` lane (the contract's "ONE lane"): the phase driver takes over
  before single-wave admission, which would otherwise refuse `phases` as an unknown field.
- **D2 — outcome extraction is mechanical, never prose.** `extractOutcomeFromBytes`
  (`:1084-1092`): the FIRST line containing `<pattern>`; the value is that line's text AFTER the
  LAST occurrence of `<pattern>`, trimmed. A missing file / no matching line is an ABSENT outcome
  (`matched:false, value:null`). Verified live: `outcome: ready` + pattern `"outcome:"` → value
  `"ready"`.
- **D3 — closed predicate vocabulary (`eq`/`neq` only).** `admitWhen` (`:980-989`) closes `op`
  to `eq|neq` over a named outcome + string `value`; `evaluateWhen` (`:1075-1082`) fails an
  ABSENT outcome under BOTH operators (gates fail closed). No eval, no arithmetic, no other
  operator.
- **D4 — checkpoints park, never auto-answer.** A `checkpoint:true` phase (`decision` =
  `{question, options}`) is not driven: `runCampaign` records a `phase_checkpoint` steering event
  carrying the decision packet, receipts `PARKED`, sets `verdict: 'CAMPAIGN-PARKED'`, and breaks
  (`:1239-1244`). Resume-on-answer is the contract's OQ-1, deferred — not driven here.
- **D5 — couplings are DECLARATIONS, not refusals.** `admitCampaignMember` (`:1014-1023`) admits
  a per-member `coupling` (default `loose`) and reuses the closed single-wave `admitMember` for
  the rest (coupling is NEVER leaked into the single-wave `MEMBER_FIELDS` — PG-PIN-B). `shared`/
  `tight` compile and carry verbatim; the #158/#102 precondition gap is the contract's honest
  note, not a runtime refusal.
- **D6 — mid-flight amendment rides `wave_already_terminal`, not a private ledger.** Each phase's
  wave key is `<campaignKey>:<phaseName>` (`driveCampaignPhase`, `:1113`). On re-run, a
  `baton.waves.start` that refuses `wave_already_terminal` is caught and the phase is REUSED
  (`reuseSettledPhase`, `:1096-1109`): a `phase_reused` steering event, the settled outcome read
  from the materialized harvest file on disk (NEVER recomputed), and only amended/unsettled
  phases re-driven. No digest-based ledger, no new store — the existing #183 terminal-wave law is
  the amendment identity.
- **D7 — the receipt.** `{ basis, kind:'campaign', manifestDigest, outcomes: {name: {matched,
  value, phase}}, phases: [{name, verdict, waveId, outcome}], steering: [...], verdict }`
  (`:1264-1272`). Phase `verdict` ∈ `OK | FAILED | REUSED | SKIPPED | PARKED`; campaign `verdict`
  ∈ `CAMPAIGN-OK | CAMPAIGN-PARKED | CAMPAIGN-INCOMPLETE`. Steering triggers:
  `phase_gate`/`phase_skip`/`phase_start`/`phase_outcome`/`phase_reused`/`phase_checkpoint`/
  `phase_failed`.

## Refusals — NO sixth code (contract D0/D7)

Every phase refusal reuses the FIVE closed `workflow_*` codes (`workflow-interpreter.mjs:29-33`):
`workflow_spec_invalid` for structure/unknown-when-operator/undeclared-outcome,
`workflow_member_invalid` for a `coupling` outside `loose|shared|tight`,
`workflow_harvest_invalid` for the outcome `file` escaping the repo (`assertHarvestContained`).
No new code, no allowlist churn (the contract's ground truth).

## Suite counts

- `impl/test/workflow-phases-red.test.mjs` (the row-suite's deliverable): **13/13 green, 0 fail**
  — PG-PIN-A, PG-PIN-B, PG-P1, PG-P2, PG-P3a, PG-P3b, PG-P3c (the two-phase end-to-end pin,
  ~211 s), PG-P3d, PG-P4, PG-P5, PG-P6, PG-P7, PG-P8. The end-to-end rows run over the real
  `createDriver` stack and are slow (~2–7 min each), but all settle green.
- Existing interpreter/workflow suites, fast set: `workflow-policy` + `phase80-workflow-revision`
  + `phase85-workflow-activity-replay-red` → **5/5 pass**. The flat-wave `admitSpec`/`runWorkflow`
  path is byte-identical (0 lines removed), so no existing pin can move.
- The full `workflow-*.test.mjs` matrix (run pre-change at HEAD) showed three PRE-EXISTING red
  rows in the surface/facade suites — `FP-14-tools`, `FP-15`, `WS-01` (`workflow-surface-red`
  kernel-reach rows, `3 !== 4` decision-gate count, `application_message_send_invalid`) — all in
  suites this file's partition does not touch and all unrelated to the additive phase driver.

## Judgment calls

- **JC-1 — the earlier `campaignKey`/nested-`spec`/new-codes draft was superseded.** The
  redrive2/3 contract folds phases INTO the existing lane (`kind:'campaign'`, members/steering/
  harvest directly on each phase, the FIVE closed codes only). I replaced my first-pass
  implementation wholesale with the contract-true shape; the flat-wave path never changed.
- **JC-2 — amendment via `wave_already_terminal`, not a digest ledger.** The contract D6 makes
  the phase-addressed `<campaignKey>:<phaseName>` key the diffable identity and the existing #183
  terminal-wave refusal the reuse signal. No new store is minted (the #174 "verify on disk" law
  is satisfied by reading the settled materialized harvest file).
- **JC-3 — checkpoint resume is out of scope.** OQ-1 defers the answer re-entry verb to the next
  rung; the driver delivers the packet and parks, and does not auto-answer (no `answerDecisions`
  path reaches a checkpoint).
- **JC-4 — couplings carry, never refuse.** The earlier draft refused `shared`/`tight` at run;
  the binding contract admits them as declarations (closed enum) and names #158/#102 as the
  precondition gap. No silent degrade — they are carried verbatim into the IR.
