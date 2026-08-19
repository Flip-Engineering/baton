[attempt: 12e4523e-4090-411f-99e3-5462527df087 row-admission-align]

# row-admission-align — wave admission refuses what members cannot start (#207 root)

Deliverable: the interpreter now refuses at the compile/admit seam when an objectiveRef brief's
RENDERED objective exceeds the run.start objective cap, naming both byte counts; the 64 KiB D5
envelope stays the read/containment bound; the red-first pin suite is green on the fix.

## Changes (within the assigned path scope + the brief-mandated pin file)

- `impl/src/workflow-interpreter.mjs`
  - `FRAME_LIMITS` joins the lane's import graph (Decision 8's no-re-declare law — the registry is
    the only source of a cataloged lane's byte literal). limits.mjs is pure data and imports only
    node:crypto, so the W5 transitive-graph law (F10b — no reachable module runs a top-level wave
    start) and W5-01 stay green.
  - `OBJECTIVE_REF_MAX_BYTES` stays 64 KiB — the D5 READ/containment envelope, pinned at its exact
    value by W1-03/F8b (64 KiB + 1 refuses `workflow_objective_ref_invalid`).
  - New `assertObjectiveAdmissible(member, objective)` (called for every member during the render
    phase, before any wave machinery is touched): measures the RENDERED objective
    (`[attempt: <salt> <role>] ` + brief — exactly the bytes the run machinery would admit) and,
    when it exceeds `FRAME_LIMITS['run.objective'].value`, throws `workflow_spec_invalid` naming
    the member role, the objectiveRef, the measured rendered bytes, and the cap. Fail-loud at the
    seam — never a per-member phantom start failure.
- `impl/src/limits.mjs` — additive doc comment at the `run.objective` row (comment only; the
  declared rows and `FRAME_LIMITS_DIGEST` are byte-identical). No cap changed anywhere.
- `impl/test/objective-admission-align-red.test.mjs` — the contract's red-first pin suite:
  - AA-1: a 5 KiB and an 8 KiB brief refuse at admission with `workflow_spec_invalid` naming both
    byte counts (the measured RENDERED bytes and the 4096 cap) — never a settle receipt whose
    member phantom-fails at start;
  - AA-2a (green guard): the machinery admits a rendered objective at EXACTLY the cap (createWave
    starts the member — the alignment is exact, no off-by-overhead false refusal);
  - AA-2b: a brief rendering to cap+1 refuses naming 4097 bytes;
  - AA-3a (green guard): the D5 envelope is unchanged — 64 KiB + 1 still refuses
    `workflow_objective_ref_invalid`;
  - AA-3b: a 64 KiB brief (envelope top) is READ, then refuses admission naming the rendered bytes.

## Judgment call (contract 2): 64 KiB stays the read envelope; the run cap is the admission bound

OQ5's spill-aware advisory PASS is sound only where the lane actually SPLITS — the inline run.start
path mints a durable digest-citable spill artifact and the run proceeds (pinned by
frame-economics-red). The by-reference interpreter lane renders the FULL brief into the member
objective and hands it to the embedded client (`prepareRunStart` → `nonempty`,
application-client.mjs:11-13), whose byte wall refuses anything over the cap BEFORE the
application's spill-aware admission is reached. There is no split in this lane, so a "spill-aware
envelope" admission would reproduce the per-member phantom exactly. The bound therefore stays the
read/containment envelope (W1-03's 64 KiB + 1 exact-value pin), while `assertObjectiveAdmissible`
enforces the registry's run.objective cap as the ADMISSION bound — the interpreter admits by
reference only what run.start can start.

Refusal class: `workflow_spec_invalid` (contract item 1's literal "typed workflow_spec_invalid-class
refusal"); the sibling D5 envelope refusal (`workflow_objective_ref_invalid`) is unchanged.

## Measured pre-change head (RED — fc9733ff)

Driven through the real interpreter path (bindBaton + runWorkflow over BatonApplication, a 5 KiB
brief): the lane ADMITTED and returned a settle receipt whose member outcome was
`phase:'failed'`, `terminalCause:'start'`, `error:{code:'application_client_invalid',
message:'Run objective is required'}` with the steering line `wave_member_start_failed` — the
per-member phantom the brief's RED stage describes (the embedded client's nonempty wall refuses at
the same 4096 bytes before the application's spill admission; the registry-declared refusal code
for the byte law is spill_body_exceeded). The 852700a5 phantom-surfacing landing is VERIFIED to
cover the receipt path: the phantom outcome carries the typed start error and terminalCause:'start'.
The pin suite's four red rows failed exactly there at the pre-change head and are green on the fix.

## Verification

- Pin suite RED at pre-change head (4 red rows: the lane admitted and returned the phantom
  receipt), GREEN on the fix: `node --test impl/test/objective-admission-align-red.test.mjs` — 6/6.
- `workflow-as-data-red` 31/31 green (W1-03 envelope pin, W5-01 import law, W2-phantom, W6 refusal
  constancy).
- `frame-economics-red` 49/50 — the single F1 failure is byte-identical to clean HEAD (pre-existing
  hits in coordination-store.mjs / omp-rpc.mjs, outside this row's scope); my change adds zero new
  hits.
- `workflow-surface-red` 56/58 — FP-14/FP-15 are the suite's own pre-existing red pins (verified
  failing at clean HEAD).
- `wave-driver-red`, `wave-driver-policy-red`, `workflow-dsl-red`, `workflow-dsl-package-red`,
  `workflow-policy`, phase79/80/85 workflow suites: no change vs clean HEAD (phase79 WF79-1/3-7 are
  the suite's own red pins, reproduced byte-identically from a clean-HEAD scratch checkout).
