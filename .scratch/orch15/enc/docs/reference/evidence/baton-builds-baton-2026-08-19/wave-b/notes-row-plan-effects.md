# ROW NOTES — row-plan-effects: coordinator verification-role plans (#240)

[attempt: 4b19d324-91d7-4f4f-86af-aa156a744331 row-plan-effects]

Attempt line verbatim: `[attempt: 4b19d324-91d7-4f4f-86af-aa156a744331 row-plan-effects]`
Wave: baton-builds-baton-2026-08-19 wave-b · Row: #240 coordinator plans must not REQUIRE repository_edit
Authority: wave-a row-plan-effects-brief.md + the wave-b dispatch brief (this row's objectiveRef).

## The failure being fixed (measured wave-h)

The wave's coordinator seat — duty = verification (read the rows' deliverables, write
verify-notes.md) — failed the trust gate `required_effect_absent` because its plan, minted from
the deployment profile (effects `['provider_call','repository_edit']`,
requiredEffects `['repository_edit']` — application-deployment.mjs:947-948), demands a diff an
honest verifier with no diff can never produce. The gate is correct; the plan SHAPE is wrong for
the role. The wave machinery starts the seat with `driverKind:'wave'`, `waveId`, `waveRole:
'coordinator'`, `waveStart` riding run.start exactly as createWave does (wave.mjs:243-247), and
the intent fields carry waveRole through the closed key set (application.mjs normalizeIntent).

## Deliverable 1 — the RED pin (impl/test/coordinator-plan-effects-red.test.mjs)

The dispatch brief said the orchestrator's half-written pin existed; it did NOT exist in this
worktree (verified by search). I wrote it complete, per the brief's fixture instruction: the
BatonApplication fixture `principals` shape is the WORKING idiom
`{planner, dispatcher, observer}` each `{actor, principalId, sessionId}` (blind-waits-red
fixture / dispatch-seam-omp fixture), NOT the wrong shape the brief described. The two
assertions are kept exactly:

1. **coordinator-seat**: a wave run with `waveRole:'coordinator'` (plus waveId/waveStart as the
   wave machinery passes them) mints a plan whose node DECLARES repository_edit (effects
   includes it — the verify-notes write stays in-scope) but does NOT require it
   (`(node.requiredEffects ?? []).includes('repository_edit') === false`). Read back from the
   authoritative store index `coordination.goalPlanRun(repoId, runId).plan.nodes[0]`, never a
   projected view.
2. **row-seat control**: a wave member with a non-verification role (`'row-alpha'`) still mints
   `requiredEffects: ['repository_edit']` — the fix can never be a blanket effects weakening.

**RED at HEAD (verified before any fix)**: test 1 fails `true !== false` — the coordinator
node carries the profile-minted `requiredEffects:['repository_edit']`; test 2 is the still-green
control. `node --test test/coordinator-plan-effects-red.test.mjs` → 1 fail (the intended
reason), 1 pass.

## Deliverable 2 — the fix at the mint site (impl/src/application.mjs singleNode)

When the intent is a wave driverKind AND the waveRole is the verification seat
(`waveRole === 'coordinator'` — DRIVER_KINDS is the closed set `{'wave'}`, application.mjs:134):

- `requiredEffects` drops `repository_edit` (the profile's array is filtered; non-coordinator
  seats keep it verbatim — the row-seat control proves it);
- `effects` is UNCHANGED (repository_edit stays DECLARED — declared-but-not-required is the
  contract; the verify-notes write stays in-scope when it happens);
- the node additionally declares `analysis: true` — the TG5-blessed encoding of an effectful
  node whose repository_edit is declared-but-not-required (goal-plan.mjs:354-361 refuses
  `effects.length > 0 && !requiredEffects.includes('repository_edit')` without it; the BU-2-1
  amendment machinery is the exact precedent — browser-use BU-2-1a-2 pins
  `brief.requiredEffects` deep-equals `[]` with `analysis: true`). The gate reads
  `!task.brief?.analysis && task.brief?.requiredEffects?.includes('repository_edit')`
  (coordinator.mjs:13618) — with requiredEffects `[]` + analysis the required_effect arm is
  skipped while every other trust phase (capture, forbidden_effect, path_scope, environment,
  coverage) still runs, and the CP2 claim-time preflight mirrors the same skip.

Judgment call recorded: shape is `requiredEffects: []` + `analysis: true` (not simply dropping
the field). Dropping the field would also pass the gate, but it violates TG5's letter ("a node
cannot silently weaken the effect audit" — analysis:true is the SOLE legitimate path) and would
break under any TG5 hardening; the empty-requiredEffects + analysis pair is the codebase's
existing blessed encoding (browser-use BU-2-1), rides the amendment (b) contradiction refusal
symmetric, and keeps the requiredEffects field's presence stable across the plan/Brief match.

## GREEN evidence

- Pin: `node --test test/coordinator-plan-effects-red.test.mjs` → 2 pass / 0 fail.
- Behavioral smoke (one-off, not committed — the pin keeps the two brief-mandated assertions):
  full application path run.start → approve → plan-gated dispatch → MockAdapter turn with a
  DIFFLESS worker: the coordinator seat task **completed** (requiredEffects `[]`,
  effects keep repository_edit, analysis true), the row-seat control task **failed**
  `required_effect_absent` (log error code). The gate is preserved for members.
- Coordinator battery: `node --test test/coordinator.test.mjs` → 58 pass / 0 fail.
- phase62 batteries (all five files: goal-plan-authority, goal-plan-replay-reds,
  goal-plan-stream, mcp-goal-plan, web-goal-plan) → 41 pass / 1 fail. The single failure,
  `GP7/GP8: closed nested schemas and typed non-leaking goal/plan failures refuse safely`
  (`unknown_argument_field` vs `invalid_command`, phase62-web-goal-plan.test.mjs:339), is
  **PRE-EXISTING at HEAD** — verified by running the identical file set against a clean
  checkout of application.mjs (same failure, same counts) — and is a web command-schema
  refusal unrelated to #240. Not fixed (out of scope; not introduced here).
- Adjacent discipline batteries: phase73-required-effects.test.mjs + browser-use-red.test.mjs
  → 44 pass / 0 fail (the TG5/required-effects/analysis laws my shape rides stay green).
- Wave/plan-adjacent sweep (wave-driver-red, wave-driver-policy, cli-wave-fidelity,
  orchestrator-plan-object-red, dispatch-seam-omp-red, phase79-plan-wave-replay-red,
  phase66-plan-authorized-recovery) → 57 pass / 39 fail — the 39 failures are ALL in the
  separate `plan.*` OBJECT lane (orchestrator-plan.mjs, #161) and are byte-identical at clean
  HEAD (96 tests / 57 pass / 39 fail both with and without this change): zero regressions from
  this row.
- Coordinator-role usage sweep (waves-run-detach-red, wire-settle-detach-red,
  worker-orchestrated-swarm-red, workflow-dsl-red) → 57 pass / 0 fail.

## Deployment verification command (the ONLY definition of done)

Executable `true`, argv `[]`, cwd `.`, expected exit 0 — executed and passed (exit 0).

## Files changed (scope: impl/src/**, impl/test/**, wave-b dir)

- impl/src/application.mjs — singleNode mint: coordinator-seat requiredEffects drops
  repository_edit (effects kept), analysis:true added (13 insertions, 1 deletion).
- impl/test/coordinator-plan-effects-red.test.mjs — NEW red-first pin (the two assertions).
- docs/reference/evidence/baton-builds-baton-2026-08-19/wave-b/notes-row-plan-effects.md — this
  file.
