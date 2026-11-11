# ROW BRIEF — row-plan-effects: coordinator verification-role plans (#240)

Issue #240. Today a coordinator-role member (driverKind wave, verification duty)
fails the trust gate with required_effect_absent: its plan — minted from the
deployment profile — declares repository_edit as a REQUIRED effect, but a
verification-only coordinator writes only its verify-notes.

Deliverable: implementation + red-first pin.
1. RED first: impl/test/coordinator-plan-effects-red.test.mjs — a coordinator-role
   run (driverKind: 'wave', waveRole 'coordinator' riding run.start options as the
   wave machinery passes them — see application.mjs run.start intent fields)
   whose ONLY write is docs/**verify-notes must complete, not fail
   required_effect_absent. Verify RED at HEAD.
2. Fix: the plan's requiredEffects for coordinator-role members excludes
   repository_edit (the effect stays DECLARED — capabilities unchanged — it is
   just not REQUIRED; absence is not a violation for the verification seat).
   Search: application.mjs requiredEffects derivation / the profile's
   requiredEffects list application-deployment.mjs:940 area.
3. GREEN + the full coordinator battery green.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.
