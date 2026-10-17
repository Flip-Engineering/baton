# ROW — #240: coordinator plans must not REQUIRE repository_edit

Measured (wave-h): the wave's coordinator seat — whose duty is verification (read rows'
deliverables, write verify-notes.md) — failed the trust gate `required_effect_absent`
because its plan minted from the deployment profile carries
requiredEffects:['repository_edit']. An honest verifier with no diff can never satisfy it.

The gate is correct; the PLAN SHAPE is wrong for the role.

Deliverable (red-first):
1. A pin exists at impl/test/coordinator-plan-effects-red.test.mjs (half-written by the
   orchestrator — its BatonApplication fixture's `principals` shape is WRONG: the
   constructor exactObject-demands keys {planner, dispatcher, observer} with principal
   shape {actor, principalId, sessionId} — see the working idiom in
   impl/test/blind-waits-red.test.mjs fixture()). Fix the fixture; keep the two
   assertions (coordinator-seat brief: repository_edit declared, NOT required;
   row-seat control: still required). Verify RED for the intended reason at HEAD.
2. Fix at the mint site: application.mjs singleNode (~:4606-4624) — when the intent is
   a wave driverKind AND the waveRole is the verification seat (waveRole:'coordinator'
   per intent fields at application.mjs:1512-1569), drop repository_edit from the node's
   requiredEffects (KEEP it in effects — declared-but-not-required is the contract; the
   verify-notes write stays in-scope when it happens).
3. GREEN both rows + phase62 batteries + coordinator battery green.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-b/notes-row-plan-effects.md
