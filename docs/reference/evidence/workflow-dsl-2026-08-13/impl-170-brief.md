# IMPL BRIEF — the #170 DSL PACKAGE (complete feature, one landing)

You are the impl member for the campaign's first serialized package: the #170 workflow-DSL
package COMPLETE, against two landed red-first suites. **Acceptance bar: every capability row
in both suites green at its named stage; every PIN row stays green; the named adjacents stay
green; the gate's failure set does not grow.**

## Read first (in order)

1. `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (v2 FOLDED — the
   authority).
2. `impl/test/workflow-dsl-red.test.mjs` (35 rows — your primary acceptance machinery; read
   every row's stage + assertion).
3. `impl/test/workflow-dsl-package-red.test.mjs` (12 rows — the package addendum).
4. `redteam-170.md` + `fold-170.md` + `suite-fold-170.md` (same dir — the WHY).

## The package scope (complete, nothing phased)

1. **The compiler** (`impl/src/workflow-dsl.mjs`, new): the 16-directive line grammar lowering
   to the interpreter's closed field set; pure function of the text (the fold's B3 realpath
   resolution); every refusal carries `{line, field, expected}` AND sets
   `detail: {line, field, expected}` on the thrown error (the B4 wire fix); the closed
   `workflow_*` refusal family; constants inline or shared-module (S5 accepts both); no
   eval/import/file reads.
2. **The seam**: `waves.compile` direct-port beside `waves.run` (application.mjs:12560-12573
   family) + read-only MCP tool `baton_waves_compile` + `waves.run` registry surfaces gain
   `web` (OQ6 — no ghost row). `waves run` on a wavefile compiles then runs (R10).
3. **Steering cross-validation at admission** (fold H3): `signalOnMembersDone` roles +
   `answerDecisions` keys cross-check the roster — a typo refuses, never no-ops.
4. **#176 authority closure**: the six waves.* verbs pass the recursive-session gate like
   run.*; sessionAuthority-context `waves.send`/`waves.list` refuse typed. The eight facade
   direct ports' `_authorize` untouched.
5. **#183 `wave_already_terminal`**: same-key start on a terminal wave refuses typed, naming
   prior waveId + verdict + the re-key next action. Live-wave dedupe preserved.
6. **#171 pre-seeding**: at spawn each member's declared `report` file is created with the
   verbatim `[attempt: <salt> <role>]` first line; members append below it.
7. **#180 verification profile**: `driver.verification` accepts `none`/`suite:<path>`/`gate`;
   unknown profiles refuse `workflow_spec_invalid` naming `verification`; member outcomes
   project `verifiedBy`. The member-facing top-level `verification` spec field stays REMOVED (B4).
8. **#195 adapter contract**: `adapterModule.ADAPTER_CONTRACT_DEFINITION` named export (the
   shape PA-A asserts) + every semantic-registry entry gains a declared `canonicalOutput` (PA-B).

## The craft laws (binding)

No clocks · `localeCompare` banned · sorted-key literals ACTUAL order · byte literals only in
`limits.mjs` · additive-only on closed vocabularies · NUL discipline: application.mjs +
coordination-store.mjs are NUL-bearing (`grep -an`/`sed -n` only; don't disturb the NUL bytes)
· generated surface docs REGENERATE via the shipped generator, never hand-edit ·
boundary-commit law (#141): work commits in your worktree; never touch the operator's main
checkout · your `[attempt: <salt> <role>]` line VERBATIM in your notes' first five lines.

## Acceptance (verify before you finish)

1. `node --test impl/test/workflow-dsl-red.test.mjs` — 35/35.
2. `node --test impl/test/workflow-dsl-package-red.test.mjs` — 12/12.
3. Adjacents green-unchanged: `workflow-as-data-red` · `wave-observability-red` ·
   `control-surface-truth-red` · `mcp-profile-parity-red` (a red row moving to a DIFFERENT
   stage is a failure — fix or name it).
4. Write `impl-170-notes.md` (this dir): decisions, split records before/after, anything not
   green and why (an honest partial beats a forced green).

Never edit the suites — a wrong row is a DECISION_REQUEST with options, not a suite edit.
